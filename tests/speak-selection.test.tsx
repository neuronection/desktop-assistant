// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Composer } from '@renderer/chat-react/Composer';
import { useWindowSelection } from '@renderer/chat-react/useWindowSelection';
import { act } from 'react';
import { createRef } from 'react';

afterEach(cleanup);

function fireSelectionChange(): void {
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('Composer speak-selection button', () => {
  const baseProps = {
    value: '',
    onValueChange: () => undefined,
    onSubmit: () => undefined,
    sending: false,
    attachments: [],
    onRemoveAttachment: () => undefined,
    onAttachFiles: () => undefined,
    onPickScreen: () => undefined,
    onToggleRecording: () => undefined,
    voiceState: 'idle' as const,
    voiceLevel: 0,
    textareaRef: createRef<HTMLTextAreaElement>(),
  };

  it('renders only while text is selected and speaks it', () => {
    const onSpeak = vi.fn();
    const { rerender } = render(<Composer {...baseProps} onSpeakSelection={onSpeak} />);
    expect(screen.queryByRole('button', { name: 'Speak selection' })).toBeNull();

    rerender(<Composer {...baseProps} selection="the canary rollout steps" onSpeakSelection={onSpeak} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak selection' }));
    expect(onSpeak).toHaveBeenCalledWith('the canary rollout steps');
  });

  it('stays hidden without a speak handler or selection', () => {
    render(<Composer {...baseProps} selection="selected" />);
    expect(screen.queryByRole('button', { name: 'Speak selection' })).toBeNull();

    render(<Composer {...baseProps} onSpeakSelection={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Speak selection' })).toBeNull();
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
