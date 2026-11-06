// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { LauncherMetaRow } from '@renderer/chat-react/areas/LauncherMetaRow';
import type { TurnTraceStep } from '@shared/turns';
import type { TurnMetadata } from '@shared/schema/turnMetadata';

const steps: TurnTraceStep[] = [
  { id: 't1', phase: 'thinking', label: 'Thinking', startedAt: 1000, endedAt: 2400 },
  { id: 't2', phase: 'tool_call', label: 'Searching the web', toolName: 'web_search', startedAt: 2400, endedAt: 3200, summary: 'query: cats' },
  { id: 't3', phase: 'thinking', label: 'Composing', startedAt: 3200 },
  { id: 't4', phase: 'thinking', label: 'Resumed step', startedAt: 3300, resumed: true },
];

const meta = {
  outcome: 'ok',
  model: 'demo-model',
  durationMs: 5000,
  toolCount: 2,
} as TurnMetadata;

afterEach(() => cleanup());

function renderRow(options: { live?: boolean; doneMeta?: TurnMetadata; count?: number } = {}) {
  return render(
    <LauncherMetaRow
      messageCount={options.count ?? 2}
      live={options.live ?? true}
      phase="thinking"
      startedAt={1000}
      steps={steps}
      doneMeta={options.doneMeta}
      onToggleExpand={vi.fn()}
      onNewConversation={vi.fn()}
    />
  );
}

describe('LauncherMetaRow', () => {
  it('keeps the live status and steps in the persistent meta line', () => {
    const { container } = renderRow();
    expect(container.querySelector('[data-status-mode]')?.getAttribute('data-status-mode')).toBe('live');
    expect(screen.getByText('2 messages')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Thinking' })).toBeTruthy();
    expect(screen.getByText(/4 steps/)).toBeTruthy();
  });

  it('expands the full step list below the row on demand', () => {
    renderRow();
    expect(screen.queryByText('Composing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /4 steps/ }));
    expect(screen.getByText('Composing')).toBeTruthy();
    expect(screen.getByText('resumed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /4 steps/ }));
    expect(screen.queryByText('Composing')).toBeNull();
  });

  it('swaps the live summary for completed trace meta without removing the row', () => {
    const { container, rerender } = renderRow();
    const row = container.querySelector('[data-launcher-meta-row]');
    expect(row?.getAttribute('data-status-mode')).toBe('live');

    rerender(
      <LauncherMetaRow
        messageCount={2}
        live={false}
        phase={null}
        startedAt={null}
        steps={steps}
        doneMeta={meta}
        onToggleExpand={vi.fn()}
        onNewConversation={vi.fn()}
      />
    );

    expect(container.querySelector('[data-launcher-meta-row]')).toBe(row);
    expect(row?.getAttribute('data-status-mode')).toBe('done');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
