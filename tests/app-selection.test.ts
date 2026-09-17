import { describe, expect, it, vi } from 'vitest';
import { ToolMessage } from '@langchain/core/messages';
import {
  APP_STICKY_TURNS,
  advanceStickyWindow,
  appMatchesQuery,
  bindSticky,
  buildAvailabilityHint,
  createAppSelectionMiddleware,
  normalizeTokens,
  selectApps,
  type SelectionApp,
  type StickyWindow,
} from '@main/ai/tools/app-selection';

function app(overrides: Partial<SelectionApp> = {}): SelectionApp {
  return {
    id: 'app-ha',
    name: 'Home Assistant',
    exposure: 'relevance',
    order: 0,
    tools: [
      { name: 'mcp__ha__get_status', description: 'Get device status', enabled: true, keywordTags: ['lights', 'status'] },
      { name: 'mcp__ha__control', description: 'Control a device', enabled: true, keywordTags: ['turn on', 'lights'] },
    ],
    ...overrides,
  };
}

const emptySticky: StickyWindow = { entries: new Map() };

describe('D17 matcher', () => {
  it('normalizes NFKD, diacritics and case, and stems plural tokens', () => {
    expect(normalizeTokens('Café-Lights ON!')).toEqual(['cafe', 'light', 'on']);
  });

  it('matches plural queries against singular tool-name tokens (HassMCP names)', () => {
    const hass = app({
      name: 'Home Assistant',
      tools: [{ name: 'mcp__homeassistant__light__HassTurnOn', description: '', enabled: true, keywordTags: [] }],
    });
    expect(appMatchesQuery('turn on the office lights', hass)).toBe(true);
    expect(appMatchesQuery('turn on the office light', hass)).toBe(true);
  });

  it('matches tag, tool-name and app-name tokens; multi-word tags as a token set', () => {
    const lights = app();
    expect(appMatchesQuery('turn the lights on', lights)).toBe(true);
    expect(appMatchesQuery('what is the get_status of the lamp', lights)).toBe(true);
    expect(appMatchesQuery('ask home assistant to help', lights)).toBe(true);
    expect(appMatchesQuery('dim the bedroom', lights)).toBe(false);
    const bedroomTag = app({
      tools: [{ name: 'mcp__ha__control', description: '', enabled: true, keywordTags: ['bedroom lights'] }],
    });
    expect(appMatchesQuery('dim the bedroom lights now', bedroomTag)).toBe(true);
    expect(appMatchesQuery('the lights in the bedroom are on', bedroomTag)).toBe(true);
  });

  it('never substring-matches (light does not hit flight)', () => {
    expect(appMatchesQuery('book a flight to oslo', app())).toBe(false);
  });

  it('never matches an empty query', () => {
    expect(appMatchesQuery('', app())).toBe(false);
  });
});

describe('selection decisions', () => {
  it('binds always-apps unconditionally and relevance-apps on match', () => {
    const always = app({ id: 'app-always', name: 'Core', exposure: 'always', order: 0 });
    const relevance = app({ id: 'app-ha', name: 'Home Assistant', order: 1 });
    const result = selectApps({
      apps: [always, relevance],
      query: 'turn on the lights',
      totalToolCount: 12,
      nonAppToolCount: 8,
      sticky: emptySticky,
    });
    expect(result.decisions.map((decision) => decision.reason)).toEqual(['always', 'match']);
    expect(result.keptToolNames).toContain('mcp__ha__get_status');
    expect(result.hintAppIds).toEqual([]);
  });

  it('drops no-match apps and records them as hint candidates (D16)', () => {
    const result = selectApps({
      apps: [app()],
      query: 'what is the capital of france',
      totalToolCount: 10,
      nonAppToolCount: 10,
      sticky: emptySticky,
    });
    expect(result.decisions[0].reason).toBe('no-match');
    expect(result.keptToolNames).toEqual([]);
    expect(result.hintAppIds).toEqual(['app-ha']);
  });

  it('skips apps whose tools are all disabled (unbound everywhere — D3 layer 1)', () => {
    const disabled = app({
      tools: app().tools.map((tool) => ({ ...tool, enabled: false })),
    });
    const result = selectApps({
      apps: [disabled],
      query: 'turn on the lights',
      totalToolCount: 5,
      nonAppToolCount: 5,
      sticky: emptySticky,
    });
    expect(result.decisions).toEqual([]);
  });

  it('keeps single-app misses degrading to not binding (never an error)', () => {
    const result = selectApps({
      apps: [app()],
      query: 'hello',
      totalToolCount: 0,
      nonAppToolCount: 0,
      sticky: emptySticky,
    });
    expect(result.keptToolNames).toEqual([]);
    expect(result.overBudget).toBe(false);
  });
});

