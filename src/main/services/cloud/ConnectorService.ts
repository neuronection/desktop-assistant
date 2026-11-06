import { randomUUID } from 'crypto';
import type {
  CalendarCatalogView,
  CalendarEvent,
  CalendarListResult,
  ConnectorAccountView,
  ConnectorBindStatusView,
  ConnectorStatus,
  ConnectorTestResult,
} from '@shared/connectors';
import type { OAuthService } from './OAuthService';
import type { SecretCustodian } from './OAuthService';
import {
  calendarProviderRow,
  calendarScopes,
  clientIdFor,
  loadProviderCatalog,
  clientIdEnvFor,
  type ProviderCatalog,
  type ProviderRow,
} from './ProviderCatalog';
import { ConnectorError, providerOf, secretKey, type ConnectorAccountStore } from './ConnectorStore';
import {
  calendarAdapterFor,
  type CalendarAdapter,
  type CalendarFetch,
  type WriteEvent,
} from './CalendarService';
import { recordConnectorMutation } from './ConnectorAudit';

export interface ConnectorServiceDeps {
  secrets: SecretCustodian;
  accounts: ConnectorAccountStore;
  oauth: OAuthService;
  fetchImpl?: CalendarFetch;
  now?: () => number;
}

export interface CreateEventInput {
  summary: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  categories?: string[];
}

export interface MoveEventInput {
  uid: string;
  start: string;
  end?: string;
  allDay?: boolean;
}

const DEFAULT_MAX_EVENTS = 100;
const MAX_EVENTS_CAP = 500;

function assertValidRange(start: string, end: string | null, allDay: boolean): void {
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) {
    throw new ConnectorError('invalid', 'The event start is not a valid date/time.');
  }
  if (!end) {
    return;
  }
  const endMs = Date.parse(end);
  if (!Number.isFinite(endMs)) {
    throw new ConnectorError('invalid', 'The event end is not a valid date/time.');
  }
  if (allDay ? endMs < startMs : endMs <= startMs) {
    throw new ConnectorError('invalid', 'The event end must be after its start.');
  }
}

/** Metadata the chat tools need to name the account they acted as (plan 52 M2). */
export interface AccountSummary {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  status: ConnectorStatus;
}

interface AccountContext {
  row: ProviderRow;
  accessToken: string;
  adapter: CalendarAdapter;
}

export class ConnectorService {
  private readonly deps: ConnectorServiceDeps;
  private catalog: ProviderCatalog | null = null;
  private failures = new Map<string, number>();

  constructor(deps: ConnectorServiceDeps) {
    this.deps = deps;
  }

  private providerCatalog(): ProviderCatalog {
    if (!this.catalog) {
      this.catalog = loadProviderCatalog();
    }
    return this.catalog;
  }

  private rowFor(providerId: string): ProviderRow | null {
    return calendarProviderRow(this.providerCatalog(), providerId);
  }

  catalogView(): CalendarCatalogView {
    const catalog = this.providerCatalog();
    const providers = catalog.providers
      .filter((row) => row.serviceConfig.calendar && row.authKinds.includes('oauth2') && row.oauth)
      .filter((row) => calendarAdapterFor(row.serviceConfig.calendar!.protocol) !== null)
      .map((row) => {
        const scopes = calendarScopes(row);
        return {
          id: row.id,
          label: row.label,
          protocol: row.serviceConfig.calendar!.protocol,
          bindable: true,
          clientIdConfigured: clientIdFor(row) !== null,
          clientIdEnv: clientIdEnvFor(row.id),
          scopesRead: scopes.read,
          scopesWrite: scopes.write,
          domains: row.domains,
          setupFields: row.serviceConfig.calendar!.setupFields ?? [],
        };
      });
    const upcoming = catalog.providers
      .filter((row) => row.serviceConfig.calendar)
      .filter((row) => !providers.some((entry) => entry.id === row.id))
      .map((row) => ({ id: row.id, label: row.label, protocol: row.serviceConfig.calendar!.protocol }));
    return { providers, upcoming };
  }

  async accounts(): Promise<ConnectorAccountView[]> {
    const rows = await this.deps.accounts.list();
    const now = this.deps.now?.() ?? Date.now();
    const views: ConnectorAccountView[] = [];
    for (const row of rows) {
      if (row.authKind !== 'oauth') {
        continue;
      }
      const providerId = providerOf(row);
      const providerRow = this.rowFor(providerId);
      const expiresAtMs = row.expiresAt ? row.expiresAt.getTime() : null;
      const stale = row.status === 'ok' && expiresAtMs !== null && expiresAtMs + 5 * 60 * 1000 < now;
      const status: ConnectorStatus = stale
        ? 'stale'
        : (row.status as ConnectorStatus);
      views.push({
        id: row.id,
        provider: providerId,
        providerLabel: providerRow?.label ?? providerId,
        protocol: providerRow?.serviceConfig.calendar?.protocol ?? 'google-calendar',
        label: row.label,
        authKind: row.authKind,
        status,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
        consecutiveFailures: this.failures.get(row.id) ?? 0,
        revocable: providerRow?.oauth?.revokeUrl != null,
      });
    }
    return views;
  }

