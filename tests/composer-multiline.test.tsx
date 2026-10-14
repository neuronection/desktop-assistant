// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('Composer footer layout (input on top, toolbar bottom)', () => {
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

  it('pins the footer layout as unconditional in chat-app.css', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles/chat-app.css'), 'utf8');
    expect(css).toMatch(/\[data-as='chat-composer-row'\]\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\[data-as='chat-composer-row'\]\s*\{[^}]*row-gap:\s*0/s);
    expect(css).toMatch(/\[data-as='chat-composer-row'\] > div:not\(\[role='listbox'\]\)\s*\{[^}]*padding-bottom:\s*0/s);
    expect(css).toMatch(/\[data-as='chat-composer-row'\] > button\s*\{[^}]*margin-bottom:\s*0/s);
    expect(css).toMatch(/\[data-as='chat-composer-row'\] > textarea\s*\{[^}]*order:\s*-1/s);
    expect(css).toMatch(/\[data-as='chat-composer-row'\] > div:first-child\s*\{[^}]*margin-inline-end:\s*auto/s);
    expect(css).not.toMatch(/\[data-as='chat-composer-row'\]\[data-multiline\]/);
  });
});
