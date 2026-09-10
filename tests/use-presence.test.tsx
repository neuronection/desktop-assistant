// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { usePresence, presenceClass } from '@renderer/hooks/usePresence';
import { createRef, forwardRef } from 'react';
import type { HTMLDivElement } from 'react';

const Host = forwardRef<HTMLDivElement, { visible: boolean }>(
  ({ visible }, ref) => {
    const mounted = usePresence(visible, 50);
    return mounted ? (
      <div ref={ref} data-testid="presence" className={presenceClass(visible)} />
    ) : null;
  }
);
Host.displayName = 'Host';

describe('usePresence', () => {
  it('keeps the node mounted through the exit window, then unmounts', async () => {
    vi.useFakeTimers();
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(<Host ref={ref} visible />);

    rerender(<Host ref={ref} visible={false} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.className).toContain('da-exiting');

    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(ref.current).toBeNull();
    vi.useRealTimers();
  });

  it('remounts immediately when visibility returns during the exit window', async () => {
    vi.useFakeTimers();
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(<Host ref={ref} visible />);

    rerender(<Host ref={ref} visible={false} />);
    rerender(<Host ref={ref} visible />);
    await act(async () => {
      vi.advanceTimersByTime(60);
    });

    expect(ref.current).not.toBeNull();
    expect(ref.current?.className).not.toContain('da-exiting');
    vi.useRealTimers();
  });

  it('presenceClass only adds the exiting class when hidden', () => {
    expect(presenceClass(true)).toBe('da-presence');
    expect(presenceClass(false)).toBe('da-presence da-exiting');
    expect(presenceClass(true, 'toast')).toBe('toast');
  });
});
