// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { TraceStrip } from '@renderer/chat-react/TraceStrip';
import type { TurnTraceStep } from '@shared/turns';

const steps: TurnTraceStep[] = [
  { id: 't1', phase: 'thinking', label: 'Thinking', startedAt: 1000, endedAt: 2400 },
  { id: 't2', phase: 'tool_call', label: 'Searching the web', toolName: 'web_search', startedAt: 2400, endedAt: 3200, summary: 'query: cats' },
  { id: 't3', phase: 'thinking', label: 'Composing', startedAt: 3200 },
  { id: 't4', phase: 'tool_call', label: 'Reading page', toolName: 'web_fetch', startedAt: 3300 },
];

afterEach(() => cleanup());

describe('TraceStrip', () => {
  it('renders the coarse phase while a step runs — node labels never surface', () => {
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Working' })).toBeTruthy();
  });

  it('shows only the latest tool activity and the step count in one line', () => {
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps} expanded={false} onToggle={vi.fn()} />);
    expect(screen.queryByText(/Thinking 1\.4s/)).toBeNull();
    expect(screen.queryByText(/Composing/)).toBeNull();
    expect(screen.queryByText(/Searching the web/)).toBeNull();
    expect(screen.getByText(/Reading page …/)).toBeTruthy();
    expect(screen.getByText(/4 steps/)).toBeTruthy();
  });

  it('toggles the step list through the count button', () => {
    const onToggle = vi.fn();
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps} expanded={false} onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: /4 steps/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('singularizes one step', () => {
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps.slice(0, 1)} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/1 step/)).toBeTruthy();
  });

  it('renders without steps', () => {
    render(<TraceStrip phase={null} startedAt={null} steps={[]} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
