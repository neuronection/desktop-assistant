// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { Composer } from '@renderer/chat-react/Composer';
import type { Attachment } from '@shared/types';

afterEach(cleanup);

function composerUi(value: string): JSX.Element {
  return (
    <Composer
      value={value}
      onValueChange={() => undefined}
      onSubmit={() => undefined}
      sending={false}
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

describe('Composer multiline row (footer wrap hook)', () => {
  it('flags the input row multiline once the draft exceeds one line', () => {
    const scrollHeight = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    try {
      const { container, rerender } = render(composerUi('line one\nline two'));
      const row = container.querySelector("[data-as='chat-composer-row']");
      expect(row).toBeTruthy();
      expect(row?.getAttribute('data-multiline')).toBeTruthy();

      scrollHeight.mockReturnValue(10);
      rerender(composerUi(''));
      expect(row?.getAttribute('data-multiline')).toBeNull();
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it('keeps every toolbar action rendered in the multiline state', () => {
    const scrollHeight = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    try {
      render(composerUi('line one\nline two'));
      expect(screen.getByTitle('Attach files')).toBeTruthy();
      expect(screen.getByTitle('Share screen')).toBeTruthy();
      expect(screen.getByTitle('Voice input')).toBeTruthy();
      expect(screen.getByTitle('Hide to tray')).toBeTruthy();
      expect(screen.getByTitle('Send message')).toBeTruthy();
    } finally {
      scrollHeight.mockRestore();
    }
  });
});
