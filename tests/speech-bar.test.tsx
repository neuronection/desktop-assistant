// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SpeechBar } from '@renderer/chat-react/SpeechBar';

afterEach(cleanup);

describe('SpeechBar', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<SpeechBar state="idle" onStop={() => undefined} />);
    expect(container.querySelector('div')).toBeNull();
  });

  it('renders the preparing indicator while synthesis is in flight (no stop)', () => {
    render(<SpeechBar state="loading" />);
    expect(screen.getByRole('status', { name: 'Preparing audio…' })).toBeTruthy();
    expect(screen.getByText('Preparing audio…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop speaking' })).toBeNull();
  });

  it('renders the speaking indicator with a stop control', () => {
    const stop = vi.fn();
    render(<SpeechBar state="speaking" onStop={stop} />);
    expect(screen.getByRole('status', { name: 'Speaking…' })).toBeTruthy();
    expect(screen.getByText('Speaking…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop speaking' }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a stop handler while speaking', () => {
    const { container } = render(<SpeechBar state="speaking" />);
    expect(container.querySelector('div')).toBeNull();
  });
});
