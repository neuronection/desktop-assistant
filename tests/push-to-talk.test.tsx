// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { usePushToTalk, PUSH_TO_TALK_ARM_MS } from '@renderer/chat-react/usePushToTalk';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness(props: { enabled: boolean; onStart: () => void; onStop: () => void }): null {
  usePushToTalk({ enabled: props.enabled, onStart: props.onStart, onStop: props.onStop });
  return null;
}

function setup(enabled = true): { onStart: ReturnType<typeof vi.fn>; onStop: ReturnType<typeof vi.fn> } {
  vi.useFakeTimers();
  const onStart = vi.fn();
  const onStop = vi.fn();
  render(<Harness enabled={enabled} onStart={onStart} onStop={onStop} />);
  return { onStart, onStop };
}

function holdControl(): void {
  fireEvent.keyDown(document, { key: 'Control' });
}

function armHold(): void {
  act(() => {
    vi.advanceTimersByTime(PUSH_TO_TALK_ARM_MS);
  });
}

describe('usePushToTalk', () => {
  it('starts recording after a hold and stops on release', () => {
    const { onStart, onStop } = setup();
    holdControl();
    expect(onStart).not.toHaveBeenCalled();
    armHold();
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(document, { key: 'Control' });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending hold when another key is pressed (modifier combo)', () => {
    const { onStart, onStop } = setup();
    holdControl();
    fireEvent.keyDown(document, { key: 'e' });
    armHold();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.keyUp(document, { key: 'Control' });
    expect(onStop).not.toHaveBeenCalled();
  });

  it('requires releasing Control before re-arming after a combo', () => {
    const { onStart } = setup();
    holdControl();
    fireEvent.keyDown(document, { key: 'd' });
    fireEvent.keyUp(document, { key: 'd' });
    armHold();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.keyUp(document, { key: 'Control' });
    holdControl();
    armHold();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('ignores auto-repeat keydowns while holding', () => {
    const { onStart } = setup();
    holdControl();
    fireEvent.keyDown(document, { key: 'Control', repeat: true });
    armHold();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('stops an active hold when the window blurs', () => {
    const { onStart, onStop } = setup();
    holdControl();
    armHold();
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const { onStart } = setup(false);
    holdControl();
    armHold();
    expect(onStart).not.toHaveBeenCalled();
  });
});
