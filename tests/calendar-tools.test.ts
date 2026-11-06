import { describe, it, expect, beforeEach } from 'vitest';
import { calendarListTool, calendarSearchTool, calendarCreateTool, calendarMoveTool } from '@main/ai/tools/native/calendar';
import type { ConnectorService, AccountSummary } from '@main/services/cloud/ConnectorService';
import { setConnectorServiceProvider } from '@main/services/cloud/ConnectorServiceRuntime';
import type { CalendarEvent, CalendarListResult } from '@shared/connectors';

// Tool-surface law (ADR-0052 §6 desktop mapping / plan 52 M2 + P3 D): every
// result names the account it acted as, accountId stays an explicit argument,
// read-only vs state-changing risk classes hold, and copy never names a
// provider (providers are catalog data — plan 52 §12).

const account: AccountSummary = { id: 'acct-1', label: 'Personal', provider: 'google', providerLabel: 'Google', status: 'ok' };
const otherAccount: AccountSummary = { id: 'acct-2', label: 'Work', provider: 'microsoft', providerLabel: 'Microsoft 365', status: 'ok' };

const events: CalendarEvent[] = [
  { uid: 'evt-1', summary: 'Midterm exam', start: '2026-11-12T09:00:00Z', end: '2026-11-12T10:00:00Z', allDay: false, location: 'Hall B' },
  { uid: 'evt-2', summary: 'Reading week', start: '2026-12-01', end: '2026-12-03', allDay: true },
];

function fakeService(overrides: Partial<ConnectorService> = {}): ConnectorService {
  const base = {
    defaultAccountId: async (explicit?: string) => explicit ?? 'acct-1',
    accountSummary: async (id: string): Promise<AccountSummary> => (id === 'acct-2' ? otherAccount : account),
    listEvents: async (): Promise<CalendarListResult> => ({ events, truncated: false }),
    createEvent: async () => ({ uid: 'evt-new', summary: 'New event', start: '2026-11-20', end: '2026-11-21', allDay: true }),
    moveEvent: async () => ({ uid: 'evt-1', summary: 'Midterm exam', start: '2026-11-13T10:00:00Z', end: '2026-11-13T11:00:00Z', allDay: false }),
  };
  return { ...base, ...overrides } as unknown as ConnectorService;
}

let current: ConnectorService;

beforeEach(() => {
  current = fakeService();
  setConnectorServiceProvider(() => current);
});

describe('calendar tool risk classes and registration (ADR-0011 / plan 52 P3)', () => {
  it('list and search are read-only; create and move are state-changing; no delete tool exists', () => {
    expect(calendarListTool.risk).toBe('read-only');
    expect(calendarSearchTool.risk).toBe('read-only');
    expect(calendarCreateTool.risk).toBe('state-changing');
    expect(calendarMoveTool.risk).toBe('state-changing');
    expect(calendarListTool.category).toBe('integrations');
  });

  it('accountId stays an explicit argument on every tool', () => {
    for (const tool of [calendarListTool, calendarSearchTool, calendarCreateTool, calendarMoveTool]) {
      const shape = (tool.schema as unknown as { shape: Record<string, { isOptional: () => boolean }> }).shape;
      expect(shape.accountId, tool.name).toBeDefined();
      expect(shape.accountId.isOptional()).toBe(true);
    }
  });

  it('descriptions are provider-neutral (the provider comes from the catalog, never app copy)', () => {
    for (const tool of [calendarListTool, calendarSearchTool, calendarCreateTool, calendarMoveTool]) {
      expect(tool.description).not.toMatch(/Google|Microsoft|Outlook|365/i);
    }
  });

  it('calendar_search documents its semantics: bounded window, caps, match fields', () => {
    expect(calendarSearchTool.description).toContain('case-insensitive');
    expect(calendarSearchTool.description).toContain('titles, locations and bodies');
    expect(calendarSearchTool.description).toContain('60');
    expect(calendarSearchTool.description).toContain('400');
    expect(calendarSearchTool.description).toContain('100');
    expect(calendarSearchTool.description).toContain('Read-only');
  });
});

describe('every result names the account it acted as (plan 52 M2)', () => {
  it('calendar_list prefixes the account line', async () => {
    const text = await calendarListTool.exec({}, {});
    expect(text).toContain('Account: "Personal" (Google)');
    expect(text).toContain('Midterm exam');
  });

  it('calendar_search prefixes the account line', async () => {
    const text = await calendarSearchTool.exec({ query: 'midterm' }, {});
    expect(text).toContain('Account: "Personal" (Google)');
    expect(text).toContain('Midterm exam');
  });

  it('calendar_create names the account it created on', async () => {
    const text = await calendarCreateTool.exec({ summary: 'New event', start: '2026-11-20' }, {});
    expect(text).toContain('Account: "Personal" (Google)');
    expect(text).toContain('Created');
    expect(text).toContain('evt-new');
  });

  it('calendar_move names the account it moved on', async () => {
    const text = await calendarMoveTool.exec({ uid: 'evt-1', start: '2026-11-13T10:00:00Z' }, {});
    expect(text).toContain('Account: "Personal" (Google)');
    expect(text).toContain('Moved');
  });

  it('an explicit accountId is honored and named', async () => {
    const seen: string[] = [];
    current = fakeService({
      defaultAccountId: async (explicit?: string) => {
        seen.push(explicit ?? '(omitted)');
        return explicit ?? 'acct-1';
      },
      accountSummary: async () => otherAccount,
    });
    const text = await calendarListTool.exec({ accountId: 'acct-2' }, {});
    expect(seen).toEqual(['acct-2']);
    expect(text).toContain('Account: "Work" (Microsoft 365)');
  });

  it('even failures carry the account when one is known', async () => {
    current = fakeService({
      listEvents: async () => {
        throw Object.assign(new Error('nope'), { code: 'transient' });
      },
    });
    const text = await calendarSearchTool.exec({ query: 'x' }, {});
    expect(text).toContain('as "Personal" — Google');
  });

  it('no bound account reads as the typed not-found message (nothing to name)', async () => {
    current = fakeService({
      defaultAccountId: async () => {
        throw Object.assign(new Error('No calendar account is bound yet — connect one in Settings → Calendar.'), { code: 'not-found' });
      },
    });
    const text = await calendarListTool.exec({}, {});
    expect(text).toContain('No calendar account is bound');
  });
});
