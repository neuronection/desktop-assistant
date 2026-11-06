// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Composer } from '@renderer/chat-react/Composer';
import { TEXT } from '@shared/constants/text';
import type { Attachment } from '@shared/types';

afterEach(cleanup);

function composerProps(value: string) {
  return {
    value,
    onValueChange: () => undefined,
    onSubmit: () => undefined,
    sending: false,
    attachments: [] as Attachment[],
    onRemoveAttachment: () => undefined,
    onAttachFiles: () => undefined,
    onPickScreen: () => undefined,
    onToggleRecording: () => undefined,
    voiceState: 'idle' as const,
    voiceLevel: 0,
  };
}

function composerUi(value: string): JSX.Element {
  return <Composer {...composerProps(value)} />;
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
      expect(screen.getByTitle('Send message')).toBeTruthy();
      expect(screen.queryByTitle(TEXT.DESKTOP_HIDE_TO_TRAY)).toBeNull();
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it('never renders a hide control — window controls live in the header or the ⋯ menu', () => {
    const scrollHeight = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    try {
      render(composerUi('draft'));
      expect(screen.queryByTitle(TEXT.DESKTOP_HIDE_TO_TRAY)).toBeNull();
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it('marks every button inside the composer form so clicks never submit the draft', () => {
    const scrollHeight = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    try {
      render(
        <Composer
          {...composerProps('a draft that must not send')}
          attachments={[{ type: 'image', data: 'data:image/png;base64,AAA' }]}
          onToggleLive={() => undefined}
          onInsertSelection={() => Promise.resolve(null)}
          onSpeakSelection={() => undefined}
          selection="selected text"
          onInsertClipboard={() => undefined}
          clipboardOffer={{ text: 'clipboard contents' }}
          toolbarEnd={
            <div className="flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon" className="size-7" title="More" onClick={() => undefined}>
                <span aria-hidden>⋯</span>
              </Button>
            </div>
          }
        />
      );
      const form = document.querySelector("[data-as='chat-composer']");
      expect(form).toBeTruthy();
      const buttons = Array.from(form.querySelectorAll('button'));
      expect(buttons.length).toBeGreaterThanOrEqual(10);
      for (const button of buttons) {
        expect(button.getAttribute('type')).toBeTruthy();
      }
      const submits = buttons.filter((button) => button.getAttribute('type') === 'submit');
      expect(submits).toHaveLength(1);
    } finally {
      scrollHeight.mockRestore();
    }
  });

  it('clicking a toolbar button runs its own action and never submits the draft', () => {
    const onSubmit = vi.fn();
    const scrollHeight = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    try {
      render(
        <Composer {...composerProps('a draft that must not send')} onSubmit={onSubmit} />
      );
      fireEvent.click(screen.getByTitle(TEXT.COMPOSER_ATTACH_FILES));
      expect(screen.getByRole('menu')).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTitle(TEXT.COMPOSER_SHARE_SCREEN));
      expect(onSubmit).not.toHaveBeenCalled();
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
