// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { ApprovalCard } from '@renderer/chat-react/ApprovalCard';
import type { ApprovalRequest } from '@shared/turns';

afterEach(() => cleanup());

const request: ApprovalRequest = {
  id: 'appr_0',
  toolName: 'open_url',
  args: { url: 'https://example.com' },
  summary: 'Open https://example.com',
  risk: 'state-changing',
  allowedDecisions: ['approve', 'reject'],
};

const editableRequest: ApprovalRequest = {
  id: 'appr_1',
  toolName: 'file_write',
  args: { path: '/tmp/out.txt', content: 'hi' },
  summary: 'Write /tmp/out.txt',
  risk: 'state-changing',
  allowedDecisions: ['approve', 'edit', 'reject'],
};

const destructiveRequest: ApprovalRequest = {
  id: 'appr_2',
  toolName: 'run_shell',
  args: { command: 'rm -rf build' },
  summary: 'rm -rf build',
  risk: 'destructive',
  allowedDecisions: ['approve', 'reject'],
};

describe('ApprovalCard destructive (confirm-every-time)', () => {
  it('hides the session/always grants and marks the card', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        variant="rich"
        requests={[destructiveRequest]}
        deadline={Date.now() + 60_000}
        onResolve={onResolve}
      />
    );
    expect(screen.getByText(/confirmed every time/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /this session/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /always/i })).toBeNull();
    expect(screen.getByRole('button', { name: /allow once/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /deny/i })).toBeTruthy();
  });

  it('shows grants again once only state-changing tools are pending', () => {
    render(
      <ApprovalCard variant="compact" requests={[request]} deadline={Date.now() + 60_000} onResolve={() => undefined} />
    );
    expect(screen.queryByText(/confirmed every time/)).toBeNull();
    expect(screen.getByRole('button', { name: /this session/i })).toBeTruthy();
  });
});

describe('ApprovalCard (compact)', () => {
  it('shows tool name, summary, extra-count, and countdown', () => {
    render(
      <ApprovalCard
        variant="compact"
        requests={[request, editableRequest]}
        deadline={Date.now() + 45_000}
        onResolve={() => undefined}
      />
    );
    expect(screen.getByText(/open_url/)).toBeTruthy();
    expect(screen.getByText(/Open https:\/\/example\.com/)).toBeTruthy();
    expect(screen.getByText(/\+1 more/)).toBeTruthy();
    expect(screen.getByText(/45s|44s/)).toBeTruthy();
  });

  it('denies with a reject decision for every request', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard variant="compact" requests={[request]} deadline={Date.now() + 60_000} onResolve={onResolve} />
    );
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onResolve).toHaveBeenCalledWith({
      decisions: [{ type: 'reject', message: 'Denied by the user.' }],
      grant: undefined,
    });
  });

  it('maps allow-once/session/always onto the grant scopes', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard variant="compact" requests={[request]} deadline={Date.now() + 60_000} onResolve={onResolve} />
    );
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onResolve).toHaveBeenLastCalledWith({
      decisions: [{ type: 'approve' }],
      grant: undefined,
    });
    fireEvent.click(screen.getByRole('button', { name: /this session/i }));
    expect(onResolve).toHaveBeenLastCalledWith({
      decisions: [{ type: 'approve' }],
      grant: 'session',
    });
    fireEvent.click(screen.getByRole('button', { name: /always/i }));
    expect(onResolve).toHaveBeenLastCalledWith({
      decisions: [{ type: 'approve' }],
      grant: 'always',
    });
  });

  it('disables all actions once the deadline passed', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard variant="compact" requests={[request]} deadline={Date.now() - 1000} onResolve={onResolve} />
    );
    const deny = screen.getByRole('button', { name: /deny/i }) as HTMLButtonElement;
    expect(deny.disabled).toBe(true);
    fireEvent.click(deny);
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe('ApprovalCard (rich)', () => {
  it('shows full args and the risk badge', () => {
    render(
      <ApprovalCard variant="rich" requests={[request]} deadline={Date.now() + 60_000} onResolve={() => undefined} />
    );
    expect(screen.getByText(/approval needed/i)).toBeTruthy();
    expect(screen.getByText(/"url": "https:\/\/example\.com"/)).toBeTruthy();
  });

  it('edits args via JSON and submits an edit decision', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        variant="rich"
        requests={[editableRequest]}
        deadline={Date.now() + 60_000}
        onResolve={onResolve}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit args/i }));
    const textarea = screen.getByRole('textbox', { name: /arguments for file_write/i }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"path": "/tmp/safe.txt", "content": "edited"}' } });
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onResolve).toHaveBeenCalledWith({
      decisions: [{ type: 'edit', name: 'file_write', args: { path: '/tmp/safe.txt', content: 'edited' } }],
      grant: undefined,
    });
  });

  it('flags invalid JSON and still submits the original args after approval', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        variant="rich"
        requests={[editableRequest]}
        deadline={Date.now() + 60_000}
        onResolve={onResolve}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit args/i }));
    const textarea = screen.getByRole('textbox', { name: /arguments for file_write/i });
    fireEvent.change(textarea, { target: { value: '{broken' } });
    expect(screen.getByText(/invalid json/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onResolve).toHaveBeenCalledWith({
      decisions: [{ type: 'approve' }],
      grant: undefined,
    });
  });

  it('counts down toward auto-deny', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      render(
        <ApprovalCard variant="rich" requests={[request]} deadline={Date.now() + 30_000} onResolve={() => undefined} />
      );
      expect(screen.getByText(/auto-deny in 30s/)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText(/auto-deny in 25s/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
