import { createHash, randomBytes } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { ProviderRow } from './ProviderCatalog';
import {
  ConnectorError,
  ACCOUNT_SECRET_SLOTS,
  secretKey,
  type ConnectorAccountStore,
} from './ConnectorStore';

export interface SecretCustodian {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  isEncryptionAvailable(): boolean;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
}

export interface TokenSlots {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number;
  extra: Record<string, string>;
}

interface InFlightFlow {
  providerId: string;
  accountId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  scopes: string[];
  server: Server;
  timer: ReturnType<typeof setTimeout>;
  settleOutcome: (error: ConnectorError | null) => void;
  /** Resolved with `null` on success, or the typed failure — observable status. */
  outcome: Promise<ConnectorError | null>;
  settled: boolean;
  previousStatus?: string;
}

export interface OAuthServiceDeps {
  secrets: SecretCustodian;
  accounts: ConnectorAccountStore;
  openExternal: (url: string) => Promise<unknown>;
  catalogRow: (providerId: string) => ProviderRow | null;
  clientId: (row: ProviderRow) => string | null;
  /** Public client value for providers that require one at the token endpoint (Google). */
  clientSecret?: (row: ProviderRow) => string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Bind flow timeout in ms (law: ~5 minutes). */
  bindTimeoutMs?: number;
  /** Refresh attempt budget for transient failures (bounded, never infinite). */
  refreshAttempts?: number;
  notify?: (accountId: string, condition: 'needs-auth' | 'needs-secret' | 'failing') => void;
}

const REFRESH_SKEW_MS = 2 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 30_000;
const CALLBACK_PATH = '/oauth/callback';

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function jitterDelay(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 15_000);
  return Math.floor(base / 2 + Math.random() * (base / 2));
}

export class OAuthService {
  private readonly deps: Required<Pick<OAuthServiceDeps, 'secrets' | 'accounts' | 'openExternal' | 'catalogRow' | 'clientId'>> &
    OAuthServiceDeps;
  private readonly flows = new Map<string, InFlightFlow>();
  private readonly outcomes = new Map<string, { accountId: string; error: ConnectorError | null; at: number }>();
  private readonly refreshInFlight = new Map<string, Promise<void>>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly notified = new Set<string>();
  private readonly tokenCache = new Map<string, TokenSlots>();
  private readonly failures = new Map<string, number>();

  constructor(deps: OAuthServiceDeps) {
    this.deps = {
      notify: deps.notify ?? (() => undefined),
      refreshAttempts: deps.refreshAttempts ?? 3,
      bindTimeoutMs: deps.bindTimeoutMs ?? 5 * 60 * 1000,
      now: deps.now ?? (() => Date.now()),
      ...deps,
    } as typeof this.deps;
  }

  bindFlowFor(providerId: string): { providerId: string; accountId: string } | null {
    const flow = this.flows.get(providerId);
    return flow ? { providerId: flow.providerId, accountId: flow.accountId } : null;
  }

  /** The settle outcome of the provider's in-flight flow (null when none). */
  flowOutcome(providerId: string): Promise<ConnectorError | null> | null {
    return this.flows.get(providerId)?.outcome ?? null;
  }

  /** The last settled bind (completed or failed) within the observability window. */
  lastOutcome(providerId: string): { accountId: string; error: ConnectorError | null } | null {
    const entry = this.outcomes.get(providerId);
    if (!entry) {
      return null;
    }
    if (this.deps.now!() - entry.at > 60_000) {
      this.outcomes.delete(providerId);
      return null;
    }
    return { accountId: entry.accountId, error: entry.error };
  }