  /** Display metadata for a bound account — never a token, never a subject id. */
  async accountSummary(accountId: string): Promise<AccountSummary> {
    const row = await this.deps.accounts.get(accountId);
    if (!row) {
      throw new ConnectorError('not-found', `No calendar account '${accountId}' is bound.`);
    }
    const providerRow = this.rowFor(providerOf(row));
    return {
      id: row.id,
      label: row.label,
      provider: providerOf(row),
      providerLabel: providerRow?.label ?? providerOf(row),
      status: row.status as ConnectorStatus,
    };
  }

  bindStatuses(): ConnectorBindStatusView[] {
    return this.catalogView().providers.map((provider) => {
      const flow = this.deps.oauth.bindFlowFor(provider.id);
      if (flow) {
        return { providerId: provider.id, state: 'waiting' as const, accountId: flow.accountId, code: null, error: null };
      }
      const outcome = this.deps.oauth.lastOutcome(provider.id);
      if (outcome?.error) {
        return {
          providerId: provider.id,
          state: 'failed' as const,
          accountId: null,
          code: outcome.error.code,
          error: outcome.error.message,
        };
      }
      if (outcome) {
        return { providerId: provider.id, state: 'completed' as const, accountId: outcome.accountId, code: null, error: null };
      }
      return { providerId: provider.id, state: 'idle' as const, accountId: null, code: null, error: null };
    });
  }

  bindStatus(providerId: string): ConnectorBindStatusView {
    const known = this.catalogView().providers.some((entry) => entry.id === providerId);
    if (!known) {
      return { providerId, state: 'idle', accountId: null, code: 'invalid', error: `Unknown provider '${providerId}'.` };
    }
    return this.bindStatuses().find((entry) => entry.providerId === providerId)!;
  }

  async startBind(providerId: string, label?: string, accountId?: string): Promise<string> {
    const row = this.rowFor(providerId);
    if (!row) {
      throw new ConnectorError('invalid', `Unknown provider '${providerId}'.`);
    }
    const scopes = calendarScopes(row).write;
    return this.deps.oauth.startBind(providerId, label, scopes, accountId);
  }

  async cancelBind(providerId: string): Promise<boolean> {
    return this.deps.oauth.cancelBind(providerId);
  }

