import { describe, it, expect } from 'vitest';
import { ContextDigestService, findCandidateTool, DIGEST_TTL_MS } from '@main/ai/tools/apps/context-digests';
import { homeAssistantDigestProvider } from '@main/ai/tools/apps/context-providers/home-assistant';
import { renderAppDigest } from '@shared/ai/app-context';
import type { McpServerConfig } from '@shared/mcp';

const server = {
  id: 'srv-1',
  name: 'homeassistant',
  transport: { type: 'http', url: 'http://ha.local:8124/mcp' },
  enabled: true,
} as unknown as McpServerConfig;

const pagePayload = {
  states: [
    { entity_id: 'light.office', attributes: { friendly_name: 'Γραφείο' } },
    { entity_id: 'light.bedroom', friendly_name: 'Bedroom Light' },
    { entity_id: 'switch.plug', name: 'Desk plug' },
  ],
};

function makeService(overrides: { payload?: unknown; invokeError?: Error; noTools?: boolean } = {}) {
  const calls: string[] = [];
  let clock = 0;
  const service = new ContextDigestService(
    {
      listTools: async () => (overrides.noTools ? [] : [{ name: 'mcp__homeassistant__live_HassGetLiveContext' }]),
      invokeTool: async (_server, toolName) => {
        calls.push(toolName);
        if (overrides.invokeError) throw overrides.invokeError;
        return overrides.payload ?? pagePayload;
      },
      now: () => clock,
    },
    DIGEST_TTL_MS
  );
  service.register('home-assistant', homeAssistantDigestProvider);
  return { service, calls, setClock: (value: number) => (clock = value) };
}

const digestFor = (service: ContextDigestService, entityAllowed?: (id: string) => boolean) =>
  service.digestFor({
    capability: 'home-assistant',
    appName: 'Home Assistant',
    server,
    ...(entityAllowed ? { entityAllowed } : {}),
  });

