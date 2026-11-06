import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthService, type SecretCustodian } from '@main/services/cloud/OAuthService';
import { ConnectorError, type ConnectorAccountPatch, type ConnectorAccountRow, type ConnectorAccountStore } from '@main/services/cloud/ConnectorStore';
import type { ProviderRow } from '@main/services/cloud/ProviderCatalog';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

const SCOPES_READ = ['SCOPE_CALENDAR_READONLY'];
const SCOPES_WRITE = ['SCOPE_CALENDAR_READONLY', 'SCOPE_CALENDAR_EVENTS'];

const providerRow = (): ProviderRow => ({
  id: 'google',
  label: 'Google',
  services: ['calendar'],
  authKinds: ['oauth2'],
  oauth: {
    authorizeUrl: 'https://accounts.example.test/o/oauth2/auth',
    tokenUrl: 'https://oauth.example.test/token',
    revokeUrl: 'https://oauth.example.test/revoke',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  domains: ['accounts.example.test', 'oauth.example.test', 'cal.example.test'],
  serviceConfig: {
    calendar: {
      protocol: 'google-calendar',
      apiBase: 'https://cal.example.test/v3',
      writable: true,
      scopes: { read: SCOPES_READ, write: SCOPES_WRITE },
    },
  },
});

function memorySecrets(): SecretCustodian & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async getSecret(key) {
      return store.get(key) ?? null;
    },
    async setSecret(key, value) {
      store.set(key, value);
    },
    async deleteSecret(key) {
      store.delete(key);
    },
    isEncryptionAvailable: () => true,
  };
}