  /**
   * RFC 8252 loopback bind: one in-flight flow per provider, a `state` nonce,
   * a 5-minute timeout, a one-shot listener on 127.0.0.1 only. The renderer
   * receives a status — never the authorize URL, a code or a token.
   */
  async startBind(
    providerId: string,
    label: string | undefined,
    scopes: string[],
    accountId?: string
  ): Promise<string> {
    const row = this.deps.catalogRow(providerId);
    if (!row || !row.oauth || !row.serviceConfig.calendar) {
      throw new ConnectorError('invalid', `Provider '${providerId}' is not a bindable calendar provider.`);
    }
    if (this.flows.has(providerId)) {
      throw new ConnectorError('in-flight', `A bind flow for '${row.label}' is already waiting for consent.`);
    }
    this.outcomes.delete(providerId);
    if (!this.deps.clientId(row)) {
      throw new ConnectorError('needs-config', `No OAuth client id is configured for ${row.label}.`);
    }
    if (!this.deps.secrets.isEncryptionAvailable()) {
      throw new ConnectorError('needs-secret', 'No OS-backed secret store is available — bind refused (no plaintext fallback).');
    }
    let boundAccountId: string;
    let previousStatus: string | undefined;
    if (accountId) {
      const existing = await this.deps.accounts.get(accountId);
      if (!existing || existing.connectorKind !== `calendar:${providerId}`) {
        throw new ConnectorError('invalid', `No ${row.label} account '${accountId}' is bound.`);
      }
      previousStatus = existing.status;
      await this.deps.accounts.update(accountId, {
        label: label?.trim() || existing.label,
        scopes,
      });
      boundAccountId = accountId;
    } else {
      const account = await this.deps.accounts.create({
        connectorKind: `calendar:${providerId}`,
        label: label?.trim() || row.label,
        authKind: 'oauth',
        keyringRef: '',
        scopes,
        status: 'needs-auth',
      });
      boundAccountId = account.id;
      await this.deps.accounts.update(boundAccountId, { keyringRef: `connector:${boundAccountId}` });
    }
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(24));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    let redirectUri: string;
    try {
      redirectUri = await this.listenLoopback(
        providerId,
        boundAccountId,
        state,
        verifier,
        row,
        scopes,
        previousStatus
      );
    } catch (error) {
      if (!accountId) {
        await this.deleteSecretSlots(boundAccountId);
        await this.deps.accounts.remove(boundAccountId);
      }
      throw error;
    }
    const authorizeUrl = new URL(row.oauth.authorizeUrl);
    authorizeUrl.searchParams.set('client_id', this.deps.clientId(row)!);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', scopes.join(' '));
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    for (const [key, value] of Object.entries(row.oauth.extraAuthParams ?? {})) {
      authorizeUrl.searchParams.set(key, value);
    }
    try {
      await this.deps.openExternal(authorizeUrl.toString());
    } catch {
      this.settleFlow(providerId, new ConnectorError('cancelled', 'The browser could not be opened.'));
      throw new ConnectorError('transient', 'The browser could not be opened — start the bind again.');
    }
    return boundAccountId;
  }

  private listenLoopback(
    providerId: string,
    accountId: string,
    state: string,
    verifier: string,
    row: ProviderRow,
    scopes: string[],
    previousStatus?: string
  ): Promise<string> {
    return new Promise<string>((resolveListen, rejectListen) => {
      const server = createServer((request, response) => {
        void this.handleCallback(providerId, request, response).catch(() => undefined);
      });
      let settleOutcome!: (error: ConnectorError | null) => void;
      const outcome = new Promise<ConnectorError | null>((resolve) => {
        settleOutcome = resolve;
      });
      const timer = setTimeout(() => this.settleFlow(providerId, new ConnectorError('timeout', 'The consent window timed out — start the bind again.')), this.deps.bindTimeoutMs!);
      timer.unref?.();
      server.on('error', (error) => {
        this.flows.delete(providerId);
        clearTimeout(timer);
        rejectListen(new ConnectorError('invalid', `Loopback listener failed: ${error.message}`));
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          clearTimeout(timer);
          rejectListen(new ConnectorError('invalid', 'Loopback listener could not bind 127.0.0.1.'));
          return;
        }
        this.flows.set(providerId, {
          providerId,
          accountId,
          state,
          codeVerifier: verifier,
          redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
          scopes,
          server,
          timer,
          settleOutcome,
          outcome,
          settled: false,
          ...(previousStatus ? { previousStatus } : {}),
        });
        resolveListen(`http://127.0.0.1:${address.port}${CALLBACK_PATH}`);
      });
    });
  }

  private async handleCallback(providerId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const flow = this.flows.get(providerId);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const fail = (error: ConnectorError): void => {
      response.statusCode = error.code === 'state-mismatch' ? 400 : 400;
      response.setHeader('Content-Type', 'text/plain');
      response.end('The assistant could not complete the connection. Return to the app.');
      this.settleFlow(providerId, error);
    };
    if (!flow || url.pathname !== CALLBACK_PATH) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    const providerError = url.searchParams.get('error');
    if (providerError) {
      fail(new ConnectorError('cancelled', `Consent was not granted (${providerError}).`));
      return;
    }
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (!code || !returnedState || returnedState !== flow.state) {
      fail(new ConnectorError('state-mismatch', 'The consent response failed the state check.'));
      return;
    }
    try {
      await this.exchangeCode(flow, code);
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Connected</title><p style="font-family:sans-serif">The account is connected — you can close this window.</p>');
      this.settleFlow(providerId, null);
    } catch (error) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'text/plain');
      response.end('The assistant could not complete the connection. Return to the app.');
      this.settleFlow(providerId, error instanceof ConnectorError ? error : new ConnectorError('provider-error', 'The token exchange failed.'));
    }
  }

  /** The ONE settle path: flips the observable outcome and tears the listener down. */
  private settleFlow(providerId: string, error: ConnectorError | null): void {
    const flow = this.flows.get(providerId);
    if (!flow || flow.settled) {
      return;
    }
    flow.settled = true;
    clearTimeout(flow.timer);
    flow.settleOutcome(error);
    flow.server.close(() => undefined);
    flow.server.closeAllConnections?.();
    this.flows.delete(providerId);
    this.outcomes.set(providerId, { accountId: flow.accountId, error, at: this.deps.now!() });
    if (error) {
      void this.failBind(flow.accountId, error, flow.previousStatus);
    } else {
      void this.deps.accounts.update(flow.accountId, { status: 'ok' });
    }
  }

  private async failBind(
    accountId: string,
    error: ConnectorError,
    previousStatus?: string
  ): Promise<void> {
    if (previousStatus) {
      await this.deps.accounts.update(accountId, {
        status: error.code === 'needs-auth' ? 'needs-auth' : previousStatus,
      });
      return;
    }
    await this.deleteSecretSlots(accountId);
    const row = await this.deps.accounts.get(accountId);
    // A never-completed bind leaves no row behind: the account was never bound.
    if (row && row.status === 'needs-auth') {
      await this.deps.accounts.remove(accountId);
      return;
    }
    await this.deps.accounts.update(accountId, { status: error.code === 'needs-auth' ? 'needs-auth' : 'degraded' });
  }

  /**
   * The token-endpoint client value for providers that require one (Google's
   * "Desktop app" client). It is a PUBLIC, non-confidential value for
   * installed apps — bundled like the client id, never a credential. Providers
   * that take pure PKCE (Microsoft) return nothing here.
   */
  private publicClientSecret(row: ProviderRow): Record<string, string> {
    const value = this.deps.clientSecret?.(row)?.trim();
    return value ? { client_secret: value } : {};
  }

  private async exchangeCode(flow: InFlightFlow, code: string): Promise<void> {
    const row = this.deps.catalogRow(flow.providerId);
    if (!row?.oauth) {
      throw new ConnectorError('invalid', 'Provider row lost during bind.');
    }
    const clientId = this.deps.clientId(row);
    if (!clientId) {
      throw new ConnectorError('needs-config', `No OAuth client id is configured for ${row.label}.`);
    }
    const token = await this.tokenRequest(row, {
      code,
      client_id: clientId,
      redirect_uri: flow.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: flow.codeVerifier,
      ...this.publicClientSecret(row),
    });
    const scopes = typeof token.scope === 'string' && token.scope.trim()
      ? token.scope.trim().split(/\s+/)
      : flow.scopes;
    await this.persistTokens(flow.accountId, token, scopes);
  }

  private async tokenRequest(row: ProviderRow, body: Record<string, string>): Promise<TokenResponse> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(row.oauth!.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode(body),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new ConnectorError('transient', 'The provider token endpoint timed out.');
      }
      throw new ConnectorError('transient', 'The provider token endpoint could not be reached.');
    }
    let payload: TokenResponse = {};
    try {
      payload = (await response.json()) as TokenResponse;
    } catch {
      payload = {};
    }
    if (!response.ok) {
      if (payload.error === 'invalid_grant' || payload.error === 'invalid_client') {
        throw new ConnectorError('needs-auth', 'The provider rejected the grant — reconnect the account.');
      }
      if (response.status >= 500 || response.status === 429) {
        throw new ConnectorError('transient', 'The provider token endpoint is temporarily unavailable.');
      }
      throw new ConnectorError('provider-error', `The token exchange failed (${response.status}).`);
    }
    if (!payload.access_token) {
      throw new ConnectorError('provider-error', 'The token response carried no access token.');
    }
    return payload;
  }

  /** Token custody: write the new set before the old is discarded (ADR-0042 §6). */
  private async persistTokens(accountId: string, token: TokenResponse, scopes: string[]): Promise<void> {
    const expiresAtMs = this.deps.now!() + (token.expires_in ?? 3600) * 1000;
    if (token.refresh_token) {
      await this.deps.secrets.setSecret(secretKey(accountId, 'refresh'), token.refresh_token);
    }
    await this.deps.secrets.setSecret(secretKey(accountId, 'access'), token.access_token!);
    await this.deps.secrets.setSecret(secretKey(accountId, 'expires'), new Date(expiresAtMs).toISOString());
    await this.deps.secrets.setSecret(
      secretKey(accountId, 'extra'),
      JSON.stringify({
        ...(token.scope ? { scope: token.scope } : {}),
        ...(token.token_type ? { tokenType: token.token_type } : {}),
      })
    );
    this.tokenCache.set(accountId, {
      accessToken: token.access_token!,
      refreshToken: token.refresh_token ?? null,
      expiresAtMs,
      extra: {},
    });
    const current = await this.deps.accounts.get(accountId);
    await this.deps.accounts.update(accountId, {
      scopes: scopes.length > 0 ? scopes : ((current?.scopes as string[] | undefined) ?? []),
      expiresAt: new Date(expiresAtMs),
      status: 'ok',
    });
    this.notified.delete(`${accountId}:needs-auth`);
    this.notified.delete(`${accountId}:needs-secret`);
    this.notified.delete(`${accountId}:failing`);
  }

  private async deleteSecretSlots(accountId: string): Promise<void> {
    for (const slot of ACCOUNT_SECRET_SLOTS) {
      await this.deps.secrets.deleteSecret(secretKey(accountId, slot));
    }
    this.tokenCache.delete(accountId);
  }

  async cancelBind(providerId: string): Promise<boolean> {
    const flow = this.flows.get(providerId);
    if (!flow) {
      return false;
    }
    this.settleFlow(providerId, new ConnectorError('cancelled', 'The bind was cancelled.'));
    return true;
  }

  bindState(providerId: string): 'idle' | 'waiting' {
    return this.flows.has(providerId) ? 'waiting' : 'idle';
  }

  /**
   * One scheduler per account: refresh at `expiresAt − 2 min`, single-flight,
   * bounded transient retries, `invalid_grant` ⇒ needs-auth and stop.
   */
  async ensureFresh(accountId: string): Promise<string> {
    if (this.refreshInFlight.has(accountId)) {
      await this.refreshInFlight.get(accountId);
      const cached = this.tokenCache.get(accountId);
      if (cached && cached.expiresAtMs - this.deps.now!() > 1000) {
        return cached.accessToken;
      }
      if (!cached) {
        throw new ConnectorError('needs-auth', 'The account needs to be reconnected.');
      }
    }
    const attempt = this.refreshIfNeeded(accountId);
    this.refreshInFlight.set(accountId, attempt);
    try {
      await attempt;
    } finally {
      this.refreshInFlight.delete(accountId);
    }
    const cached = this.tokenCache.get(accountId);
    if (!cached) {
      throw new ConnectorError('needs-auth', 'The account has no stored token — reconnect it.');
    }
    return cached.accessToken;
  }

  private async refreshIfNeeded(accountId: string): Promise<void> {
    const row = await this.deps.accounts.get(accountId);
    if (!row) {
      throw new ConnectorError('not-found', 'The account row is gone.');
    }
    if (row.status === 'needs-auth' || row.status === 'needs-config' || row.status === 'needs-secret') {
      const code = row.status === 'needs-auth' ? 'needs-auth' : row.status === 'needs-config' ? 'needs-config' : 'needs-secret';
      throw new ConnectorError(code, 'The account is not usable until it is reconnected.');
    }
    const cached = this.tokenCache.get(accountId);
    const expiresSlot = await this.deps.secrets.getSecret(secretKey(accountId, 'expires'));
    const storedExpiry = expiresSlot ? Date.parse(expiresSlot) : cached?.expiresAtMs ?? null;
    if (Number.isNaN(storedExpiry ?? NaN)) {
      await this.markCondition(accountId, 'needs-auth', 'The stored token has no valid expiry — reconnect the account.');
      throw new ConnectorError('needs-auth', 'The stored token has no valid expiry.');
    }
    const accessToken = cached?.accessToken ?? (await this.deps.secrets.getSecret(secretKey(accountId, 'access')));
    if (accessToken && storedExpiry && storedExpiry - this.deps.now!() > REFRESH_SKEW_MS) {
      this.tokenCache.set(accountId, {
        accessToken,
        refreshToken: cached?.refreshToken ?? (await this.deps.secrets.getSecret(secretKey(accountId, 'refresh'))),
        expiresAtMs: storedExpiry,
        extra: {},
      });
      this.scheduleRefresh(accountId, storedExpiry);
      return;
    }
    await this.refreshNow(accountId);
  }

  private async refreshNow(accountId: string): Promise<void> {
    const row = await this.deps.accounts.get(accountId);
    const providerId = row ? providerIdOf(row.connectorKind) : null;
    const catalogRow = providerId ? this.deps.catalogRow(providerId) : null;
    const refreshToken = await this.deps.secrets.getSecret(secretKey(accountId, 'refresh'));
    if (!row || !providerId || !catalogRow?.oauth || !refreshToken) {
      await this.markCondition(accountId, 'needs-auth', 'The account has no refresh token — reconnect it.');
      throw new ConnectorError('needs-auth', 'The account has no refresh token.');
    }
    const clientId = this.deps.clientId(catalogRow);
    if (!clientId) {
      await this.markCondition(accountId, 'needs-config', `No OAuth client id is configured for ${catalogRow.label}.`);
      throw new ConnectorError('needs-config', `No OAuth client id is configured for ${catalogRow.label}.`);
    }
    let lastError: ConnectorError = new ConnectorError('transient', 'The refresh did not run.');
    for (let attempt = 1; attempt <= this.deps.refreshAttempts!; attempt++) {
      try {
        const token = await this.tokenRequest(catalogRow, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          ...this.publicClientSecret(catalogRow),
          client_id: clientId,
        });
        await this.persistTokens(accountId, token, (row.scopes as string[] | undefined) ?? []);
        this.failures.delete(accountId);
        this.scheduleRefresh(accountId, this.deps.now!() + (token.expires_in ?? 3600) * 1000);
        return;
      } catch (error) {
        lastError = error instanceof ConnectorError ? error : new ConnectorError('provider-error', 'The refresh failed.');
        if (lastError.code === 'needs-auth') {
          await this.markCondition(accountId, 'needs-auth', 'The provider revoked the grant — reconnect the account.');
          this.stopRefreshTimer(accountId);
          // Fail closed: a dead grant must never hand back a cached token
          // (the scheduled path swallows this; the call path must not).
          throw lastError;
        }
        if (lastError.code === 'needs-config') {
          this.stopRefreshTimer(accountId);
          throw lastError;
        }
        if (attempt < this.deps.refreshAttempts!) {
          await sleep(jitterDelay(attempt));
        }
      }
    }
    const failures = (this.failures.get(accountId) ?? 0) + 1;
    this.failures.set(accountId, failures);
    const retryDelayMs = Math.min(60_000 * 2 ** failures, 60 * 60 * 1000);
    await this.markCondition(accountId, 'degraded', 'The calendar refresh is failing — retrying with backoff.');
    this.scheduleRefresh(accountId, this.deps.now!() + retryDelayMs + REFRESH_SKEW_MS);
    throw lastError;
  }

  private async markCondition(
    accountId: string,
    condition: 'needs-auth' | 'needs-secret' | 'needs-config' | 'failing' | 'degraded',
    logMessage: string
  ): Promise<void> {
    await this.deps.accounts.update(accountId, { status: condition });
    const key = `${accountId}:${condition}`;
    if (!this.notified.has(key)) {
      this.notified.add(key);
      if (condition === 'needs-auth' || condition === 'needs-secret' || condition === 'failing') {
        this.deps.notify!(accountId, condition);
      }
    }
    console.warn(`[calendar] ${logMessage}`);
  }

  scheduleRefresh(accountId: string, expiresAtMs: number): void {
    this.stopRefreshTimer(accountId);
    const delay = Math.max(expiresAtMs - REFRESH_SKEW_MS - this.deps.now!(), 1000);
    const timer = setTimeout(() => {
      this.refreshInFlight.set(accountId, this.refreshNow(accountId).catch(() => undefined));
      void this.refreshInFlight.get(accountId)!.finally(() => this.refreshInFlight.delete(accountId));
    }, delay);
    timer.unref?.();
    this.refreshTimers.set(accountId, timer);
  }

  private stopRefreshTimer(accountId: string): void {
    const timer = this.refreshTimers.get(accountId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(accountId);
    }
  }

  /** Re-arm per-account schedulers from the secret store (the truth) on boot. */
  async resumeSchedules(): Promise<void> {
    const rows = await this.deps.accounts.list();
    for (const row of rows) {
      if (row.authKind !== 'oauth') {
        continue;
      }
      const expiresSlot = await this.deps.secrets.getSecret(secretKey(row.id, 'expires'));
      const expiresAtMs = expiresSlot ? Date.parse(expiresSlot) : NaN;
      if (Number.isNaN(expiresAtMs)) {
        await this.deps.accounts.update(row.id, { status: 'needs-auth' });
        continue;
      }
      if (row.status === 'needs-auth' || row.status === 'needs-config' || row.status === 'needs-secret') {
        continue;
      }
      this.scheduleRefresh(row.id, expiresAtMs);
    }
  }

  async invalidateAccessToken(accountId: string): Promise<void> {
    this.tokenCache.delete(accountId);
    await this.deps.secrets.deleteSecret(secretKey(accountId, 'access'));
    await this.deps.secrets.deleteSecret(secretKey(accountId, 'expires'));
  }

  async forgetAccount(accountId: string): Promise<void> {
    this.stopRefreshTimer(accountId);
    this.refreshInFlight.delete(accountId);
    this.failures.delete(accountId);
    await this.deleteSecretSlots(accountId);
  }

  /** Shutdown: every scheduler and in-flight flow dies with the app. */
  stopAll(): void {
    for (const [accountId, timer] of [...this.refreshTimers]) {
      clearTimeout(timer);
      this.refreshTimers.delete(accountId);
    }
    for (const providerId of [...this.flows.keys()]) {
      try {
        this.settleFlow(providerId, new ConnectorError('cancelled', 'The app is shutting down.'));
      } catch {
        // The flow may already have settled.
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerIdOf(connectorKind: string): string {
  return connectorKind.startsWith('calendar:') ? connectorKind.slice('calendar:'.length) : connectorKind;
}
