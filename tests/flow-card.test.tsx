// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FlowCard, hasFlowTimeline } from '@renderer/chat-react/FlowCard';
import type { TurnTraceStep } from '@shared/turns';

const steps: TurnTraceStep[] = [
  {
    id: 'node_model_request_1',
    phase: 'thinking',
    label: 'Thinking',
    startedAt: 1000,
    endedAt: 1200,
    node: 'model_request',
  },
  {
    id: 'tool_c1',
    phase: 'tool_call',
    label: 'screen_capture',
    toolName: 'screen_capture',
    startedAt: 1200,
    endedAt: 1500,
    status: 'ok',
    node: 'tools',
  },
  {
    id: 'node_model_request_2',
    phase: 'thinking',
    label: 'Thinking',
    startedAt: 1500,
    node: 'model_request',
  },
];

afterEach(() => cleanup());

describe('FlowCard', () => {
  it('renders nothing for single-hop turns without a tool step', () => {
    const { container } = render(
      <FlowCard phase="streaming" steps={[steps[0]]} />
    );
    expect(container.childElementCount).toBe(0);
    expect(hasFlowTimeline('streaming', [steps[0]])).toBe(false);
  });

  it('renders nothing for terminal phases', () => {
    const { container } = render(<FlowCard phase="finished" steps={steps} />);
    expect(container.childElementCount).toBe(0);
    expect(hasFlowTimeline('cancelled', steps)).toBe(false);
  });

  it('renders the live node timeline while running', () => {
    render(<FlowCard phase="streaming" steps={steps} onCancel={() => undefined} />);
    expect(screen.getByText('Working on it…')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'running',
    ]);
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('shows the interrupted state with the approval card in the detail slot', () => {
    render(
      <FlowCard
        phase="interrupt"
        steps={steps.map((step, index) => (index === 2 ? { ...step, endedAt: 1600 } : step))}
        detail={<button type="button">Approve</button>}
      />
    );
    expect(screen.getByText('Approve')).toBeTruthy();
    const card = screen.getByText('Working on it…').closest('[data-as="flow-status-card"]');
    expect(card?.getAttribute('data-status')).toBe('interrupted');
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('shows the failure message without a retry control', () => {
    render(<FlowCard phase="failed" steps={steps} error="provider down" />);
    expect(screen.getByText('provider down')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('hides cancel when no cancel handler is wired', () => {
    render(<FlowCard phase="streaming" steps={steps} />);
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('wires the cancel control through the turn-cancel channel', () => {
    let cancelled = false;
    render(<FlowCard phase="streaming" steps={steps} onCancel={() => { cancelled = true; }} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(cancelled).toBe(true);
  });
});
