import { describe, it, expect, vi } from 'vitest';
import { OAuthService, type SecretCustodian } from '@main/services/cloud/OAuthService';
import type { ConnectorAccountPatch, ConnectorAccountRow, ConnectorAccountStore } from '@main/services/cloud/ConnectorStore';
import type { ProviderRow } from '@main/services/cloud/ProviderCatalog';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

const providerRow = (): ProviderRow => ({
  id: 'microsoft',
  label: 'Microsoft 365',
  services: ['calendar'],
  authKinds: ['oauth2'],
  oauth: {
    authorizeUrl: 'https://login.example.test/authorize',
    tokenUrl: 'https://token.example.test/token',
    revokeUrl: null,
    extraAuthParams: { response_mode: 'query' },
  },
  domains: ['token.example.test', 'graph.example.test'],
  serviceConfig: {
    calendar: {
      protocol: 'graph-calendar',
      apiBase: 'https://graph.example.test/v1.0',
      writable: true,
      scopes: { read: ['Calendars.Read'], write: ['Calendars.ReadWrite'] },
    },
  },
});

interface Fixture {
  oauth: OAuthService;
  secrets: SecretCustodian & { store: Map<string, string> };
  accounts: ConnectorAccountStore & { rows: Map<string, ConnectorAccountRow> };
  tokenFetch: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
}

function fixture(overrides: Partial<ConstructorParameters<typeof OAuthService>[0]> = {}): Fixture {
  const store = new Map<string, string>();
  const secrets = {
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
  } satisfies SecretCustodian & { store: Map<string, string> };
  const rows = new Map<string, ConnectorAccountRow>();
  const accounts: ConnectorAccountStore & { rows: Map<string, ConnectorAccountRow> } = {
    rows,
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async create(input) {
      const row: ConnectorAccountRow = {
        id: input.keyringRef || 'acct-x',
        connectorKind: input.connectorKind,
        label: input.label,
        authKind: input.authKind,
        keyringRef: input.keyringRef,
        expiresAt: null,
        scopes: input.scopes,
        status: input.status,
        updatedAt: new Date(),
      };
      rows.set(row.id, row);
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
  const notify = vi.fn();
  const tokenFetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, scope: 'Calendars.ReadWrite' }),
  }));
  const oauth = new OAuthService({
    secrets,
    accounts,
    openExternal: async () => undefined,
    catalogRow: (id) => (id === 'microsoft' ? providerRow() : null),
    clientId: () => 'client-id',
    fetchImpl: tokenFetch as unknown as typeof fetch,
    notify,
    refreshAttempts: 3,
    ...overrides,
  });
  return { oauth, secrets, accounts, tokenFetch, notify };
}

async function seedBoundAccount(f: Fixture, options: { expiresInSeconds?: number; status?: string; withRefresh?: boolean; withAccess?: boolean } = {}): Promise<string> {
  const accountId = 'acct-bound';
  f.accounts.rows.set(accountId, {
    id: accountId,
    connectorKind: 'calendar:microsoft',
    label: 'Work',
    authKind: 'oauth',
    keyringRef: `connector:${accountId}`,
    expiresAt: null,
    scopes: ['Calendars.ReadWrite'],
    status: options.status ?? 'ok',
    updatedAt: new Date(),
  });
  if (options.withRefresh !== false) {
    f.secrets.store.set(`connector:${accountId}:refresh`, 'stored-refresh');
  }
  if (options.withAccess !== false) {
    f.secrets.store.set(`connector:${accountId}:access`, 'stored-access');
  }
  f.secrets.store.set(`connector:${accountId}:expires`, new Date(Date.now() + (options.expiresInSeconds ?? 3600) * 1000).toISOString());
  return accountId;
}

