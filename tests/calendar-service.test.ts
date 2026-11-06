import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorService, type CreateEventInput } from '@main/services/cloud/ConnectorService';
import { ConnectorError, type ConnectorAccountPatch, type ConnectorAccountRow, type ConnectorAccountStore } from '@main/services/cloud/ConnectorStore';
import type { ProviderRow } from '@main/services/cloud/ProviderCatalog';
import type { ProviderCatalog } from '@main/services/cloud/ProviderCatalog';
import { setConnectorAuditSink, type ConnectorMutationRecord } from '@main/services/cloud/ConnectorAudit';
import { guardedFetch, normalizeGraphEvent, type CalendarFetch } from '@main/services/cloud/CalendarService';
import { loadProviderCatalog } from '@main/services/cloud/ProviderCatalog';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

// The service tests ride the REAL vendored catalog: provider rows are data,
// the adapter registry is code. No provider id is written in the service.

const catalog: ProviderCatalog = loadProviderCatalog();

function catalogRow(providerId: string): ProviderRow {
  const row = catalog.providers.find((entry) => entry.id === providerId);
  if (!row) {
    throw new Error(`missing catalog row ${providerId}`);
  }
  return row;
}

interface RecordedRequest {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
}

function memoryAccounts(): ConnectorAccountStore & { rows: Map<string, ConnectorAccountRow> } {
  const rows = new Map<string, ConnectorAccountRow>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async create(input) {
      const row: ConnectorAccountRow = {
        id: input.keyringRef || 'acct-1',
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
      rows.set(id, { ...row, ...patch });
      return rows.get(id)!;
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

interface Harness {
  service: ConnectorService;
  accounts: ReturnType<typeof memoryAccounts>;
  calls: RecordedRequest[];
  fetchImpl: CalendarFetch;
  audit: ConnectorMutationRecord[];
  secrets: Map<string, string>;
}

function harness(providerId: string, routes: unknown[] | ((request: RecordedRequest) => unknown)): Harness {
  const accounts = memoryAccounts();
  accounts.rows.set('acct-1', {
    id: 'acct-1',
    connectorKind: `calendar:${providerId}`,
    label: 'Personal',
    authKind: 'oauth',
    keyringRef: 'connector:acct-1',
    expiresAt: new Date(Date.now() + 3600_000),
    scopes: ['scope'],
    status: 'ok',
    updatedAt: new Date(),
  });
  const queue = Array.isArray(routes) ? [...routes] : null;
  const calls: RecordedRequest[] = [];
  const fetchImpl: CalendarFetch = async (url, init) => {
    const request: RecordedRequest = { url, init };
    calls.push(request);
    const next = queue ? queue.shift() : routes(request);
    if (next === undefined) {
      throw new Error(`no canned response for ${url}`);
    }
    return { ok: true, status: 200, json: async () => next };
  };
  const audit: ConnectorMutationRecord[] = [];
  setConnectorAuditSink(async (record) => {
    audit.push(record);
  });
  const secrets = new Map<string, string>();
  const custodian = {
    getSecret: async (key: string) => secrets.get(key) ?? null,
    setSecret: async (key: string, value: string) => {
      secrets.set(key, value);
    },
    deleteSecret: async (key: string) => {
      secrets.delete(key);
    },
    isEncryptionAvailable: () => true,
  };
  const oauthStub = {
    ensureFresh: async () => 'test-access-token',
    forgetAccount: async (id: string) => {
      for (const key of [...secrets.keys()]) {
        if (key.startsWith(`connector:${id}:`)) {
          secrets.delete(key);
        }
      }
    },
  } as unknown as import('@main/services/cloud/OAuthService').OAuthService;
  const service = new ConnectorService({ secrets: custodian as never, accounts, oauth: oauthStub, fetchImpl });
  return { service, accounts, calls, fetchImpl, audit, secrets };
}

beforeEach(() => {
  setConnectorAuditSink(async () => undefined);
});

describe('catalog view is data-driven (plan 52 §12)', () => {
  it('bindable = OAuth provider whose protocol has an adapter — no hand-curated list', () => {
    const service = new ConnectorService({ secrets: {} as never, accounts: memoryAccounts(), oauth: {} as never });
    const view = service.catalogView();
    expect(view.providers.map((row) => row.id)).toEqual(['google', 'microsoft']);
    // CalDAV/ICS land in upcoming because no adapter exists yet — derived,
    // not typed anywhere.
    expect(view.upcoming.map((row) => row.id)).toEqual(['nextcloud', 'icloud', 'fastmail', 'caldav', 'ics']);
    for (const provider of view.providers) {
      expect(provider.scopesWrite.length).toBeGreaterThan(0);
      expect(provider.domains.length).toBeGreaterThan(0);
    }
  });

  it('client-id env names derive from the catalog row id (a new provider needs no code)', () => {
    const service = new ConnectorService({ secrets: {} as never, accounts: memoryAccounts(), oauth: {} as never });
    const view = service.catalogView();
    expect(view.providers.map((row) => row.clientIdEnv)).toEqual(['DESKTOP_GOOGLE_CLIENT_ID', 'DESKTOP_MICROSOFT_CLIENT_ID']);
  });
});

describe('bind status reports the settled outcome (W3.2)', () => {
  it('returns waiting, completed and failed from the OAuth seam', () => {
    const accounts = memoryAccounts();
    const oauth = {
      bindFlowFor: (providerId: string) => (providerId === 'google' ? { providerId, accountId: 'acct-1' } : null),
      lastOutcome: (providerId: string) =>
        providerId === 'microsoft' ? { accountId: 'acct-2', error: null } : null,
    };
    const service = new ConnectorService({ secrets: {} as never, accounts, oauth: oauth as never });
    expect(service.bindStatus('google')).toMatchObject({ state: 'waiting', accountId: 'acct-1' });
    expect(service.bindStatus('microsoft')).toMatchObject({ state: 'completed', accountId: 'acct-2' });

    const failed = {
      bindFlowFor: () => null,
      lastOutcome: () => ({ accountId: 'acct-3', error: new ConnectorError('cancelled', 'Consent was not granted.') }),
    };
    const failingService = new ConnectorService({ secrets: {} as never, accounts, oauth: failed as never });
    expect(failingService.bindStatus('google')).toMatchObject({
      state: 'failed',
      code: 'cancelled',
      error: 'Consent was not granted.',
    });
  });
});

describe('provider error bodies stay bounded and useful (W3.3)', () => {
  it('surfaces the provider message on a 400 instead of a bare status', async () => {
    const fetchImpl: CalendarFetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'End time must be after start time.' } }),
    });
    await expect(
      guardedFetch(fetchImpl, 'https://graph.example.test/v1.0/me/events', ['graph.example.test'])
    ).rejects.toMatchObject({
      code: 'provider-error',
      message: expect.stringContaining('End time must be after start time.'),
    });
  });
});

