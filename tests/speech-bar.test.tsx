// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SpeechBar } from '@renderer/chat-react/SpeechBar';

afterEach(cleanup);

describe('SpeechBar', () => {
  it('renders nothing while not speaking', () => {
    const { container } = render(<SpeechBar speaking={false} onStop={() => undefined} />);
    expect(container.querySelector('div')).toBeNull();
  });

  it('renders the speaking indicator with a stop control', () => {
    const stop = vi.fn();
    render(<SpeechBar speaking onStop={stop} />);
    expect(screen.getByRole('status', { name: 'Speaking…' })).toBeTruthy();
    expect(screen.getByText('Speaking…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop speaking' }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a stop handler', () => {
    const { container } = render(<SpeechBar speaking />);
    expect(container.querySelector('div')).toBeNull();
  });
});