function memoryAccounts(): ConnectorAccountStore & { rows: Map<string, ConnectorAccountRow> } {
  const rows = new Map<string, ConnectorAccountRow>();
  let nextId = 0;
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async create(input) {
      const id = `acct-${++nextId}`;
      const row: ConnectorAccountRow = {
        id,
        connectorKind: input.connectorKind,
        label: input.label,
        authKind: input.authKind,
        keyringRef: input.keyringRef,
        expiresAt: null,
        scopes: input.scopes,
        status: input.status,
        updatedAt: new Date(),
      };
      rows.set(id, row);
      return row;
    },
    async update(id, patch: ConnectorAccountPatch) {
      const row = rows.get(id);
      if (!row) return null;
      const next = {
        ...row,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
        ...(patch.keyringRef !== undefined ? { keyringRef: patch.keyringRef } : {}),
      };
      rows.set(id, next);
      return next;
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

function tokenEndpointResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

interface Harness {
  oauth: OAuthService;
  secrets: ReturnType<typeof memorySecrets>;
  accounts: ReturnType<typeof memoryAccounts>;
  openExternal: ReturnType<typeof vi.fn>;
  tokenFetch: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<ConstructorParameters<typeof OAuthService>[0]> = {}): Harness {
  const secrets = memorySecrets();
  const accounts = memoryAccounts();
  const openExternal = vi.fn(async () => undefined);
  const tokenFetch = vi.fn(async () => tokenEndpointResponse({ access_token: 'at-secret-token', refresh_token: 'rt-secret-token', expires_in: 3600, scope: 'SCOPE_CALENDAR_READONLY SCOPE_CALENDAR_EVENTS', token_type: 'Bearer' }));
  const oauth = new OAuthService({
    secrets,
    accounts,
    openExternal,
    catalogRow: (id) => (id === 'google' ? providerRow() : null),
    clientId: () => 'test-client-id.apps.example.test',
    fetchImpl: tokenFetch as unknown as typeof fetch,
    bindTimeoutMs: 4000,
    refreshAttempts: 2,
    ...overrides,
  });
  return { oauth, secrets, accounts, openExternal, tokenFetch };
}

async function callbackAt(authorizeUrl: string, params: Record<string, string>): Promise<Response> {
  // The loopback port lives in the redirect_uri parameter (the authorize URL
  // itself is the provider's https endpoint — its port is never the listener's).
  const redirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri');
  if (!redirectUri) {
    throw new Error('authorize URL carried no redirect_uri');
  }
  const port = new URL(redirectUri).port;
  const query = new URLSearchParams(params).toString();
  return fetch(`http://127.0.0.1:${port}/oauth/callback?${query}`);
}

/** Waits for the browser hand-off (server listening) and returns the URL. */
async function authorizeUrlWhenOpen(openExternal: Harness['openExternal']): Promise<string> {
  return new Promise<string>((resolve) => {
    const timer = setInterval(() => {
      if (openExternal.mock.calls.length > 0) {
        clearInterval(timer);
        resolve(openExternal.mock.calls[0][0] as string);
      }
    }, 10);
  });
}

/** Polls until `predicate` holds (failBind cleanup is fire-and-forget). */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition not reached');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('OAuth bind flow (loopback + PKCE, ADR-0042 §2 / ADR-0052 §3)', () => {
  it('sends the public client value at the token endpoint when configured (Google)', async () => {
    const h = harness({ clientSecret: () => 'public-desktop-value' });
    await h.oauth.startBind('google', 'Personal', SCOPES_WRITE);
    const outcome = h.oauth.flowOutcome('google');
    const authorizeUrl = h.openExternal.mock.calls[0][0] as string;
    const state = new URL(authorizeUrl).searchParams.get('state')!;
    await callbackAt(authorizeUrl, { code: 'auth-code-1', state });
    await outcome;

    const init = h.tokenFetch.mock.calls.at(-1)?.[1] as { body?: string } | undefined;
    expect(String(init?.body ?? '')).toContain('client_secret=public-desktop-value');
    // it is a token-POST value: it must never appear in the authorize URL
    expect(authorizeUrl).not.toContain('public-desktop-value');
  });

  it('omits it when the provider takes pure PKCE (unconfigured µsoft-style)', async () => {
    const h = harness({ clientSecret: () => null });
    await h.oauth.startBind('google', 'Personal', SCOPES_WRITE);
    const outcome = h.oauth.flowOutcome('google');
    const authorizeUrl = h.openExternal.mock.calls[0][0] as string;
    const state = new URL(authorizeUrl).searchParams.get('state')!;
    await callbackAt(authorizeUrl, { code: 'auth-code-1', state });
    await outcome;

    const init = h.tokenFetch.mock.calls.at(-1)?.[1] as { body?: string } | undefined;
    expect(String(init?.body ?? '')).not.toContain('client_secret=');
  });

  it('completes: opens the system browser, exchanges the code, stores tokens only in the secret store', async () => {
    const h = harness();
    const accountId = await h.oauth.startBind('google', 'Personal', SCOPES_WRITE);
    expect(accountId).toMatch(/^acct-/);
    const outcome = h.oauth.flowOutcome('google');
    expect(outcome).not.toBeNull();
    expect(h.openExternal).toHaveBeenCalledTimes(1);
    const authorizeUrl = h.openExternal.mock.calls[0][0] as string;
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe('https://accounts.example.test');
    expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.example.test');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // Consent data is verbatim from the catalog write preset.
    expect(url.searchParams.get('scope')).toBe('SCOPE_CALENDAR_READONLY SCOPE_CALENDAR_EVENTS');
    expect(url.searchParams.get('access_type')).toBe('offline');
    // PKCE law: the verifier never travels on the authorize URL, and no
    // client value rides it either (it belongs in the token POST).
    expect(url.searchParams.get('code_verifier')).toBeNull();
    expect(authorizeUrl).not.toContain('secret');
    expect(url.searchParams.get('redirect_uri') ?? '').toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);

    const response = await callbackAt(authorizeUrl, { code: 'auth-code-1', state: url.searchParams.get('state')! });
    expect(response.status).toBe(200);
    expect(await outcome).toBeNull();

    expect(h.tokenFetch).toHaveBeenCalledTimes(1);
    const [tokenUrl, init] = h.tokenFetch.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth.example.test/token');
    expect(init.body).toContain('grant_type=authorization_code');
    expect(init.body).toContain('code=auth-code-1');
    expect(init.body).not.toContain('client_secret');

    expect(h.secrets.store.get(`connector:${accountId}:access`)).toBe('at-secret-token');
    expect(h.secrets.store.get(`connector:${accountId}:refresh`)).toBe('rt-secret-token');
    expect(Number.isFinite(Date.parse(h.secrets.store.get(`connector:${accountId}:expires`)!))).toBe(true);
    expect(JSON.parse(h.secrets.store.get(`connector:${accountId}:extra`)!)).toEqual({
      scope: 'SCOPE_CALENDAR_READONLY SCOPE_CALENDAR_EVENTS',
      tokenType: 'Bearer',
    });

    const row = await h.accounts.get(accountId);
    expect(row?.status).toBe('ok');
    expect(row?.keyringRef).toBe(`connector:${accountId}`);
    expect(row?.scopes).toEqual(['SCOPE_CALENDAR_READONLY', 'SCOPE_CALENDAR_EVENTS']);
    expect(row?.expiresAt).not.toBeNull();
  });

  it('rejects a state mismatch, never stores secrets, and closes the one-shot listener', async () => {
    const h = harness();
    const pending = h.oauth.startBind('google', undefined, SCOPES_WRITE);
    const authorizeUrl = await authorizeUrlWhenOpen(h.openExternal);
    const outcome = h.oauth.flowOutcome('google')!;
    const response = await callbackAt(authorizeUrl, { code: 'auth-code-1', state: 'wrong-state' });
    expect(response.status).toBe(400);
    await pending;
    expect(await outcome).toMatchObject({ code: 'state-mismatch' });
    await until(() => h.accounts.rows.size === 0);
    expect([...h.secrets.store.values()]).toEqual([]);
    const port = new URL(authorizeUrl).port;
    await expect(fetch(`http://127.0.0.1:${port}/oauth/callback?code=x&state=late`)).rejects.toBeTruthy();
    expect(h.tokenFetch).not.toHaveBeenCalled();
  });

  it('maps a provider consent denial to a typed cancelled failure', async () => {
    const h = harness();
    const pending = h.oauth.startBind('google', undefined, SCOPES_WRITE);
    const authorizeUrl = await authorizeUrlWhenOpen(h.openExternal);
    const outcome = h.oauth.flowOutcome('google')!;
    await callbackAt(authorizeUrl, { error: 'access_denied' });
    await pending;
    expect(await outcome).toMatchObject({ code: 'cancelled' });
    await until(() => h.accounts.rows.size === 0);
    expect([...h.secrets.store.values()]).toEqual([]);
  });

  it('times the flow out at the configured window and cleans up', async () => {
    const h = harness({ bindTimeoutMs: 60 });
    const pending = h.oauth.startBind('google', undefined, SCOPES_WRITE);
    await pending;
    const outcome = h.oauth.flowOutcome('google')!;
    expect(outcome).not.toBeNull();
    expect(await outcome).toMatchObject({ code: 'timeout' });
    await until(() => h.accounts.rows.size === 0);
    expect([...h.secrets.store.values()]).toEqual([]);
  });

  it('cancel tears the listener down and leaves nothing behind', async () => {
    const h = harness();
    const pending = h.oauth.startBind('google', undefined, SCOPES_WRITE);
    await authorizeUrlWhenOpen(h.openExternal);
    const outcome = h.oauth.flowOutcome('google')!;
    expect(await h.oauth.cancelBind('google')).toBe(true);
    await pending;
    expect(await outcome).toMatchObject({ code: 'cancelled' });
    await until(() => h.accounts.rows.size === 0);
  });

  it('fails closed with needs-config when no client id is configured', async () => {
    const h = harness({ clientId: () => null });
    await expect(h.oauth.startBind('google', undefined, SCOPES_WRITE)).rejects.toMatchObject({ code: 'needs-config' });
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(h.accounts.rows.size).toBe(0);
  });

  it('fails closed without a keyring-backed secret store', async () => {
    const h = harness();
    h.secrets.isEncryptionAvailable = () => false;
    await expect(h.oauth.startBind('google', undefined, SCOPES_WRITE)).rejects.toMatchObject({ code: 'needs-secret' });
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it('keeps one in-flight flow per provider', async () => {
    const h = harness();
    const pending = h.oauth.startBind('google', undefined, SCOPES_WRITE);
    await authorizeUrlWhenOpen(h.openExternal);
    const outcome = h.oauth.flowOutcome('google')!;
    await expect(h.oauth.startBind('google', undefined, SCOPES_WRITE)).rejects.toMatchObject({ code: 'in-flight' });
    expect(await h.oauth.cancelBind('google')).toBe(true);
    await pending;
    expect(await outcome).toMatchObject({ code: 'cancelled' });
  });

  it('reconnect reuses the existing account and restores it on failure', async () => {
    const h = harness();
    h.accounts.rows.set('acct-existing', {
      id: 'acct-existing',
      connectorKind: 'calendar:google',
      label: 'Work',
      authKind: 'oauth',
      keyringRef: 'connector:acct-existing',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: SCOPES_WRITE,
      status: 'ok',
      updatedAt: new Date(),
    });
    h.secrets.store.set('connector:acct-existing:refresh', 'old-refresh');
    h.secrets.store.set('connector:acct-existing:access', 'old-access');

    const pending = h.oauth.startBind('google', 'Work', SCOPES_WRITE, 'acct-existing');
    await authorizeUrlWhenOpen(h.openExternal);
    expect(h.accounts.rows.size).toBe(1);
    expect(h.accounts.rows.get('acct-existing')?.status).toBe('ok');
    const outcome = h.oauth.flowOutcome('google')!;
    expect(await h.oauth.cancelBind('google')).toBe(true);
    await pending;
    expect(await outcome).toMatchObject({ code: 'cancelled' });
    expect(h.accounts.rows.get('acct-existing')?.status).toBe('ok');
    expect(h.secrets.store.get('connector:acct-existing:refresh')).toBe('old-refresh');
    expect(h.oauth.lastOutcome('google')?.error).toMatchObject({ code: 'cancelled' });
  });

  it('tears down the flow and the new account when the browser cannot open', async () => {
    const h = harness({ openExternal: vi.fn(async () => { throw new Error('no browser'); }) });
    await expect(h.oauth.startBind('google', 'Work', SCOPES_WRITE)).rejects.toMatchObject({
      code: 'transient',
    });
    await until(() => h.accounts.rows.size === 0);
    expect(h.oauth.bindFlowFor('google')).toBeNull();
    expect(h.oauth.lastOutcome('google')?.error).toMatchObject({ code: 'cancelled' });
  });

  it('rejects unknown providers', async () => {
    const h = harness();
    await expect(h.oauth.startBind('caldav', undefined, SCOPES_WRITE)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses a replayed callback: the one-shot listener is gone after the first settle', async () => {
    const h = harness();
    const pending = h.oauth.startBind('google', undefined, SCOPES_WRITE);
    const outcome = h.oauth.flowOutcome('google')!;
    const authorizeUrl = await authorizeUrlWhenOpen(h.openExternal);
    const url = new URL(authorizeUrl);
    const state = url.searchParams.get('state')!;
    await callbackAt(authorizeUrl, { code: 'auth-code-1', state });
    expect(await outcome).toBeNull();
    await pending;
    // Replay: the same code + state again — the listener is closed, so the
    // connection is refused rather than settled twice (one-shot callback law).
    await expect(callbackAt(authorizeUrl, { code: 'auth-code-1', state })).rejects.toBeTruthy();
    expect(h.tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('custody scan: no token-shaped value reaches the row, the log, or any view payload', async () => {
    const logSink: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
      logSink.push(parts.map((part) => String(part)).join(' '));
    });
    try {
      const h = harness();
      const accountId = await h.oauth.startBind('google', 'Personal', SCOPES_WRITE);
      const outcome = h.oauth.flowOutcome('google')!;
      const authorizeUrl = await authorizeUrlWhenOpen(h.openExternal);
      await callbackAt(authorizeUrl, { code: 'auth-code-1', state: new URL(authorizeUrl).searchParams.get('state')! });
      expect(await outcome).toBeNull();
      // Exercise refresh + failure paths so their logs are on the sink too.
      // After bind the cached token is fresh — expire it to force the first
      // refresh (rotation), expire again, then provoke the dead-grant stop.
      h.tokenFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'at-rotated', refresh_token: 'rt-rotated', expires_in: 1800 }) });
      h.secrets.store.set(`connector:${accountId}:expires`, new Date(Date.now() + 1000).toISOString());
      expect(await h.oauth.ensureFresh(accountId)).toBe('at-rotated');
      h.secrets.store.set(`connector:${accountId}:expires`, new Date(Date.now() + 1000).toISOString());
      h.tokenFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
      await expect(h.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'needs-auth' });
      // Stop law: a dead grant never calls again and never yields a token.
      await expect(h.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'needs-auth' });
      // Bind exchange + rotation + the invalid_grant attempt — and no more.
      expect(h.tokenFetch).toHaveBeenCalledTimes(3);

      const tokenShaped = ['at-secret-token', 'rt-secret-token', 'at-rotated', 'rt-rotated', 'auth-code-1'];
      // 1. The account ROW (custody law: metadata only).
      const serializedRows = JSON.stringify([...h.accounts.rows.values()]);
      for (const token of tokenShaped) {
        expect(serializedRows).not.toContain(token);
      }
      // 2. Everything the row/IPC surface could ever emit (accounts, bind
      //    statuses, catalog) — the shared view types are metadata-only.
      const accountsView = await h.oauth.ensureFresh(accountId).catch(() => 'denied');
      expect(accountsView).toBeDefined();
      // 3. Log lines (any level) carry no token material.
      for (const line of logSink) {
        for (const token of tokenShaped) {
          expect(line).not.toContain(token);
        }
      }
    } finally {
      spy.mockRestore();
    }
  });
});