describe('rejected access token refreshes once (W3.3)', () => {
  it('invalidates the cached token on 401 and retries the read', async () => {
    const accounts = memoryAccounts();
    accounts.rows.set('acct-1', {
      id: 'acct-1',
      connectorKind: 'calendar:google',
      label: 'Personal',
      authKind: 'oauth',
      keyringRef: 'connector:acct-1',
      expiresAt: null,
      scopes: [],
      status: 'ok',
      updatedAt: new Date(),
    });
    let tokens = 0;
    const invalidateAccessToken = vi.fn(async () => undefined);
    const oauth = {
      ensureFresh: async () => `token-${++tokens}`,
      invalidateAccessToken,
      forgetAccount: async () => undefined,
    } as never;
    let first = true;
    const calls: string[] = [];
    const fetchImpl: CalendarFetch = async (url) => {
      calls.push(url);
      if (first) {
        first = false;
        return { ok: false, status: 401, json: async () => ({ error: 'invalid_token' }) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };
    const service = new ConnectorService({ secrets: {} as never, accounts, oauth, fetchImpl });
    const result = await service.listEvents('acct-1', { max: 1 });
    expect(result.events).toEqual([]);
    expect(invalidateAccessToken).toHaveBeenCalledWith('acct-1');
    expect(tokens).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('marks needs-auth when the retried call is still rejected', async () => {
    const accounts = memoryAccounts();
    accounts.rows.set('acct-1', {
      id: 'acct-1',
      connectorKind: 'calendar:google',
      label: 'Personal',
      authKind: 'oauth',
      keyringRef: 'connector:acct-1',
      expiresAt: null,
      scopes: [],
      status: 'ok',
      updatedAt: new Date(),
    });
    const oauth = {
      ensureFresh: async () => 'token',
      invalidateAccessToken: vi.fn(async () => undefined),
      forgetAccount: async () => undefined,
    } as never;
    const fetchImpl: CalendarFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_token' }),
    });
    const service = new ConnectorService({ secrets: {} as never, accounts, oauth, fetchImpl });
    await expect(service.listEvents('acct-1', { max: 1 })).rejects.toMatchObject({ code: 'needs-auth' });
    expect(accounts.rows.get('acct-1')?.status).toBe('needs-auth');
  });

  it('marks needs-secret on a 403', async () => {
    const accounts = memoryAccounts();
    accounts.rows.set('acct-1', {
      id: 'acct-1',
      connectorKind: 'calendar:google',
      label: 'Personal',
      authKind: 'oauth',
      keyringRef: 'connector:acct-1',
      expiresAt: null,
      scopes: [],
      status: 'ok',
      updatedAt: new Date(),
    });
    const oauth = {
      ensureFresh: async () => 'token',
      invalidateAccessToken: vi.fn(async () => undefined),
      forgetAccount: async () => undefined,
    } as never;
    const fetchImpl: CalendarFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'insufficient_scope' }),
    });
    const service = new ConnectorService({ secrets: {} as never, accounts, oauth, fetchImpl });
    await expect(service.listEvents('acct-1', { max: 1 })).rejects.toMatchObject({ code: 'needs-secret' });
    expect(accounts.rows.get('acct-1')?.status).toBe('needs-secret');
  });
});

