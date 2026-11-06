// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { RunActions, RunSummary, formatRunClock, formatRunDuration } from '@renderer/shared/runSummary';

afterEach(cleanup);

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  expect(results.violations.map((violation) => violation.id).join(',')).toBe('');
}

describe('RunSummary (plan 54)', () => {
  const base = {
    status: 'done',
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_042_000,
    engineId: 'systemone:prov-1:jev-1',
    execution: {
      decision: { providerId: 'prov-1', providerName: 'OpenRouter', model: 'jev-1' },
      llm: { providerId: 'prov-2', providerName: 'OpenAI', model: 'gpt-x' },
    },
    actualCalls: 5,
    inputTokens: 900,
    outputTokens: 120,
  };

  it('renders the execution facts once: engine, decision model, LLM model, elapsed, finished, calls, tokens', () => {
    render(<RunSummary run={base} />);
    const text = screen.getByTestId('run-summary').textContent ?? '';
    expect(text).toContain('systemone:jev-1');
    expect(text).toContain('OpenRouter · jev-1');
    expect(text).toContain('OpenAI · gpt-x');
    expect(text).toContain('Elapsed 42s');
    expect(text).toContain('Finished');
    expect(text).toContain('5');
    expect(text).toContain('900');
  });

  it('renders no finish clock while running and no summary without facts', () => {
    const { rerender } = render(<RunSummary run={{ ...base, status: 'running', finishedAt: null }} />);
    expect(screen.getByTestId('run-summary').textContent).not.toContain('Finished');
    rerender(<RunSummary run={{ status: 'running' }} />);
    expect(screen.queryByTestId('run-summary')).toBeNull();
  });

  it('formats durations and clock times', () => {
    expect(formatRunDuration(42_000)).toBe('42s');
    expect(formatRunDuration(80_000)).toBe('1m 20s');
    expect(formatRunDuration(3_840_000)).toBe('1h 4m');
    expect(formatRunClock(1_700_000_042_000)).toMatch(/\d{2}:\d{2}/);
  });

  it('is axe-clean', { timeout: 30_000 }, async () => {
    const { container } = render(<RunSummary run={base} />);
    await scanNoViolations(container);
  });
});

describe('RunActions (plan 54)', () => {
  it('offers Stop only while running and Restart only on a settled run', () => {
    const onStop = vi.fn();
    const onRestart = vi.fn();
    const { rerender } = render(<RunActions status="running" onStop={onStop} onRestart={onRestart} />);
    expect(screen.getByTestId('run-action-stop')).toBeTruthy();
    expect(screen.queryByTestId('run-action-restart')).toBeNull();
    fireEvent.click(screen.getByTestId('run-action-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(<RunActions status="done" onStop={onStop} onRestart={onRestart} />);
    expect(screen.queryByTestId('run-action-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('run-action-restart'));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without handlers', () => {
    render(<RunActions status="done" />);
    expect(screen.queryByTestId('run-actions')).toBeNull();
  });

  it('hosts add export/window actions', () => {
    render(<RunActions status="done" onExport={vi.fn()} onOpenWindow={vi.fn()} onViewReport={vi.fn()} />);
    expect(screen.getByTestId('run-action-export')).toBeTruthy();
    expect(screen.getByTestId('run-action-window')).toBeTruthy();
    expect(screen.getByTestId('run-action-report')).toBeTruthy();
  });
});
