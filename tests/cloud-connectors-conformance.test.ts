import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The TypeScript half of the family acceptance wall (ADR-0052 §10 / plan 52
// M6+Rev3 E7): the SAME rows the Python runner executes, executed here
// against the desktop implementation. Implementations may differ, outputs
// may not (ADR-0040 §22). Values are data only — no real credentials.

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

const { scopeDiff, isAttributable, SOURCE_CATEGORY } = await import('@shared/connectors');
const {
  normalizeGoogleEvent,
  normalizeGraphEvent,
  googleEventBody,
  graphEventBody,
  graphBase,
  calendarAdapterFor,
  googleCalendarRow,
  graphCalendarRow,
} = await import('@main/services/cloud/CalendarService');
const { clientIdEnvFor, loadProviderCatalog } = await import('@main/services/cloud/ProviderCatalog');
const { ConnectorError } = await import('@main/services/cloud/ConnectorStore');

const repo = process.cwd();

// Fixture row shapes (local mirrors of the family fixture schema — the file
// itself is vendored and read-only).
interface WriteRow {
  name: string;
  event: Record<string, unknown>;
  expect?: Record<string, unknown>;
  expectError?: string;
}
interface CloudConnectorFixtures {
  catalog: {
    order: string[];
    calendarProviders: string[];
    filesProviders: string[];
    scopes: Record<string, Record<string, { read: string[]; write: string[] }>>;
    scopeGrowth: { granted: string[]; requested: string[]; added: string[]; removed: string[] }[];
  };
  wire: {
    googleList: {
      response: { items: Record<string, unknown>[]; nextSyncToken?: string };
      expect: { count?: number; uid: string; start: string; nextSyncToken?: string; remoteId?: string };
    };
    graphList: {
      response: { value: Record<string, unknown>[] };
      expect: { count?: number; uid: string; start: string; categories?: string[] };
    };
    googleWrite: WriteRow[];
    graphWrite: WriteRow[];
    graphUrls: { calendarId: string; user: string; expect: string }[];
  };
}

const fixtures = JSON.parse(
  readFileSync(resolve(repo, 'tests/fixtures/cloud-connectors.fixtures.json'), 'utf8')
) as CloudConnectorFixtures;
const catalog = loadProviderCatalog();

/** Dotted-path reader, mirroring the Python runner's `dotted(body, path)`. */
function dotted(body: Record<string, unknown>, path: string): unknown {
  const [head, ...rest] = path.split('.');
  const value = body[head];
  if (rest.length === 0 || value === undefined || value === null) {
    return value;
  }
  return dotted(value as Record<string, unknown>, rest.join('.'));
}

const providerIds = catalog.providers.map((row) => row.id);

describe('wall: catalog provider sets (fixtures.catalog)', () => {
  it('provider order matches the family catalog exactly', () => {
    expect(providerIds).toEqual(fixtures.catalog.order);
  });

  it('calendar provider set matches (no hand-curated additions, none missing)', () => {
    const calendar = catalog.providers.filter((row) => row.serviceConfig.calendar).map((row) => row.id);
    expect(calendar).toEqual(fixtures.catalog.calendarProviders);
  });

  it('files provider set matches', () => {
    const files = catalog.providers.filter((row) => row.serviceConfig.files).map((row) => row.id);
    expect(files).toEqual(fixtures.catalog.filesProviders);
  });

  it('scope presets are verbatim, per service and direction', () => {
    for (const [providerId, services] of Object.entries(fixtures.catalog.scopes)) {
      const row = catalog.providers.find((entry) => entry.id === providerId)!;
      for (const [service, directions] of Object.entries(services)) {
        expect(row.serviceConfig[service]?.scopes, `${providerId}.${service}`).toEqual(directions);
      }
    }
  });

  it('scope growth (add + removal) matches every fixture row', () => {
    expect(fixtures.catalog.scopeGrowth.length).toBeGreaterThan(0);
    for (const row of fixtures.catalog.scopeGrowth) {
      expect(scopeDiff(row.granted, row.requested)).toEqual({ added: row.added, removed: row.removed });
    }
  });

  it('client-id config keys derive from the provider id, never a provider map', () => {
    expect(clientIdEnvFor('google')).toBe('DESKTOP_GOOGLE_CLIENT_ID');
    expect(clientIdEnvFor('microsoft')).toBe('DESKTOP_MICROSOFT_CLIENT_ID');
    // A provider the host has never heard of still gets a key: adding a row
    // must not need code (plan 52 §12 rule 1).
    expect(clientIdEnvFor('some-future-provider')).toBe('DESKTOP_SOME_FUTURE_PROVIDER_CLIENT_ID');
  });
});

describe('wall: wire list normalizers (fixtures.wire)', () => {
  it('googleList: iCalUID is the identity, the opaque id is only the write handle (E1)', () => {
    const raw = fixtures.wire.googleList.response.items[0];
    const event = normalizeGoogleEvent(raw)!;
    expect(event).not.toBeNull();
    expect(event.uid).toBe(fixtures.wire.googleList.expect.uid);
    expect(event.start).toBe(fixtures.wire.googleList.expect.start);
    expect(event.remoteId).toBe(fixtures.wire.googleList.expect.remoteId);
    expect(raw.id).toBeDefined();
    expect(fixtures.wire.googleList.response.nextSyncToken).toBe(fixtures.wire.googleList.expect.nextSyncToken);
    // Mutation guard: keying identity on the opaque id re-duplicates pushed
    // events — the wall must go red if anyone reintroduces it.
    expect(event.uid).not.toBe(raw.id);
    // The cursor round-trips through the adapter.
    const row = catalog.providers.find((entry) => entry.id === 'google')!;
    expect(calendarAdapterFor(row.serviceConfig.calendar!.protocol)?.protocol).toBe('google-calendar');
  });

  it('graphList: iCalUId identity, categories verbatim', () => {
    const raw = fixtures.wire.graphList.response.value[0];
    const event = normalizeGraphEvent(raw)!;
    expect(event).not.toBeNull();
    expect(event.uid).toBe(fixtures.wire.graphList.expect.uid);
    expect(event.start).toBe(fixtures.wire.graphList.expect.start);
    expect(event.categories).toEqual(fixtures.wire.graphList.expect.categories);
    expect(event.remoteId).toBe(raw.id);
  });
});

describe('wall: Google write mapper (fixtures.wire.googleWrite)', () => {
  for (const [index, row] of fixtures.wire.googleWrite.entries()) {
    it(`[${index}] ${row.name}`, () => {
      const event = { ...row.event } as Parameters<typeof googleEventBody>[0];
      if ('expectError' in row) {
        expect(() => googleEventBody(event)).toThrowError(
          expect.objectContaining({ code: row.expectError })
        );
        return;
      }
      const body = googleEventBody(event) as unknown as Record<string, unknown>;
      for (const [path, expected] of Object.entries(row.expect)) {
        expect(dotted(body, path), `${row.name}: ${path}`).toEqual(expected);
      }
    });
  }

  it('all-day ends stay exclusive and clamp the single-day shorthand (E2)', () => {
    const passthrough = googleEventBody({
      summary: 'x',
      start: '2026-11-20',
      end: '2026-11-21',
      allDay: true,
    });
    expect(passthrough.end).toEqual({ date: '2026-11-21' });
    const clamped = googleEventBody({ summary: 'x', start: '2026-11-20', end: '2026-11-20', allDay: true });
    expect(clamped.end).toEqual({ date: '2026-11-21' });
  });

  it('recurrence writes are refused (E13/H1)', () => {
    try {
      googleEventBody({ summary: 'x', start: '2026-11-20', end: '2026-11-21', allDay: true, recurrence: 'FREQ=WEEKLY;COUNT=8' });
      expect.unreachable('recurrence write must refuse');
    } catch (error) {
      expect((error as ConnectorError).code).toBe('unsupported');
    }
  });
});

describe('wall: Graph write mapper (fixtures.wire.graphWrite)', () => {
  for (const [index, row] of fixtures.wire.graphWrite.entries()) {
    it(`[${index}] ${row.name}`, () => {
      const event = { ...row.event } as Parameters<typeof graphEventBody>[0];
      if ('expectError' in row) {
        expect(() => graphEventBody(event)).toThrowError(
          expect.objectContaining({ code: row.expectError })
        );
        return;
      }
      const body = graphEventBody(event) as unknown as Record<string, unknown>;
      for (const [path, expected] of Object.entries(row.expect)) {
        expect(dotted(body, path), `${row.name}: ${path}`).toEqual(expected);
      }
    });
  }

  it('categories write verbatim', () => {
    const body = graphEventBody({
      summary: 'Exam',
      start: '2026-11-12T09:00:00Z',
      end: '2026-11-12T10:00:00Z',
      allDay: false,
      categories: ['EXAM', 'Study'],
    });
    expect(body.categories).toEqual(['EXAM', 'Study']);
  });
});

describe('wall: Graph URL building (fixtures.wire.graphUrls)', () => {
  it.each(fixtures.wire.graphUrls.map((row, index) => [index, row] as const))(
    '[$index] user=%s calendar=%s',
    (_index, row) => {
      expect(graphBase(catalog.providers.find((entry) => entry.id === 'microsoft')!.serviceConfig.calendar!.apiBase!, row.user, row.calendarId || undefined)).toBe(row.expect);
    }
  );

  it('never emits the invalid /users/me path (E6 mutation guard)', () => {
    expect(graphBase('https://graph.microsoft.com/v1.0', 'me')).toBe('https://graph.microsoft.com/v1.0/me');
    expect(graphBase('https://graph.microsoft.com/v1.0', 'me', 'cal-1')).toBe('https://graph.microsoft.com/v1.0/me/calendars/cal-1');
    expect(graphBase('https://graph.microsoft.com/v1.0', 'me').includes('/users/me')).toBe(false);
  });
});

// Rev 6: the picker source and the bind-form descriptor are contract data.
describe('wall: calendar discovery rows (fixtures.wire.*CalendarList)', () => {
  it('googleCalendarList maps to the shared picker row shape', () => {
    const rows = (fixtures.wire.googleCalendarList.response.items as unknown[]).map((item) =>
      googleCalendarRow(item as never),
    );
    expect(rows).toHaveLength(fixtures.wire.googleCalendarList.expect.length);
    fixtures.wire.googleCalendarList.expect.forEach((want: Record<string, unknown>, index: number) => {
      for (const [key, value] of Object.entries(want)) {
        expect(rows[index][key as keyof typeof rows[0]], `${index}.${key}`).toEqual(value);
      }
    });
  });

  it('graphCalendarList maps to the shared picker row shape', () => {
    const rows = (fixtures.wire.graphCalendarList.response.value as unknown[]).map((item) =>
      graphCalendarRow(item as never),
    );
    expect(rows).toHaveLength(fixtures.wire.graphCalendarList.expect.length);
    fixtures.wire.graphCalendarList.expect.forEach((want: Record<string, unknown>, index: number) => {
      for (const [key, value] of Object.entries(want)) {
        expect(rows[index][key as keyof typeof rows[0]], `${index}.${key}`).toEqual(value);
      }
    });
  });
});

describe('wall: setupFields is the bind-form contract (fixtures.catalog.setupFields)', () => {
  const rows = catalog.providers.map((provider) => {
    const service = Object.values(provider.serviceConfig)[0]!;
    return { id: provider.id, protocol: service.protocol, fields: service.setupFields ?? [] };
  });

  it('every provider exposes a descriptor (no provider is unbindable)', () => {
    for (const row of rows) {
      expect(Array.isArray(row.fields), row.id).toBe(true);
    }
  });

  it('each protocol declares exactly the expected field kinds', () => {
    for (const [protocol, want] of Object.entries(fixtures.catalog.setupFields.perProtocol)) {
      const row = rows.find((entry) => entry.protocol === protocol);
      expect(row, `no provider speaks ${protocol}`).toBeDefined();
      expect(row!.fields.map((field) => field.kind), protocol).toEqual(want.kinds);
    }
  });

  it('every field carries a labelKey (consent copy is data, never app copy)', () => {
    for (const row of rows) {
      for (const field of row.fields) {
        expect(field.labelKey, `${row.id}.${field.key}`).toBeTruthy();
      }
    }
  });

  it('secret fields are scoped to the auth kind they belong to', () => {
    for (const [protocol, want] of Object.entries(fixtures.catalog.setupFields.perProtocol)) {
      const row = rows.find((entry) => entry.protocol === protocol)!;
      const secretKinds = [
        ...new Set(
          row.fields
            .filter((field) => field.kind === 'secret' && field.authKind)
            .map((field) => field.authKind),
        ),
      ].sort();
      expect(secretKinds, protocol).toEqual([...(want.secretAuthKinds as string[])].sort());
    }
  });
});

describe('wall: client-id env keys come from data, never a provider map', () => {
  it.each(fixtures.catalog.clientIdEnv.cases.map((row) => [row] as const))(
    '%s → %s',
    (row) => {
      expect(clientIdEnvFor(row.id, row.prefix)).toBe(row.expect);
    },
  );

  it('an unknown provider still derives a key (no hardcoded allowlist)', () => {
    expect(clientIdEnvFor('some-future-provider', 'DESKTOP')).toBe(
      'DESKTOP_SOME_FUTURE_PROVIDER_CLIENT_ID',
    );
  });
});

describe('wall: attribution is attributable-only (fixtures.attribution)', () => {
  it('the marker category constant matches the contract', () => {
    expect(SOURCE_CATEGORY).toBe(fixtures.attribution.sourceCategory);
  });

  it.each(fixtures.attribution.cases.map((row) => [row] as const))(
    '%s',
    (row) => {
      expect(isAttributable(row.event as never, fixtures.attribution.namespaces)).toBe(
        row.attributable,
      );
    },
  );
});

describe('wall: the wall itself runs every desktop-relevant row (E7)', () => {
  it('catalog, wire list, write mapper and URL rows all executed', () => {
    expect(fixtures.catalog.order.length).toBeGreaterThan(0);
    expect(fixtures.catalog.calendarProviders.length).toBeGreaterThan(0);
    expect(fixtures.catalog.scopeGrowth.length).toBeGreaterThan(0);
    expect(fixtures.wire.googleWrite.length).toBeGreaterThan(0);
    expect(fixtures.wire.graphWrite.length).toBeGreaterThan(0);
    expect(fixtures.wire.graphUrls.length).toBeGreaterThan(0);
    expect(fixtures.wire.googleCalendarList).toBeDefined();
    expect(fixtures.wire.graphCalendarList).toBeDefined();
    expect(fixtures.catalog.setupFields).toBeDefined();
    expect(fixtures.catalog.clientIdEnv.cases.length).toBeGreaterThan(0);
    expect(fixtures.attribution.cases.length).toBeGreaterThan(0);
    expect(providerIds).toEqual(fixtures.catalog.order);
  });
});