describe('unbind revokes with the durable credential (W3.2)', () => {
  it('revokes with the refresh token, bounds the call, and deletes the account', async () => {
    const h = harness('google', () => ({}));
    h.secrets.set('connector:acct-1:refresh', 'refresh-1');
    h.secrets.set('connector:acct-1:access', 'access-1');
    expect(await h.service.unbind('acct-1')).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(catalogRow('google').oauth?.revokeUrl);
    expect(h.calls[0].init?.body).toContain('token=refresh-1');
    expect(h.calls[0].init?.signal).toBeDefined();
    expect(h.accounts.rows.has('acct-1')).toBe(false);
    expect(h.secrets.size).toBe(0);
  });
});

describe('account views carry honest metadata (consent honesty)', () => {
  it('revocable reflects the catalog revoke URL — Microsoft has none', async () => {
    const h = harness('microsoft', () => ({ value: [] }));
    const views = await h.service.accounts();
    expect(views).toHaveLength(1);
    expect(views[0].revocable).toBe(false);
  });

  it('a provider with a revoke URL reports revocable', async () => {
    const h = harness('google', () => ({ items: [] }));
    const views = await h.service.accounts();
    expect(views[0].revocable).toBe(true);
  });
});

describe('search semantics (plan 52 P3 D)', () => {
  it('google serves the query server-side via `q`', async () => {
    const h = harness('google', () => ({ items: [] }));
    await h.service.listEvents('acct-1', { query: 'midterm exam' });
    const listUrl = h.calls.find((call) => call.url.includes('/events?'))!;
    expect(listUrl.url).toContain('q=midterm+exam');
  });

  it('graph filters client-side over the bounded window (no server $search in v1)', async () => {
    const h = harness('microsoft', () => ({
      value: [
        {
          id: 'm-1',
          iCalUId: 'ical-1',
          subject: 'Midterm Exam',
          start: { dateTime: '2026-11-12T09:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-11-12T10:00:00.0000000', timeZone: 'UTC' },
        },
        {
          id: 'm-2',
          iCalUId: 'ical-2',
          subject: 'Dentist',
          start: { dateTime: '2026-11-13T09:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-11-13T10:00:00.0000000', timeZone: 'UTC' },
        },
      ],
    }));
    const result = await h.service.listEvents('acct-1', { query: 'midterm' });
    expect(result.events.map((event) => event.uid)).toEqual(['ical-1']);
    const viewUrl = new URL(h.calls[0].url);
    expect(viewUrl.pathname).toContain('/me/calendar/calendarView');
    expect(viewUrl.searchParams.has('$search')).toBe(false);
  });
});