describe('D15 stickiness', () => {
  it('keeps a matched app bound through the follow-up window, then drops it', () => {
    let sticky = bindSticky(emptySticky, ['app-ha']);
    expect(sticky.entries.get('app-ha')).toBe(APP_STICKY_TURNS);
    sticky = advanceStickyWindow(sticky);
    const turn2 = selectApps({
      apps: [app()],
      query: 'now the bedroom too',
      totalToolCount: 12,
      nonAppToolCount: 10,
      sticky,
    });
    expect(turn2.decisions[0].reason).toBe('sticky');
    sticky = advanceStickyWindow(sticky);
    const turn3 = selectApps({
      apps: [app()],
      query: 'and the kitchen',
      totalToolCount: 12,
      nonAppToolCount: 10,
      sticky,
    });
    expect(turn3.decisions[0].reason).toBe('no-match');
  });

  it('refreshes the window on every re-match', () => {
    let sticky = bindSticky(emptySticky, ['app-ha']);
    sticky = advanceStickyWindow(sticky);
    sticky = bindSticky(sticky, ['app-ha']);
    expect(sticky.entries.get('app-ha')).toBe(APP_STICKY_TURNS);
  });

  it('never resurrects a disabled app (disable wins over stickiness)', () => {
    const sticky = bindSticky(emptySticky, ['app-ha']);
    const disabled = app({ tools: app().tools.map((tool) => ({ ...tool, enabled: false })) });
    const result = selectApps({
      apps: [disabled],
      query: 'anything at all',
      totalToolCount: 5,
      nonAppToolCount: 5,
      sticky,
    });
    expect(result.decisions).toEqual([]);
  });
});

describe('budget guard', () => {
  const manyTools = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      name: `${prefix}_${index}`,
      description: '',
      enabled: true,
      keywordTags: [],
    }));

  it('drops whole apps in exposure-class order then spec order', () => {
    const first = app({ id: 'app-1', name: 'Alpha', order: 0 });
    const second = app({ id: 'app-2', name: 'Beta', tools: manyTools('beta', 6), order: 1 });
    const third = app({ id: 'app-3', name: 'Gamma', tools: manyTools('gamma', 6), order: 2 });
    const result = selectApps({
      apps: [first, second, third],
      query: 'alpha beta gamma',
      totalToolCount: 20,
      nonAppToolCount: 16,
      sticky: emptySticky,
      budget: 24,
    });
    expect(result.decisions.find((decision) => decision.appId === 'app-1')?.reason).toBe('budget-drop');
    expect(result.decisions.find((decision) => decision.appId === 'app-2')?.reason).toBe('budget-drop');
    expect(result.decisions.find((decision) => decision.appId === 'app-3')?.reason).toBe('match');
  });

  it('drops sticky-bound apps last among non-always', () => {
    const stickyApp = app({ id: 'app-sticky', name: 'StickyApp', tools: manyTools('sticky', 4), order: 0 });
    const matched = app({ id: 'app-match', name: 'MatchApp', tools: manyTools('match', 4), order: 1 });
    const result = selectApps({
      apps: [stickyApp, matched],
      query: 'matchapp please',
      totalToolCount: 14,
      nonAppToolCount: 6,
      sticky: bindSticky(emptySticky, ['app-sticky']),
      budget: 10,
    });
    expect(result.decisions.find((decision) => decision.appId === 'app-match')?.reason).toBe('budget-drop');
    expect(result.decisions.find((decision) => decision.appId === 'app-sticky')?.reason).toBe('sticky');
  });

  it('never drops always-bound apps; over-budget with only always left warns only (budget floor)', () => {
    const always = app({ id: 'app-always', name: 'Core', exposure: 'always', tools: manyTools('core', 24), order: 0 });
    const relevance = app({ id: 'app-rel', name: 'Rel', tools: manyTools('rel', 4), order: 1 });
    const result = selectApps({
      apps: [always, relevance],
      query: 'rel',
      totalToolCount: 28,
      nonAppToolCount: 0,
      sticky: emptySticky,
      budget: 20,
    });
    expect(result.decisions.find((decision) => decision.appId === 'app-always')?.reason).toBe('always');
    expect(result.decisions.find((decision) => decision.appId === 'app-rel')?.reason).toBe('budget-drop');
    expect(result.overBudget).toBe(true);
  });
});

