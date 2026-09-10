// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '@renderer/chat-react/Inspector';
import type { TurnTraceStep } from '@shared/turns';
import type { ChatMessageView } from '@neuronection/assistant-ui/chat-core';

const steps: TurnTraceStep[] = [
  { id: 't1', phase: 'thinking', label: 'Thinking', startedAt: 1000, endedAt: 2400 },
  {
    id: 't2',
    phase: 'tool_call',
    label: 'Searching the web',
    toolName: 'web_search',
    startedAt: 2400,
    endedAt: 3200,
    summary: 'query: cats',
    detail: { query: 'cats', results: 3 },
  },
];

afterEach(() => cleanup());

function baseProps(overrides: Partial<Parameters<typeof Inspector>[0]> = {}) {
  return {
    live: null,
    liveTrace: { phase: null, startedAt: null, steps: [] },
    lastAssistant: null,
    lastUserAttachments: [],
    activeModel: null,
    modelProviders: [],
    onModelChange: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
}

describe('Inspector', () => {
  it('shows turn meta badges from the persisted trace', () => {
    const lastAssistant = {
      id: 'a1',
      role: 'assistant',
      content: 'done',
      status: 'done',
      meta: { outcome: 'ok', model: 'test-model', durationMs: 2400, steps },
    } as unknown as ChatMessageView;
    render(<Inspector {...baseProps({ lastAssistant })} />);

    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.getByText('test-model')).toBeTruthy();
    expect(screen.getByText('2.4s')).toBeTruthy();
    expect(screen.getByText('Thinking')).toBeTruthy();
    expect(screen.getByText('Searching the web')).toBeTruthy();
  });

  it('expands a step to reveal its detail and copy button', () => {
    const lastAssistant = {
      id: 'a1',
      role: 'assistant',
      content: 'done',
      status: 'done',
      meta: { outcome: 'ok', steps },
    } as unknown as ChatMessageView;
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<Inspector {...baseProps({ lastAssistant })} />);

    fireEvent.click(screen.getByRole('button', { name: /Searching the web/ }));
    expect(screen.getByText(/"query": "cats"/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('query'));
    vi.unstubAllGlobals();
  });

  it('lists the last user attachments and reports export clicks', () => {
    const lastUserAttachments = [{ name: 'notes.pdf', isImage: false }];
    const onExport = vi.fn();
    render(<Inspector {...baseProps({ lastUserAttachments, onExport })} />);

    expect(screen.getByText('notes.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Markdown/ }));
    expect(onExport).toHaveBeenCalledWith('md');
    fireEvent.click(screen.getByRole('button', { name: /JSON/ }));
    expect(onExport).toHaveBeenCalledWith('json');
  });

  it('renders the live phase while a turn is running', () => {
    render(
      <Inspector
        {...baseProps({
          live: { status: 'streaming' } as never,
          liveTrace: { phase: 'streaming', startedAt: 1000, steps: steps.slice(0, 1) },
        })}
      />
    );
    expect(screen.getByText('Streaming')).toBeTruthy();
  });
});

describe('Inspector tools catalog', () => {
  it('discloses a searchable tool catalog on demand', () => {
    const catalog = [
      { name: 'run_shell', description: 'Run a shell command.', scope: 'destructive', example: '/shell ls -la' },
      { name: 'screen_capture', description: 'Capture the screen.', scope: 'read-only', example: '/screenshot' },
    ];
    render(<Inspector {...baseProps({ catalog })} />);
    expect(screen.queryByText('run_shell')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    expect(screen.getByText('run_shell')).toBeTruthy();
    expect(screen.getByText('screen_capture')).toBeTruthy();
    expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
  });

  it('hides the tools section entirely without a catalog', () => {
    render(<Inspector {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /tools/i })).toBeNull();
  });
});