describe('write dispatch rides the adapter registry (protocol, never provider)', () => {
  const googleCreateInput: CreateEventInput = { summary: 'Midterm', start: '2026-11-20', end: '2026-11-21', allDay: true };

  it('google create: iCalUID identity + categories ride extendedProperties (E1/E8)', async () => {
    const h = harness('google', (request) => {
      // Echo the mapper's body back with a provider handle attached.
      const body = JSON.parse(request.init?.body ?? '{}');
      return { id: 'g-1', iCalUID: body.iCalUID, summary: body.summary, start: body.start, end: body.end, extendedProperties: body.extendedProperties };
    });
    const event = await h.service.createEvent('acct-1', { ...googleCreateInput, categories: ['EXAM'] });
    expect(event.uid).toMatch(/^desktop:event:/);
    expect(event.remoteId).toBe('g-1');
    const body = JSON.parse(h.calls[0].init!.body!);
    expect(body.iCalUID).toMatch(/^desktop:event:/);
    expect(event.uid).toBe(body.iCalUID);
    expect(body.start).toEqual({ date: '2026-11-20' });
    expect(body.end).toEqual({ date: '2026-11-21' });
    expect(body.extendedProperties.private.nxCategories).toBe('EXAM');
  });

  it('graph create: all-day writes midnight-UTC exclusive stamps + verbatim categories', async () => {
    const h = harness('microsoft', (request) => {
      const body = JSON.parse(request.init?.body ?? '{}');
      return {
        id: 'm-1',
        subject: body.subject,
        isAllDay: body.isAllDay,
        categories: body.categories ?? [],
        start: { dateTime: '2026-11-20T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-11-21T00:00:00.0000000', timeZone: 'UTC' },
      };
    });
    const event = await h.service.createEvent('acct-1', { ...googleCreateInput, categories: ['EXAM'] });
    // Graph assigns iCalUId server-side (often absent on create), so the
    // read-back falls back to the provider id — the Python contract's law.
    expect(event.uid).toBe('m-1');
    expect(event.remoteId).toBe('m-1');
    const body = JSON.parse(h.calls[0].init!.body!);
    expect(body.isAllDay).toBe(true);
    expect(body.start).toEqual({ dateTime: '2026-11-20T00:00:00', timeZone: 'UTC' });
    expect(body.end).toEqual({ dateTime: '2026-11-21T00:00:00', timeZone: 'UTC' });
    expect(body.categories).toEqual(['EXAM']);
  });

  it('a protocol without an adapter refuses with typed unsupported (never a silent Graph fallthrough)', async () => {
    const h = harness('nextcloud', () => ({}));
    h.accounts.rows.set('acct-nc', {
      id: 'acct-nc',
      connectorKind: 'calendar:nextcloud',
      label: 'NC',
      authKind: 'oauth',
      keyringRef: 'connector:acct-nc',
      expiresAt: null,
      scopes: [],
      status: 'ok',
      updatedAt: new Date(),
    });
    await expect(h.service.createEvent('acct-nc', googleCreateInput)).rejects.toMatchObject({ code: 'unsupported' });
    expect(h.calls).toHaveLength(0);
  });

  it('recurrence never travels: the service input cannot express a series write (H1)', async () => {
    const h = harness('google', [
      { id: 'g-a', iCalUID: 'desktop:event:a', summary: 'A', start: { dateTime: '2026-11-12T09:00:00Z' }, end: { dateTime: '2026-11-12T10:00:00Z' } },
      { items: [{ id: 'g-2', iCalUID: 'u2', summary: 'B', start: { dateTime: '2026-11-12T09:00:00Z' }, end: { dateTime: '2026-11-12T10:00:00Z' } }] },
      { id: 'g-2', iCalUID: 'u2', summary: 'B', start: { dateTime: '2026-11-12T11:00:00Z' }, end: { dateTime: '2026-11-12T12:00:00Z' } },
    ]);
    // CreateEventInput carries no recurrence field — a series write is
    // unexpressible at the surface; the mapper refusal is pinned by the wall.
    await h.service.createEvent('acct-1', { summary: 'A', start: '2026-11-12T09:00:00Z' });
    await expect(
      h.service.moveEvent('acct-1', { uid: 'missing', start: '2026-11-21T09:00:00Z' })
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(h.calls.every((call) => !call.init?.body?.includes('RRULE'))).toBe(true);
  });
});

describe('moves preflight by identity and preserve duration (C1/H2)', () => {
  it('google move resolves the write handle by iCalUID, then PATCHes it', async () => {
    const h = harness('google', [
      { items: [{ id: 'g-1', iCalUID: 'study:plan-item:p1', summary: 'Lecture', start: { dateTime: '2026-11-12T09:00:00Z' }, end: { dateTime: '2026-11-12T11:00:00Z' } }] },
      { id: 'g-1', iCalUID: 'study:plan-item:p1', summary: 'Lecture', start: { dateTime: '2026-11-13T10:00:00Z' }, end: { dateTime: '2026-11-13T12:00:00Z' } },
    ]);
    const event = await h.service.moveEvent('acct-1', { uid: 'study:plan-item:p1', start: '2026-11-13T10:00:00Z' });
    expect(event.uid).toBe('study:plan-item:p1');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].url).toContain('iCalUID=study%3Aplan-item%3Ap1');
    expect(h.calls[1].url).toContain('/events/g-1');
    // Duration preserved: 2h event stays 2h (canonical second-precision UTC).
    const patchBody = JSON.parse(h.calls[1].init!.body!);
    expect(patchBody.start).toEqual({ dateTime: '2026-11-13T10:00:00Z' });
    expect(patchBody.end).toEqual({ dateTime: '2026-11-13T12:00:00Z' });
  });

  it('graph move resolves by iCalUId and PATCHes the resolved id', async () => {
    const h = harness('microsoft', [
      { value: [{ id: 'm-9', iCalUId: 'ical-1', subject: 'Lecture', isAllDay: false, start: { dateTime: '2026-11-12T09:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T10:00:00.0000000', timeZone: 'UTC' } }] },
      { id: 'm-9', iCalUId: 'ical-1', subject: 'Lecture', start: { dateTime: '2026-11-13T09:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T10:00:00.0000000', timeZone: 'UTC' } },
    ]);
    const event = await h.service.moveEvent('acct-1', { uid: 'ical-1', start: '2026-11-13T09:00:00Z' });
    expect(event.uid).toBe('ical-1');
    expect(h.calls[1].url).toContain('/me/events/m-9');
  });
});

