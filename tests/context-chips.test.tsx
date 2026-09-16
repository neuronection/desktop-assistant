// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Composer } from '@renderer/chat-react/Composer';
import { useClipboardOffer } from '@renderer/chat-react/useClipboardOffer';
import { act } from 'react';
import { createRef } from 'react';
import { useState } from 'react';

afterEach(cleanup);

function mockApi(overrides: Partial<Record<string, unknown>> = {}): { summon: () => void } {
  let listener: (() => void) | null = null;
  window.electronAPI = {
    onFocusInput: (cb: () => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    clipboardChanged: vi.fn(async () => ({ changed: false })),
    ...overrides,
  } as unknown as typeof window.electronAPI;
  return {
    summon: () => listener?.(),
  };
}

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

describe('Composer clipboard button', () => {
  it('shows the button only while an offer is present and inserts the full text', () => {
    const onInsert = vi.fn();
    const { rerender } = render(<Composer {...baseProps} onInsertClipboard={onInsert} />);
    expect(screen.queryByRole('button', { name: 'Ask about clipboard' })).toBeNull();

    rerender(
      <Composer
        {...baseProps}
        clipboardOffer={{ text: 'copied article text', preview: 'copied article text' }}
        onInsertClipboard={onInsert}
      />
    );
    const button = screen.getByRole('button', { name: 'Ask about clipboard' });
    expect(button.getAttribute('title')).toBe('Ask about clipboard — copied article text');
    fireEvent.click(button);
    expect(onInsert).toHaveBeenCalledWith('copied article text');
  });
});

describe('useClipboardOffer', () => {
  function Probe(): JSX.Element {
    const offer = useClipboardOffer();
    return <span>{offer ? `OFFER:${offer.text}` : 'NONE'}</span>;
  }

  it('surfaces the clipboard only when main reports a change on summon', async () => {
    const api = mockApi({
      clipboardChanged: vi.fn(async () => ({ changed: true, text: 'copied article text', preview: 'copied article text' })),
    });
    const { getByText } = render(<Probe />);
    act(() => {
      api.summon();
    });
    await waitFor(() => expect(getByText('OFFER:copied article text')).toBeTruthy());
  });

  it('renders nothing when the clipboard is unchanged', async () => {
    const api = mockApi();
    const { getByText } = render(<Probe />);
    act(() => {
      api.summon();
    });
    await waitFor(() => expect(getByText('NONE')).toBeTruthy());
  });
});
