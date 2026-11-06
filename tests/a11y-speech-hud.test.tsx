// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within, act } from '@testing-library/react';
import axe from 'axe-core';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { TEXT } from '@shared/constants/text';
import { SpeechHud } from '@renderer/speech-overlay-react/SpeechHud';

afterEach(cleanup);

const RULE_EXCLUSIONS: Record<string, string> = {};

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .filter((violation) => !(RULE_EXCLUSIONS[violation.id] && violation.impact !== 'critical'))
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`
    )
    .join('\n');
  expect(summary).toBe('');
}

function speaking(patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot {
  return {
    ...SPEECH_INITIAL,
    state: 'speaking',
    source: 'selection',
    utteranceId: 7,
    chunkIndex: 2,
    chunkCount: 12,
    chunkText: 'The current chunk being spoken.',
    ...patch,
  };
}

function renderHud(snapshot: SpeechSnapshot, onTogglePause = vi.fn(), onStop = vi.fn()) {
  return render(<SpeechHud snapshot={snapshot} onTogglePause={onTogglePause} onStop={onStop} />);
}

describe('speech HUD (plan 58 §6)', () => {
  it('has no axe violations', async () => {
    const { container } = renderHud(speaking());
    await expectNoViolations(container);
  });

  it('has no axe violations in the wide dock with actions', async () => {
    const { container } = render(
      <SpeechHud
        snapshot={speaking()}
        style="edge"
        dock={{ text: true, width: 128 }}
        dockText="The latest line in the wide dock."
        tabActions={['translate-selection', 'speak-selection']}
        liveOnTab
        onTogglePause={vi.fn()}
        onStop={vi.fn()}
      />
    );
    await expectNoViolations(container);
  });

  it('announces the progress line as a polite live region (3 of 12 → 4 of 12)', () => {
    const { rerender } = renderHud(speaking({ chunkIndex: 2 }));
    expect(within(screen.getByRole('status')).getByText('3 of 12')).toBeTruthy();
    rerender(<SpeechHud snapshot={speaking({ chunkIndex: 3 })} onTogglePause={vi.fn()} onStop={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(within(status).getByText('4 of 12')).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('labels every control from TEXT and flips pause → resume', () => {
    const { rerender } = renderHud(speaking());
    const actions = (): HTMLElement =>
      screen.getByTestId('speech-hud-body').parentElement!.querySelector('.sh-actions') as HTMLElement;
    expect(within(actions()).getByRole('button', { name: TEXT.SPEECH_PAUSE })).toBeTruthy();
    expect(within(actions()).getByRole('button', { name: TEXT.SPEECH_STOP })).toBeTruthy();
    expect(screen.getByTestId('speech-hud-body').getAttribute('aria-label')).toBe(TEXT.SPEECH_PAUSE);
    rerender(<SpeechHud snapshot={speaking({ state: 'paused' })} onTogglePause={vi.fn()} onStop={vi.fn()} />);
    expect(within(actions()).getByRole('button', { name: TEXT.SPEECH_RESUME })).toBeTruthy();
    expect(screen.getByTestId('speech-hud-body').getAttribute('aria-label')).toBe(TEXT.SPEECH_RESUME);
  });

  it('wires the HUD buttons to the same controls the hotkeys drive', () => {
    const onTogglePause = vi.fn();
    const onStop = vi.fn();
    renderHud(speaking(), onTogglePause, onStop);
    screen.getByTestId('speech-hud-body').parentElement!
      .querySelector('.sh-actions')!.querySelectorAll('button').forEach((button) => button.click());
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('flashes an error for two seconds and then returns to the chunk line', () => {
    vi.useFakeTimers();
    const { rerender } = renderHud(speaking());
    rerender(
      <SpeechHud
        snapshot={speaking({ state: 'idle', lastError: TEXT.SPEECH_PLAYBACK_FAILED })}
        onTogglePause={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(within(screen.getByRole('status')).getByText(TEXT.SPEECH_PLAYBACK_FAILED)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2_001);
    });
    expect(within(screen.getByRole('status')).queryByText(TEXT.SPEECH_PLAYBACK_FAILED)).toBeNull();
    vi.useRealTimers();
  });

  it('shows the preparing line before the first chunk text arrives', () => {
    renderHud(speaking({ state: 'synthesizing', chunkText: '' }));
    expect(within(screen.getByRole('status')).getByText(TEXT.SPEECH_PREPARING)).toBeTruthy();
  });
});
