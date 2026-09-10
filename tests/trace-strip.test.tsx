// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
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
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps} />);
    expect(screen.getByRole('status', { name: 'Working' })).toBeTruthy();
  });

  it('shows only tool activity as chips, with the running tool marked', () => {
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps} />);
    expect(screen.queryByText(/Thinking 1\.4s/)).toBeNull();
    expect(screen.queryByText(/Composing/)).toBeNull();
    expect(screen.getByText(/Searching the web 800ms/)).toBeTruthy();
    expect(screen.getByText(/Reading page …/)).toBeTruthy();
    expect(screen.getByText(/4 steps/)).toBeTruthy();
  });

  it('expands the full trace list on demand — node steps stay inspectable', () => {
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps} />);
    fireEvent.click(screen.getByRole('button', { name: /4 steps/ }));
    expect(screen.getByText('— query: cats')).toBeTruthy();
    expect(screen.getByText('Composing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /4 steps/ }));
    expect(screen.queryByText('— query: cats')).toBeNull();
  });

  it('singularizes one step', () => {
    render(<TraceStrip phase="thinking" startedAt={1000} steps={steps.slice(0, 1)} />);
    expect(screen.getByText(/1 step/)).toBeTruthy();
  });

  it('renders without steps', () => {
    render(<TraceStrip phase={null} startedAt={null} steps={[]} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('marks a checkpoint-replayed step with the resumed badge', () => {
    const resumed: TurnTraceStep[] = [
      { id: 't1', phase: 'thinking', label: 'Thinking', startedAt: 1000, endedAt: 1400, node: 'model_request' },
      {
        id: 't2',
        phase: 'thinking',
        label: 'Thinking',
        startedAt: 2000,
        endedAt: 2400,
        node: 'model_request',
        resumed: true,
      },
    ];
    render(<TraceStrip phase="thinking" startedAt={1000} steps={resumed} />);
    expect(screen.queryByText(/· resumed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /2 steps/ }));
    expect(screen.getAllByText('resumed').length).toBeGreaterThanOrEqual(1);
  });
});