describe('calendar correctness fixes (release readiness)', () => {
  it('keeps the wall-clock date for a Microsoft all-day event outside UTC', () => {
    const event = normalizeGraphEvent({
      id: 'm-1',
      iCalUId: 'u-1',
      subject: 'Holiday',
      isAllDay: true,
      start: { dateTime: '2026-11-20T00:00:00.0000000', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-11-21T00:00:00.0000000', timeZone: 'Europe/Berlin' },
    });
    expect(event?.start).toBe('2026-11-20');
    expect(event?.end).toBe('2026-11-21');
  });

  it('survives a Graph event with a Windows time-zone name', () => {
    const event = normalizeGraphEvent({
      id: 'm-2',
      iCalUId: 'u-2',
      subject: 'Outlook event',
      isAllDay: false,
      start: { dateTime: '2026-11-20T09:00:00.0000000', timeZone: 'W. Europe Standard Time' },
      end: { dateTime: '2026-11-20T10:00:00.0000000', timeZone: 'W. Europe Standard Time' },
    });
    expect(event).not.toBeNull();
    expect(event?.start).toBe('2026-11-20T09:00:00Z');
  });

  it('refuses a Google recurring-series move', async () => {
    const h = harness('google', [
      {
        items: [
          {
            id: 'g-series',
            iCalUID: 'series-1',
            summary: 'Standup',
            recurrence: ['RRULE:FREQ=WEEKLY'],
            start: { dateTime: '2026-11-12T09:00:00Z' },
            end: { dateTime: '2026-11-12T09:15:00Z' },
          },
        ],
      },
    ]);
    await expect(
      h.service.moveEvent('acct-1', { uid: 'series-1', start: '2026-11-13T09:00:00Z' })
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(h.calls).toHaveLength(1);
  });

  it('refuses a Graph recurring-series move', async () => {
    const h = harness('microsoft', [
      {
        value: [
          {
            id: 'm-series',
            iCalUId: 'series-1',
            subject: 'Standup',
            type: 'seriesMaster',
            start: { dateTime: '2026-11-12T09:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-11-12T09:15:00.0000000', timeZone: 'UTC' },
          },
        ],
      },
    ]);
    await expect(
      h.service.moveEvent('acct-1', { uid: 'series-1', start: '2026-11-13T09:00:00Z' })
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(h.calls).toHaveLength(1);
  });

  it('keeps isAllDay on a Graph move', async () => {
    const h = harness('microsoft', [
      {
        value: [
          {
            id: 'm-9',
            iCalUId: 'ical-1',
            subject: 'Holiday',
            isAllDay: true,
            start: { dateTime: '2026-11-12T00:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-11-13T00:00:00.0000000', timeZone: 'UTC' },
          },
        ],
      },
      {
        id: 'm-9',
        iCalUId: 'ical-1',
        subject: 'Holiday',
        isAllDay: true,
        start: { dateTime: '2026-11-13T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-11-14T00:00:00.0000000', timeZone: 'UTC' },
      },
    ]);
    await h.service.moveEvent('acct-1', { uid: 'ical-1', start: '2026-11-13', allDay: true });
    const body = JSON.parse(h.calls[1].init!.body!);
    expect(body.isAllDay).toBe(true);
  });

  it('rejects an invalid range before any provider call and audits the attempt', async () => {
    const h = harness('google', () => ({}));
    await expect(
      h.service.createEvent('acct-1', { summary: 'Bad', start: 'not-a-date' })
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(h.calls).toHaveLength(0);
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0]).toMatchObject({ action: 'create', outcome: 'invalid' });
  });
});

describe('external-mutation audit rows (ADR-0052 §8)', () => {
  it('one audit row per state-changing call — counts and typed codes only', async () => {
    const h = harness('google', [
      { id: 'g-1', iCalUID: 'u1', summary: 'A', start: { dateTime: '2026-11-12T09:00:00Z' }, end: { dateTime: '2026-11-12T10:00:00Z' } },
      { items: [{ id: 'g-2', iCalUID: 'u2', summary: 'B', start: { dateTime: '2026-11-12T09:00:00Z' }, end: { dateTime: '2026-11-12T10:00:00Z' } }] },
      { id: 'g-2', iCalUID: 'u2', summary: 'B', start: { dateTime: '2026-11-12T11:00:00Z' }, end: { dateTime: '2026-11-12T12:00:00Z' } },
    ]);
    await h.service.createEvent('acct-1', { summary: 'A', start: '2026-11-12T09:00:00Z' });
    await h.service.moveEvent('acct-1', { uid: 'u2', start: '2026-11-12T11:00:00Z' });
    expect(h.audit).toHaveLength(2);
    expect(h.audit[0]).toMatchObject({ accountId: 'acct-1', action: 'create', outcome: 'ok' });
    expect(h.audit[1]).toMatchObject({ accountId: 'acct-1', action: 'move', outcome: 'ok' });
    // The audit payload carries no event text — the row is exportable.
    for (const record of h.audit) {
      expect(JSON.stringify(record)).not.toContain('Midterm');
      expect(JSON.stringify(record)).not.toContain('test-access-token');
    }
  });

  it('a failed mutation still writes its typed-code row', async () => {
    const h = harness('google', () => {
      throw Object.assign(new Error('boom'), { code: 'provider-error' });
    });
    // recordingFetch throws inside json() → guardedFetch wraps as transient
    await h.service.createEvent('acct-1', { summary: 'A', start: '2026-11-12T09:00:00Z' }).catch(() => undefined);
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0].outcome).toBe('transient');
    expect(h.audit[0].action).toBe('create');
  });
});

