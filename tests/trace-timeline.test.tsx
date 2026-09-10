// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { traceTimelineEntries } from '@renderer/chat-react/TraceTimeline';
import { TurnTraceStep } from '@shared/turns';
import { TEXT } from '@shared/constants/text';

const step = (overrides: Partial<TurnTraceStep>): TurnTraceStep => ({
  id: 's1',
  phase: 'thinking',
  label: 'Thinking',
  startedAt: 1000,
  endedAt: 1400,
  ...overrides,
});

describe('traceTimelineEntries', () => {
  it('maps tool calls to tool entries with durations', () => {
    const entries = traceTimelineEntries([
      step({ phase: 'thinking' }),
      step({ phase: 'tool_call', toolName: 'web_search', label: 'web_search', summary: 'query=kubernetes', startedAt: 1400, endedAt: 2100 }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'phase', label: TEXT.TRACE_PHASE_THINKING, durationMs: 400 });
    expect(entries[1]).toMatchObject({ kind: 'tool', label: 'web_search', detail: 'query=kubernetes', durationMs: 700 });
  });

  it('maps tool results to observable tool entries with status and response', () => {
    const entries = traceTimelineEntries([
      step({ phase: 'tool_result', summary: 'ok', status: 'ok', response: 'full response text' }),
    ]);
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      label: TEXT.TRACE_PHASE_TOOL_RESULT,
      status: 'ok',
      response: 'full response text',
    });

    const failed = traceTimelineEntries([
      step({ phase: 'tool_result', summary: 'Failed: denied', status: 'error', response: 'denied' }),
    ]);
    expect(failed[0]).toMatchObject({ status: 'error' });
  });

  it('returns an empty list without steps', () => {
    expect(traceTimelineEntries(undefined)).toEqual([]);
  });

  it('falls back to the compact badge when no tools were called (no "0 tools")', async () => {
    const { TraceTimeline } = await import('@renderer/chat-react/TraceTimeline');
    const { container } = render(<TraceTimeline meta={{ outcome: 'ok', model: 'mini', durationMs: 1900 }} />);
    expect(container.querySelector('[data-as="chat-trace-timeline"]')).toBeNull();
    expect(container.querySelector('[data-as="chat-trace-meta"]')).toBeTruthy();
    expect(container.textContent).toContain('1.9 s');
    expect(container.textContent).not.toContain('0');
  });

  it('ticks the elapsed time for live turns', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const { TraceTimeline } = await import('@renderer/chat-react/TraceTimeline');
      const { container } = render(
        <TraceTimeline meta={{ outcome: 'ok', steps: [{ id: 's1', phase: 'tool_call', label: 'web_search', toolName: 'web_search', startedAt: 1, endedAt: 2 }] }} startedAt={startedAt} />
      );
      expect(container.textContent).toContain('0 ms');
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(container.textContent).toContain('400 ms');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TraceTimeline in expanded mode', () => {
  beforeAll(() => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      });
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  afterEach(cleanup);

  const ACTIVE_CONV = {
    id: 'conv-1',
    title: 'Test',
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    messages: [
      {
        id: 'msg-a',
        content: 'Here is the answer.',
        role: 'assistant',
        metadata: {
          outcome: 'ok',
          model: 'mini',
          durationMs: 1900,
          steps: [
            { id: 's1', phase: 'thinking', label: 'Thinking', startedAt: 1000, endedAt: 1400 },
            { id: 's2', phase: 'tool_call', label: 'web_search', toolName: 'web_search', startedAt: 1400, endedAt: 2100, summary: 'query=weather' },
          ],
        },
        conversationId: 'conv-1',
        createdAt: new Date(),
      },
    ],
  };

  it('renders the timeline under the assistant reply when trace details are on', async () => {
    const { ChatApp } = await import('@renderer/chat-react/ChatApp');
    const { DEFAULT_CONFIG } = await import('@shared/config/AppConfig');
    let toggleExpand: (() => void) | null = null;
    window.electronAPI = {
      loadConfig: vi.fn(async () => ({
        ...DEFAULT_CONFIG,
        behavior: { ...DEFAULT_CONFIG.behavior, traceDetails: true },
      })),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async () => ({ ...ACTIVE_CONV, messages: [...ACTIVE_CONV.messages] })),
      getAllConversations: vi.fn(async () => [ACTIVE_CONV]),
      onTurnEvent: vi.fn(() => () => {}),
      startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1' })),
      cancelTurn: vi.fn(async () => true),
      resumeTurn: vi.fn(async () => true),
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      resizeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn((cb: () => void) => {
        toggleExpand = cb;
        return () => {};
      }),
      onFocusInput: vi.fn(() => () => {}),
      getScreenSources: vi.fn(async () => []),
      setConversationMetadata: vi.fn(async () => {}),
    } as unknown as typeof window.electronAPI;

    render(<ChatApp onThemeChange={() => {}} />);
    await screen.findByRole('textbox');
    await act(async () => {
      toggleExpand?.();
    });
    fireEvent.click(await screen.findByTitle(TEXT.LAUNCHER_HISTORY_SHOW));
    fireEvent.click(await screen.findByText('Test'));

    const main = document.querySelector('[role=main]') as HTMLElement;
    await within(main).findByText('Here is the answer.');
    const toggle = within(main).getByRole('button', { name: TEXT.TRACE_TIMELINE_TOGGLE });
    fireEvent.click(toggle);
    expect(await within(main).findByText('web_search')).toBeTruthy();
    expect(within(main).getByText(TEXT.TRACE_PHASE_THINKING)).toBeTruthy();
    expect(within(main).getByRole('button', { name: TEXT.TRACE_TIMELINE_TOGGLE }).textContent).toContain('1 tools');
  });
});