describe('token refresh (one scheduler per account, ADR-0042 §6)', () => {
  it('is single-flight: concurrent callers await one refresh', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    let resolveFetch: (() => void) | null = null;
    f.tokenFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: true, status: 200, json: async () => ({ access_token: 'fresh-access', expires_in: 3600 }) });
        })
    );
    const first = f.oauth.ensureFresh(accountId);
    const second = f.oauth.ensureFresh(accountId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(f.tokenFetch).toHaveBeenCalledTimes(1);
    resolveFetch?.();
    expect(await first).toBe('fresh-access');
    expect(await second).toBe('fresh-access');
    expect(f.tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('never refreshes a token that is still fresh beyond the skew', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 3600 });
    expect(await f.oauth.ensureFresh(accountId)).toBe('stored-access');
    expect(f.tokenFetch).not.toHaveBeenCalled();
  });

  it('maps invalid_grant to needs-auth, stops refreshing, and notifies once', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    f.tokenFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'needs-auth' });
    expect(f.accounts.rows.get(accountId)?.status).toBe('needs-auth');
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.notify.mock.calls[0][1]).toBe('needs-auth');
    // Stop law: no further refresh attempts once the grant is dead.
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'needs-auth' });
    expect(f.tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('backs off as degraded after transient failures and retries later', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    f.tokenFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'server_error' }) });
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'transient' });
    expect(f.tokenFetch).toHaveBeenCalledTimes(3);
    expect(f.accounts.rows.get(accountId)?.status).toBe('degraded');
    expect(f.notify).not.toHaveBeenCalled();
    // The schedule is re-armed (degraded, never dead): a later call retries.
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'transient' });
    expect(f.tokenFetch).toHaveBeenCalledTimes(6);
    expect(f.accounts.rows.get(accountId)?.status).toBe('degraded');
  }, 20_000);

  it('persists a rotated refresh token before the old value is discarded', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    f.tokenFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 7200 }),
    });
    await f.oauth.ensureFresh(accountId);
    expect(f.secrets.store.get(`connector:${accountId}:access`)).toBe('rotated-access');
    expect(f.secrets.store.get(`connector:${accountId}:refresh`)).toBe('rotated-refresh');
    expect(f.accounts.rows.get(accountId)?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(f.accounts.rows.get(accountId)?.status).toBe('ok');
  });

  it('keeps the old refresh token when the provider does not rotate', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    f.tokenFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'rotated-access', expires_in: 3600 }),
    });
    await f.oauth.ensureFresh(accountId);
    expect(f.secrets.store.get(`connector:${accountId}:refresh`)).toBe('stored-refresh');
  });

  it('marks an account needs-auth when the expiry slot is missing or corrupt', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { withRefresh: true });
    f.secrets.store.set(`connector:${accountId}:expires`, 'not-a-date');
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'needs-auth' });
    expect(f.accounts.rows.get(accountId)?.status).toBe('needs-auth');
    expect(f.tokenFetch).not.toHaveBeenCalled();
  });

  it('re-arms the scheduler from the stored expiry and refreshes at expiresAt − 2 min', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 2 * 60 + 0.4 });
    await f.oauth.resumeSchedules();
    expect(f.tokenFetch).not.toHaveBeenCalled();
    // 400 ms delay + refresh round trip — generous to stay deterministic.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(f.tokenFetch).toHaveBeenCalledTimes(1);
    expect(f.secrets.store.get(`connector:${accountId}:access`)).toBe('fresh-access');
  }, 15_000);

  it('resumeSchedules flags accounts whose expiry slot vanished as needs-auth', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, {});
    f.secrets.store.delete(`connector:${accountId}:expires`);
    await f.oauth.resumeSchedules();
    expect(f.accounts.rows.get(accountId)?.status).toBe('needs-auth');
  });

  it('resumeSchedules leaves dead-grant accounts alone', async () => {
    const f = fixture();
    await seedBoundAccount(f, { status: 'needs-auth' });
    await f.oauth.resumeSchedules();
    expect(f.tokenFetch).not.toHaveBeenCalled();
  });

  it('a needs-config account never calls the token endpoint', async () => {
    const f = fixture();
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    f.accounts.rows.get(accountId)!.status = 'needs-config';
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'needs-config' });
    expect(f.tokenFetch).not.toHaveBeenCalled();
  });

  it('rotation crash: the new refresh token is written first and a retry recovers (ADR-0042 §6)', async () => {
    const f = fixture({ refreshAttempts: 1 });
    const accountId = await seedBoundAccount(f, { expiresInSeconds: 30 });
    const originalSet = f.secrets.setSecret.bind(f.secrets);
    let crashed = false;
    f.secrets.setSecret = async (key: string, value: string) => {
      if (!crashed && key === `connector:${accountId}:access`) {
        // The crash between the provider response and the store write.
        crashed = true;
        throw new Error('simulated crash during persist');
      }
      await originalSet(key, value);
    };
    f.tokenFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 }),
    });
    // The attempt crashes mid-persist → bounded budget spent → the service
    // stops and says so (transient posture, never an infinite retry).
    await expect(f.oauth.ensureFresh(accountId)).rejects.toMatchObject({ code: 'provider-error' });
    expect(f.accounts.rows.get(accountId)?.status).toBe('degraded');
    // Rotation is written FIRST: the new refresh token survives the crash
    // that discarded only the access token, so the chain is never stranded.
    expect(f.secrets.store.get(`connector:${accountId}:refresh`)).toBe('rotated-refresh');
    expect(f.secrets.store.get(`connector:${accountId}:access`)).toBe('stored-access');
    // A retry after the crash recovers onto the rotated chain.
    await f.oauth.ensureFresh(accountId);
    expect(f.secrets.store.get(`connector:${accountId}:access`)).toBe('rotated-access');
    expect(f.secrets.store.get(`connector:${accountId}:refresh`)).toBe('rotated-refresh');
    expect(f.accounts.rows.get(accountId)?.status).toBe('ok');
  });
});
