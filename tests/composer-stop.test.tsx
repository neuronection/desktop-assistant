// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { JSX } from 'react';
import { Composer } from '@renderer/chat-react/Composer';
import type { Attachment } from '@shared/types';

afterEach(cleanup);

function composerUi(sending: boolean, onStop?: () => void): JSX.Element {
  return (
    <Composer
      value=""
      onValueChange={() => undefined}
      onSubmit={() => undefined}
      sending={sending}
      onStop={onStop}
      attachments={[] as Attachment[]}
      onRemoveAttachment={() => undefined}
      onAttachFiles={() => undefined}
      onPickScreen={() => undefined}
      onToggleRecording={() => undefined}
      voiceState="idle"
      voiceLevel={0}
    />
  );
}

describe('Composer stop control (cancel stream)', () => {
  it('renders the stop control while sending and cancels the turn on click', () => {
    const onStop = vi.fn();
    render(composerUi(true, onStop));
    const stop = screen.getByRole('button', { name: 'Stop generating' });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('hides the stop control when not sending or when no handler is wired', () => {
    const { rerender } = render(composerUi(false, vi.fn()));
    expect(screen.queryByRole('button', { name: 'Stop generating' })).toBeNull();

    rerender(composerUi(true, undefined));
    expect(screen.queryByRole('button', { name: 'Stop generating' })).toBeNull();
  });
});
