// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { SpeakSelectionChip, useWindowSelection } from '@renderer/chat-react/SpeakSelectionChip';
import { act } from 'react';

afterEach(cleanup);

function fireSelectionChange(): void {
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('SpeakSelectionChip', () => {
  it('renders nothing without a selection', () => {
    const { container } = render(<SpeakSelectionChip selection="" onSpeak={() => undefined} />);
    expect(container.querySelector('div')).toBeNull();
  });

  it('speaks the selection and dismisses', () => {
    const onSpeak = vi.fn();
    const onDismiss = vi.fn();
    render(<SpeakSelectionChip selection="the canary rollout steps" onSpeak={onSpeak} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak selection' }));
    expect(onSpeak).toHaveBeenCalledWith('the canary rollout steps');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selection' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('useWindowSelection', () => {
  function Probe({ enabled }: { enabled: boolean }): JSX.Element {
    const selection = useWindowSelection(enabled);
    return <span>{selection ? `SEL:${selection}` : 'NONE'}</span>;
  }

  it('mirrors window text selections and clears when they collapse', () => {
    const { getByText } = render(<Probe enabled />);
    expect(getByText('NONE')).toBeTruthy();

    const range = document.createRange();
    const host = document.createElement('div');
    host.textContent = 'selected passage text';
    document.body.appendChild(host);
    range.selectNodeContents(host);
    const stub = {
      toString: () => 'selected passage text',
      removeAllRanges: () => {},
    };
    const original = window.getSelection;
    window.getSelection = (() => stub) as unknown as () => Selection | null;
    fireSelectionChange();
    expect(getByText('SEL:selected passage text')).toBeTruthy();

    window.getSelection = (() => ({ toString: () => '  ', removeAllRanges: () => {} })) as unknown as () => Selection | null;
    fireSelectionChange();
    expect(getByText('NONE')).toBeTruthy();
    window.getSelection = original;
    range.detach?.();
    host.remove();
  });

  it('stays inert when disabled', () => {
    const { getByText } = render(<Probe enabled={false} />);
    const original = window.getSelection;
    window.getSelection = (() => ({ toString: () => 'ignored', removeAllRanges: () => {} })) as unknown as () => Selection | null;
    fireSelectionChange();
    expect(getByText('NONE')).toBeTruthy();
    window.getSelection = original;
  });
});