describe('ContextDigestService', () => {
  it('renders a fresh digest from the provider payload', async () => {
    const { service } = makeService();
    const text = await digestFor(service);
    expect(text).toContain('[App context — Home Assistant]');
    expect(text).toContain('- light.office — Γραφείο');
    expect(text).toContain('- light.bedroom — Bedroom Light');
    expect(text).toContain('- switch.plug — Desk plug');
    expect(text).not.toContain('min old');
  });

  it('serves the cache within the TTL without re-invoking (single fetch)', async () => {
    const { service, calls, setClock } = makeService();
    await digestFor(service);
    setClock(DIGEST_TTL_MS - 1000);
    await digestFor(service);
    expect(calls).toHaveLength(1);
  });

  it('refreshes after TTL expiry and reports the stale age when that refresh fails', async () => {
    let fail = false;
    let clock = 0;
    const service = new ContextDigestService(
      {
        listTools: async () => (fail ? [] : [{ name: 'HassGetLiveContext' }]),
        invokeTool: async () => {
          if (fail) throw new Error('server down');
          return pagePayload;
        },
        now: () => clock,
      },
      DIGEST_TTL_MS
    );
    service.register('home-assistant', homeAssistantDigestProvider);
    const fresh = await digestFor(service);
    expect(fresh).not.toContain('min old');
    clock = DIGEST_TTL_MS + 60_000;
    fail = true;
    const stale = await digestFor(service);
    expect(stale).toContain('min old');
    expect(stale).toContain('light.office');
  });

  it('single-flights concurrent refreshes into one tool call', async () => {
    const { service, calls } = makeService();
    await Promise.all([digestFor(service), digestFor(service), digestFor(service)]);
    expect(calls).toHaveLength(1);
  });

  it('invalidation forces a re-fetch despite the TTL', async () => {
    const { service, calls, setClock } = makeService();
    await digestFor(service);
    service.invalidate(server.id);
    setClock(1000);
    await digestFor(service);
    expect(calls).toHaveLength(2);
  });

  it('peeks the cache for the settings readout without fetching (plan 23 S6)', async () => {
    const { service, calls, setClock } = makeService();
    expect(service.peek(server.id)).toBeNull();
    await digestFor(service);
    expect(service.peek(server.id)).toMatchObject({ entities: 3, ageMinutes: 0 });
    setClock(2 * 60000);
    expect(service.peek(server.id)?.ageMinutes).toBe(2);
    expect(calls).toHaveLength(1);
    service.invalidate('unknown');
    expect(service.peek('unknown')).toBeNull();
  });

  it('absent provider or capability proceeds digest-less (D13)', async () => {
    const { service } = makeService({ noTools: true });
    expect(await service.digestFor({ appName: 'Nope', server })).toBeNull();
    expect(await service.digestFor({ capability: 'unknown-app', appName: 'Unknown', server })).toBeNull();
  });

  it('fails soft: tool error with no cache → null (D5)', async () => {
    const { service } = makeService({ invokeError: new Error('boom') });
    expect(await digestFor(service)).toBeNull();
  });

  it('filters rows by entity scope at render time (D10); the cache holds raw rows', async () => {
    const { service, calls, setClock } = makeService();
    await digestFor(service);
    setClock(2000);
    const filtered = await digestFor(service, (id) => id.startsWith('light.'));
    expect(filtered).toContain('light.office');
    expect(filtered).toContain('light.bedroom');
    expect(filtered).not.toContain('switch.plug');
    expect(calls).toHaveLength(1);
  });

  it('caps rows so oversized catalogs stay bounded (D4 caps)', async () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      entity_id: `light.l${index}`,
      friendly_name: `Light ${index}`,
    }));
    const { service } = makeService({ payload: { states: many } });
    const text = await digestFor(service);
    expect(text).toContain('more not listed');
    expect(text!.length).toBeLessThanOrEqual(1400);
  });

  it('matches candidate tools across domain-prefixed namespacing', () => {
    expect(findCandidateTool(['mcp__homeassistant__live_HassGetLiveContext'], homeAssistantDigestProvider.toolCandidates)).toBe(
      'mcp__homeassistant__live_HassGetLiveContext'
    );
    expect(findCandidateTool(['HassTurnOff'], homeAssistantDigestProvider.toolCandidates)).toBeNull();
  });
});

describe('homeAssistantDigestProvider.render', () => {
  it('parses JSON strings and tolerates shape variants', () => {
    const rows = homeAssistantDigestProvider.render(
      JSON.stringify({ states: [{ entity_id: 'light.a', attributes: { friendly_name: 'A' } }] })
    );
    expect(rows).toEqual([{ id: 'light.a', label: 'A' }]);
    expect(homeAssistantDigestProvider.render({ nope: true })).toBeNull();
    expect(homeAssistantDigestProvider.render('not json')).toBeNull();
    expect(homeAssistantDigestProvider.render({ states: [] })).toBeNull();
  });

    it('renders the canonical registry area when the payload carries it (S7b fix)', () => {
      const rows = homeAssistantDigestProvider.render({
        states: [
          { entity_id: 'light.office_ceiling', friendly_name: 'Office Ceiling Light 1', area_name: 'Office' },
          { entity_id: 'light.plain', friendly_name: 'No area listed' },
        ],
      });
      expect(rows?.[0]).toEqual({ id: 'light.office_ceiling', label: 'Office Ceiling Light 1 · area: Office' });
      expect(rows?.[1]).toEqual({ id: 'light.plain', label: 'No area listed' });
    });
});

describe('renderAppDigest (shared pure)', () => {
  it('returns null for empty rows and marks the age when stale', () => {
    expect(renderAppDigest('HA', [])).toBeNull();
    expect(renderAppDigest('HA', [{ id: 'light.a', label: 'A' }])).toContain('light.a');
    expect(renderAppDigest('HA', [{ id: 'light.a', label: 'A' }], 12)).toContain('12 min old');
  });
});