  /** Revoke best-effort (only where the catalog declares a revoke URL), delete every secret slot, delete the row. */
  async unbind(accountId: string): Promise<boolean> {
    const row = await this.deps.accounts.get(accountId);
    if (!row) {
      return false;
    }
    const providerRow = this.rowFor(providerOf(row));
    if (providerRow?.oauth?.revokeUrl) {
      const refreshToken = await this.deps.secrets.getSecret(secretKey(accountId, 'refresh'));
      const accessToken = await this.deps.secrets.getSecret(secretKey(accountId, 'access'));
      const token = refreshToken ?? accessToken;
      if (token) {
        try {
          const fetchImpl = this.deps.fetchImpl ?? (fetch as CalendarFetch);
          await fetchImpl(providerRow.oauth.revokeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${encodeURIComponent(token)}`,
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          // Revocation is best-effort; the secrets and the row go regardless.
        }
      }
    }
    await this.deps.oauth.forgetAccount(accountId);
    await this.deps.accounts.remove(accountId);
    return true;
  }

  async test(accountId: string): Promise<ConnectorTestResult> {
    const started = this.deps.now?.() ?? Date.now();
    try {
      await this.listEvents(accountId, { max: 1 });
      this.failures.delete(accountId);
      return { ok: true, latencyMs: (this.deps.now?.() ?? Date.now()) - started, error: null };
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code : 'provider-error';
      this.failures.set(accountId, (this.failures.get(accountId) ?? 0) + 1);
      return {
        ok: false,
        latencyMs: null,
        error: error instanceof ConnectorError ? `${code}: ${error.message}` : error instanceof Error ? error.message : String(error),
      };
    }
  }

  async defaultAccountId(explicit: string | undefined): Promise<string> {
    if (explicit) {
      const row = await this.deps.accounts.get(explicit);
      if (!row) {
        throw new ConnectorError('not-found', `No calendar account '${explicit}' is bound.`);
      }
      return explicit;
    }
    const rows = await this.deps.accounts.list();
    const bound = rows.find((row) => row.authKind === 'oauth' && row.status === 'ok') ?? rows.find((row) => row.authKind === 'oauth');
    if (!bound) {
      throw new ConnectorError('not-found', 'No calendar account is bound yet — connect one in Settings → Calendar.');
    }
    return bound.id;
  }

  private async withFreshContext<T>(accountId: string, run: (context: AccountContext) => Promise<T>): Promise<T> {
    try {
      return await run(await this.contextFor(accountId));
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'needs-auth') {
        await this.deps.oauth.invalidateAccessToken(accountId);
        try {
          return await run(await this.contextFor(accountId));
        } catch (retryError) {
          await this.deps.accounts.update(accountId, { status: 'needs-auth' });
          throw retryError;
        }
      }
      if (error instanceof ConnectorError && error.code === 'needs-secret') {
        await this.deps.accounts.update(accountId, { status: 'needs-secret' });
      }
      throw error;
    }
  }

  private async contextFor(accountId: string): Promise<AccountContext> {
    const account = await this.deps.accounts.get(accountId);
    if (!account) {
      throw new ConnectorError('not-found', `No calendar account '${accountId}' is bound.`);
    }
    const row = this.rowFor(providerOf(account));
    if (!row) {
      throw new ConnectorError('invalid', `The account's provider '${providerOf(account)}' is not in the catalog.`);
    }
    const adapter = calendarAdapterFor(row.serviceConfig.calendar!.protocol);
    if (!adapter) {
      throw new ConnectorError('unsupported', `Protocol '${row.serviceConfig.calendar!.protocol}' has no adapter in this build (CalDAV/ICS are next).`);
    }
    const accessToken = await this.deps.oauth.ensureFresh(accountId);
    return { row, accessToken, adapter };
  }

  /**
   * Bounded live read (desktop has no mirror — plan 52 H6). The window
   * defaults to yesterday → +400 days and every read is capped; the query
   * rides the protocol's search seam (server-side `q` on Google, a
   * client-side title/location/body filter over the same window on Graph).
   */
  async listEvents(
    accountId: string,
    options: { fromIso?: string; toIso?: string; max?: number; query?: string } = {}
  ): Promise<CalendarListResult> {
    const now = this.deps.now?.() ?? Date.now();
    const fromIso = options.fromIso ?? new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const toIso = options.toIso ?? new Date(now + 400 * 24 * 60 * 60 * 1000).toISOString();
    const max = Math.min(options.max ?? DEFAULT_MAX_EVENTS, MAX_EVENTS_CAP);
    const fetchImpl = this.deps.fetchImpl ?? (fetch as CalendarFetch);
    const page = await this.withFreshContext(accountId, ({ row, accessToken, adapter }) =>
      adapter.list(fetchImpl, row, accessToken, { fromIso, toIso, max, ...(options.query ? { query: options.query } : {}) })
    );
    return { events: page.events, ...(page.cursor ? { cursor: page.cursor } : {}), truncated: page.events.length >= max };
  }

  async createEvent(accountId: string, input: CreateEventInput): Promise<CalendarEvent> {
    const started = this.deps.now?.() ?? Date.now();
    const allDay = input.allDay ?? !input.start.includes('T');
    const start = input.start;
    let end = input.end ?? '';
    try {
      assertValidRange(start, end || null, allDay);
      if (!end) {
        end = allDay
          ? new Date(Date.parse(`${start.slice(0, 10)}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.parse(start) + 60 * 60 * 1000).toISOString();
      }
      const payload: WriteEvent = {
        // E1 identity: a chat-created event mints a namespaced uid HERE so the
        // provider round-trips it (Google iCalUID / Graph iCalUId) and a later
        // pull can never re-pull it as new (the duplicate-law, plan 52 E1).
        uid: `desktop:event:${randomUUID()}`,
        summary: input.summary.trim(),
        start,
        end,
        allDay,
        ...(input.location?.trim() ? { location: input.location.trim() } : {}),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(input.categories && input.categories.length > 0 ? { categories: input.categories } : {}),
      };
      const fetchImpl = this.deps.fetchImpl ?? (fetch as CalendarFetch);
      const event = await this.withFreshContext(accountId, ({ row, accessToken, adapter }) =>
        adapter.create(fetchImpl, row, accessToken, payload)
      );
      await recordConnectorMutation({ accountId, action: 'create', outcome: 'ok', durationMs: (this.deps.now?.() ?? Date.now()) - started });
      return event;
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code : 'provider-error';
      await recordConnectorMutation({ accountId, action: 'create', outcome: code, durationMs: (this.deps.now?.() ?? Date.now()) - started });
      throw error;
    }
  }

  async moveEvent(accountId: string, input: MoveEventInput): Promise<CalendarEvent> {
    const started = this.deps.now?.() ?? Date.now();
    try {
      // `uid` is the identity (iCalUID); the adapter resolves the write
      // handle by preflight, so a crash between write and read-back can
      // never duplicate (plan 52 C1/H2).
      assertValidRange(input.start, input.end ?? null, input.allDay ?? false);
      const fetchImpl = this.deps.fetchImpl ?? (fetch as CalendarFetch);
      const event = await this.withFreshContext(accountId, ({ row, accessToken, adapter }) =>
        adapter.move(fetchImpl, row, accessToken, {
          uid: input.uid,
          start: input.start,
          end: input.end ?? null,
          allDay: input.allDay ?? null,
        })
      );
      await recordConnectorMutation({ accountId, action: 'move', outcome: 'ok', durationMs: (this.deps.now?.() ?? Date.now()) - started });
      return event;
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code : 'provider-error';
      await recordConnectorMutation({ accountId, action: 'move', outcome: code, durationMs: (this.deps.now?.() ?? Date.now()) - started });
      throw error;
    }
  }
}