describe('D16 availability hint', () => {
  it('returns null without dropped apps', () => {
    expect(buildAvailabilityHint([])).toBeNull();
  });

  it('renders fenced, capped reference data', () => {
    const hint = buildAvailabilityHint([
      { appName: 'Home Assistant', description: 'Controls lights and devices at home' },
    ]);
    expect(hint).toContain('[Apps available');
    expect(hint).toContain('Home Assistant — Controls lights and devices at home');
  });

  it('enforces the hard cap', () => {
    const hint = buildAvailabilityHint(
      Array.from({ length: 50 }, (_, index) => ({
        appName: `App ${index}`,
        description: 'x'.repeat(200),
      }))
    );
    expect(hint!.length).toBeLessThanOrEqual(400);
  });
});

describe('selection middleware', () => {
  const makeRequest = (toolNames: string[]) =>
    ({
      tools: toolNames.map((name) => ({ name })),
      systemMessage: {
        concat: (suffix: string) => `system+${suffix}`,
      },
    }) as never;

  it('filters request.tools to the bound set and appends the hint', async () => {
    const middleware = createAppSelectionMiddleware({
      keptToolNames: ['native_one', 'mcp__ha__get_status'],
      droppedToolNames: ['mcp__ha__control'],
      guidance: 'HINT',
    }) as { wrapModelCall: (request: never, handler: (request: unknown) => Promise<unknown>) => Promise<{ tools: { name: string }[]; systemMessage: string }> };
    const result = (await middleware.wrapModelCall(
      makeRequest(['native_one', 'mcp__ha__get_status', 'mcp__ha__control']) as never,
      async (request) => request
    )) as { tools: { name: string }[]; systemMessage: string };
    expect(result.tools.map((tool) => tool.name)).toEqual(['native_one', 'mcp__ha__get_status']);
    expect(result.systemMessage).toContain('HINT');
  });

  it('rejects a dropped app tool without executing it (wrapToolCall guard)', async () => {
    const middleware = createAppSelectionMiddleware({
      keptToolNames: ['mcp__ha__get_status'],
      droppedToolNames: ['mcp__ha__control'],
      hint: null,
    }) as { wrapToolCall: (request: never, handler: () => Promise<string>) => Promise<ToolMessage> };
    const executed = vi.fn();
    const result = await middleware.wrapToolCall(
      { toolCall: { name: 'mcp__ha__control', args: {}, id: 'call_1' } } as never,
      async () => {
        executed();
        return 'executed';
      }
    );
    expect(executed).not.toHaveBeenCalled();
    expect(ToolMessage.isInstance(result)).toBe(true);
    expect((result as ToolMessage).tool_call_id).toBe('call_1');
  });

  it('lets bound tools through untouched (D14 — the approved tool executes)', async () => {
    const middleware = createAppSelectionMiddleware({
      keptToolNames: ['mcp__ha__control'],
      droppedToolNames: [],
      hint: null,
    }) as { wrapToolCall: (request: never, handler: () => Promise<string>) => Promise<string> };
    const result = await middleware.wrapToolCall(
      { toolCall: { name: 'mcp__ha__control', args: {}, id: 'call_2' } } as never,
      async () => 'executed'
    );
    expect(result).toBe('executed');
  });
});

describe('sticky window mechanics', () => {
  it('is thread-scoped state the caller owns', () => {
    const threadA = bindSticky(emptySticky, ['app-ha']);
    const threadB = emptySticky;
    expect(threadA.entries.has('app-ha')).toBe(true);
    expect(threadB.entries.size).toBe(0);
  });
});

describe('scripted follow-up (D15 through selectApps)', () => {
  it('re-match on a later turn refreshes and rebinds', () => {
    let sticky = bindSticky(emptySticky, ['app-ha']);
    sticky = advanceStickyWindow(sticky);
    sticky = advanceStickyWindow(sticky);
    expect(sticky.entries.has('app-ha')).toBe(false);
    const rebound = selectApps({
      apps: [app()],
      query: 'home assistant, dim the lights',
      totalToolCount: 12,
      nonAppToolCount: 10,
      sticky,
    });
    expect(rebound.decisions[0].reason).toBe('match');
  });
});