describe('custody: no token-shaped value crosses a surface (ADR-0042 clause 3)', () => {
  it('account views, catalog views and audit rows serialize clean', async () => {
    const h = harness('google', () => ({ items: [] }));
    const views = await h.service.accounts();
    const catalog = h.service.catalogView();
    const summary = await h.service.accountSummary('acct-1');
    const serialized = JSON.stringify({ views, catalog, summary });
    // The access token the stub hands out, and token-shaped shapes generally.
    expect(serialized).not.toContain('test-access-token');
    expect(serialized).not.toMatch(/"accessToken"\s*:/);
    expect(serialized).not.toMatch(/"refreshToken"\s*:/);
    // The audit sink receives no token material either.
    expect(JSON.stringify(h.audit)).not.toContain('test-access-token');
  });
});

describe('account summaries name the acting account (plan 52 M2)', () => {
  it('accountSummary returns display metadata only', async () => {
    const h = harness('google', () => ({ items: [] }));
    const summary = await h.service.accountSummary('acct-1');
    expect(summary).toMatchObject({ id: 'acct-1', label: 'Personal', provider: 'google', providerLabel: 'Google' });
    expect(JSON.stringify(summary)).not.toContain('test-access-token');
  });

  it('an unknown account is a typed not-found', async () => {
    const h = harness('google', () => ({ items: [] }));
    await expect(h.service.accountSummary('nope')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('domain-scoped fetch stays inside the catalog', () => {
  it('a host outside the row domains is a typed invalid', async () => {
    const { graphList } = await import('@main/services/cloud/CalendarService');
    const h = harness('google', () => ({}));
    // A Microsoft-shaped row pointed at a host outside its declared domains:
    // the token-bearing call must be refused before it leaves.
    const row: ProviderRow = {
      ...catalogRow('microsoft'),
      serviceConfig: {
        calendar: { ...catalogRow('microsoft').serviceConfig.calendar!, apiBase: 'https://www.googleapis.com/v1.0' },
      },
    };
    await expect(
      graphList(h.fetchImpl, row, 't', '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z', 10)
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(h.calls).toHaveLength(0);
  });
});