describe('TraceTimeline in expanded mode', () => {
  beforeAll(() => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      });
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  afterEach(cleanup);

  const ACTIVE_CONV = {
    id: 'conv-1',
    title: 'Test',
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    messages: [
      {
        id: 'msg-a',
        content: 'Here is the answer.',
        role: 'assistant',
        metadata: {
          outcome: 'ok',
          model: 'mini',
          durationMs: 1900,
          steps: [
            { id: 's1', phase: 'thinking', label: 'Thinking', startedAt: 1000, endedAt: 1400 },
            { id: 's2', phase: 'tool_call', label: 'web_search', toolName: 'web_search', startedAt: 1400, endedAt: 2100, summary: 'query=weather' },
          ],
        },
        conversationId: 'conv-1',
        createdAt: new Date(),
      },
    ],
  };

  it('renders the timeline under the assistant reply when trace details are on', async () => {
    const { ChatApp } = await import('@renderer/chat-react/ChatApp');
    const { DEFAULT_CONFIG } = await import('@shared/config/AppConfig');
    let toggleExpand: (() => void) | null = null;
    window.electronAPI = {
      loadConfig: vi.fn(async () => ({
        ...DEFAULT_CONFIG,
        behavior: { ...DEFAULT_CONFIG.behavior, traceDetails: true },
      })),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async () => ({ ...ACTIVE_CONV, messages: [...ACTIVE_CONV.messages] })),
      getAllConversations: vi.fn(async () => [ACTIVE_CONV]),
      onTurnEvent: vi.fn(() => () => {}),
      startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1' })),
      cancelTurn: vi.fn(async () => true),
      resumeTurn: vi.fn(async () => true),
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      resizeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn((cb: () => void) => {
        toggleExpand = cb;
        return () => {};
      }),
      onFocusInput: vi.fn(() => () => {}),
      getScreenSources: vi.fn(async () => []),
      setConversationMetadata: vi.fn(async () => {}),
    } as unknown as typeof window.electronAPI;

    render(<ChatApp onThemeChange={() => {}} />);
    await screen.findByRole('textbox');
    await act(async () => {
      toggleExpand?.();
    });
    fireEvent.click(await screen.findByTitle(TEXT.LAUNCHER_HISTORY_SHOW));
    fireEvent.click(await screen.findByText('Test'));

    await screen.findByText('Here is the answer.');
    const toggles = screen.getAllByRole('button', { name: TEXT.TRACE_TIMELINE_TOGGLE });
    const describe = (el: Element): string => {
      const chain: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== document.body) {
        const da = cur.getAttribute('data-as');
        if (da) chain.push(da);
        cur = cur.parentElement;
      }
      return chain.join('>');
    };
    const htmlInfo = (el: Element): string => {
      const p = el.closest('[role=main]') ? 'in-main' : 'outside-main';
      return p + '|' + el.outerHTML.slice(0, 160);
    };
    console.log('NTIMELINES ' + toggles.length
      + ' msgs ' + document.querySelectorAll('[data-as=chat-message]').length
      + ' | t0 ' + describe(toggles[0]) + ' t1 ' + describe(toggles[1])
      + ' | mains ' + document.querySelectorAll('[role=main]').length
      + ' bodyKids ' + Array.from(document.body.children).map((k) => '[' + (k.id || k.getAttribute('role') || k.tagName) + ' ' + k.innerHTML.slice(0, 60) + ']').join(' ;; ')
      + ' | t0 ' + htmlInfo(toggles[0]));
    const toggle = toggles[0];
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(await screen.findByText('web_search')).toBeTruthy();
    expect(screen.getByText(TEXT.TRACE_PHASE_THINKING)).toBeTruthy();
  });
});

describe('TraceTimeline tool-result viewer affordance', () => {
  beforeAll(() => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      });
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
  });

  afterEach(cleanup);

  it('offers a view-screenshot chip for image-bearing tool results and opens the viewer', async () => {
    const { TraceTimeline } = await import('@renderer/chat-react/TraceTimeline');
    const openViewer = vi.fn(async () => true);
    window.electronAPI = {
      openToolResultViewer: openViewer,
    } as unknown as typeof window.electronAPI;

    render(
      <TraceTimeline
        meta={{
          outcome: 'ok',
          steps: [
            { id: 'tool_call_1', phase: 'tool_call', label: 'screen_capture', toolName: 'screen_capture', startedAt: 1, endedAt: 2 },
            { id: 'tool_call_1', phase: 'tool_result', label: 'Tool result', toolName: 'screen_capture', startedAt: 2, endedAt: 3, hasImages: true },
            { id: 'tool_call_2', phase: 'tool_result', label: 'Tool result', toolName: 'web_search', startedAt: 3, endedAt: 4 },
          ],
        }}
      />
    );

    const chip = screen.getByRole('button', { name: TEXT.TOOL_RESULT_VIEW_SCREENSHOT });
    fireEvent.click(chip);
    expect(openViewer).toHaveBeenCalledWith('tool_call_1');
  });

  it('renders no chip when no tool result carries images', async () => {
    const { TraceTimeline } = await import('@renderer/chat-react/TraceTimeline');
    window.electronAPI = {} as unknown as typeof window.electronAPI;

    const { container } = render(
      <TraceTimeline
        meta={{
          outcome: 'ok',
          steps: [{ id: 'tool_call_2', phase: 'tool_result', label: 'Tool result', toolName: 'web_search', startedAt: 3, endedAt: 4 }],
        }}
      />
    );
    expect(screen.queryByRole('button', { name: TEXT.TOOL_RESULT_VIEW_SCREENSHOT })).toBeNull();
    expect(container.querySelector('[data-as="chat-trace-timeline"]')).toBeTruthy();
  });
});
