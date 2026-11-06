// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { SpeechBar } from '@renderer/chat-react/SpeechBar';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

describe('SpeechBar', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<SpeechBar state="idle" onStop={() => undefined} />);
    expect(container.querySelector('div')).toBeNull();
  });

  it('offers stop while preparing audio and fires it', () => {
    const stop = vi.fn();
    render(<SpeechBar state="loading" onStop={stop} />);
    const status = screen.getByRole('status', { name: TEXT.SPEECH_PREPARING });
    expect(status.textContent).toContain(TEXT.SPEECH_PREPARING);
    fireEvent.click(within(status).getByRole('button', { name: TEXT.SPEECH_STOP }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('hides the preparing stop control without an onStop handler', () => {
    render(<SpeechBar state="loading" />);
    const status = screen.getByRole('status', { name: TEXT.SPEECH_PREPARING });
    expect(within(status).queryByRole('button')).toBeNull();
  });

  it('renders the speaking indicator with a stop control', () => {
    const stop = vi.fn();
    render(<SpeechBar state="speaking" onStop={stop} />);
    expect(screen.getByRole('status', { name: TEXT.SPEECH_SPEAKING })).toBeTruthy();
    expect(screen.getByText(TEXT.SPEECH_SPEAKING)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.SPEECH_STOP }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a handler while speaking', () => {
    const { container } = render(<SpeechBar state="speaking" />);
    expect(container.querySelector('div')).toBeNull();
  });
});

describe('SpeechBar pause + progress (plan 58 S5)', () => {
  it('shows the chunk progress line', () => {
    render(<SpeechBar state="speaking" progress={{ current: 3, total: 12 }} onStop={vi.fn()} />);
    expect(screen.getByText('3 of 12')).toBeTruthy();
  });

  it('offers pause and stop while speaking', () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    render(<SpeechBar state="speaking" onPause={onPause} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.SPEECH_PAUSE }));
    fireEvent.click(screen.getByRole('button', { name: TEXT.SPEECH_STOP }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('flips to resume while paused', () => {
    const onPause = vi.fn();
    render(<SpeechBar state="paused" onPause={onPause} onStop={vi.fn()} />);
    expect(screen.getByRole('status', { name: TEXT.SPEECH_PAUSED })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.SPEECH_RESUME }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('can pause while audio is still being prepared', () => {
    const onPause = vi.fn();
    render(<SpeechBar state="loading" progress={{ current: 1, total: 4 }} onPause={onPause} onStop={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.SPEECH_PAUSE }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});
