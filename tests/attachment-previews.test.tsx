// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, render, screen, fireEvent, createEvent, act } from '@testing-library/react';
import { Composer } from '@renderer/chat-react/Composer';
import { MessageAttachments } from '@renderer/chat-react/MessageAttachments';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT, interpolate } from '@shared/constants/text';
import type { TurnEvent } from '@shared/turns';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

const IMAGE_DATA_URL = 'data:image/png;base64,QUJD';
const PDF_DATA_URL = 'data:application/pdf;base64,UERG';

const IMAGE_ATTACHMENT = { type: 'image' as const, data: IMAGE_DATA_URL };
const PDF_ATTACHMENT = { type: 'pdf' as const, data: PDF_DATA_URL, filename: 'report.pdf' };

describe('Composer attachment previews', () => {
  it('renders an image thumbnail for image attachments', () => {
    const onRemove = vi.fn();
    render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[IMAGE_ATTACHMENT]}
        onRemoveAttachment={onRemove}
        onAttachFiles={() => {}}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        voiceState="idle"
        voiceLevel={0}
        textareaRef={{ current: null }}
      />
    );
    const thumb = screen.getByAltText('', { selector: 'img' });
    expect(thumb.getAttribute('src')).toBe(IMAGE_DATA_URL);
    expect(screen.getByText(TEXT.ATTACHMENT_IMAGE)).toBeTruthy();
  });

  it('renders pdf attachments by filename and the localized summary', () => {
    render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[IMAGE_ATTACHMENT, PDF_ATTACHMENT]}
        onRemoveAttachment={() => {}}
        onAttachFiles={() => {}}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        voiceState="idle"
        voiceLevel={0}
        textareaRef={{ current: null }}
      />
    );
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('2 attached')).toBeTruthy();
    expect(document.querySelector('img[src="' + PDF_DATA_URL + '"]')).toBeNull();
  });

  it('removes the matching attachment', () => {
    const onRemove = vi.fn();
    render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[IMAGE_ATTACHMENT, PDF_ATTACHMENT]}
        onRemoveAttachment={onRemove}
        onAttachFiles={() => {}}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        voiceState="idle"
        voiceLevel={0}
        textareaRef={{ current: null }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: interpolate(TEXT.COMPOSER_REMOVE_ATTACHMENT, { index: 1 }) }));
    expect(onRemove).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: interpolate(TEXT.COMPOSER_REMOVE_ATTACHMENT, { index: 2 }) }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});

describe('Composer paste & drop wiring', () => {
  const pastedFile = new File(['png'], 'pasted.png', { type: 'image/png' });

  function renderComposer(onAttachFiles: (files: File[]) => void): HTMLElement {
    const { container } = render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onAttachFiles={onAttachFiles}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        voiceState="idle"
        voiceLevel={0}
        textareaRef={{ current: null }}
      />
    );
    return container;
  }

  it('pasted image files reach onAttachFiles and skip the default text insertion', () => {
    const onAttach = vi.fn();
    renderComposer(onAttach);
    const textarea = screen.getByRole('textbox');
    const event = createEvent.paste(textarea, { clipboardData: { files: [pastedFile], types: ['Files'] } });
    fireEvent(textarea, event);
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach).toHaveBeenCalledWith([pastedFile]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('plain text paste keeps the default insertion behavior', () => {
    const onAttach = vi.fn();
    renderComposer(onAttach);
    const textarea = screen.getByRole('textbox');
    const event = createEvent.paste(textarea, { clipboardData: { files: [], types: ['text/plain'] } });
    fireEvent(textarea, event);
    expect(onAttach).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('files dropped on the composer reach onAttachFiles', () => {
    const onAttach = vi.fn();
    const container = renderComposer(onAttach);
    const form = container.querySelector('[data-as="chat-composer"]') as HTMLElement;
    fireEvent.drop(form, { dataTransfer: { files: [pastedFile], types: ['Files'] } });
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach).toHaveBeenCalledWith([pastedFile]);
  });
});

describe('MessageAttachments rail', () => {
  it('renders image views as thumbnails and file views as chips', () => {
    render(
      <MessageAttachments
        attachments={[
          { id: 'm-0', name: TEXT.ATTACHMENT_IMAGE, kind: 'image', url: IMAGE_DATA_URL },
          { id: 'm-1', name: 'report.pdf', kind: 'file' },
        ]}
      />
    );
    const img = screen.getByRole('img', { name: TEXT.ATTACHMENT_IMAGE });
    expect(img.getAttribute('src')).toBe(IMAGE_DATA_URL);
    expect(screen.getByText('report.pdf')).toBeTruthy();
  });

  it('renders nothing without attachments', () => {
    const { container } = render(<MessageAttachments attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

const ACTIVE_CONV = {
  id: 'conv-1',
  title: 'Test',
  createdAt: new Date(),
  updatedAt: new Date(),
  isArchived: false,
  messages: [
    {
      id: 'msg-1',
      content: 'What is in this picture?',
      role: 'user',
      attachments: [IMAGE_ATTACHMENT],
      conversationId: 'conv-1',
      createdAt: new Date(),
    },
  ],
};

function baseElectronApi(): Record<string, unknown> {
  return {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async (id: string) => (id === 'conv-1' ? { ...ACTIVE_CONV, messages: [...ACTIVE_CONV.messages] } : null)),
    getAllConversations: vi.fn(async () => [{ ...ACTIVE_CONV, messages: undefined }]),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1' })),
    cancelTurn: vi.fn(async () => true),
    resumeTurn: vi.fn(async () => true),
    setConversationMetadata: vi.fn(async () => {}),
    getScreenSources: vi.fn(async () => []),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
  };
}

describe('attachment rendering in chat surfaces', () => {
  it('launcher expanded mode shows the message attachment thumbnail after selecting the session', async () => {
    let toggleExpand: (() => void) | null = null;
    window.electronAPI = {
      ...baseElectronApi(),
      onLauncherToggleExpand: vi.fn((cb: () => void) => {
        toggleExpand = cb;
        return () => {};
      }),
      onFocusInput: vi.fn(() => () => {}),
    } as unknown as typeof window.electronAPI;

    render(<ChatApp onThemeChange={() => {}} />);
    await screen.findByRole('textbox');
    expect(screen.queryByAltText(TEXT.ATTACHMENT_IMAGE)).toBeNull();

    await act(async () => {
      toggleExpand?.();
    });
    fireEvent.click(screen.getByRole('button', { name: TEXT.LAUNCHER_HISTORY_SHOW }));
    fireEvent.click(screen.getByText('Test'));

    await screen.findByText('What is in this picture?');
    const img = screen.getByRole('img', { name: TEXT.ATTACHMENT_IMAGE });
    expect(img.getAttribute('src')).toBe(IMAGE_DATA_URL);
  });

  it('desktop mode shows the message attachment thumbnail', async () => {
    let onEvent: ((event: TurnEvent) => void) | null = null;
    window.electronAPI = {
      ...baseElectronApi(),
      onTurnEvent: vi.fn((cb: (event: TurnEvent) => void) => {
        onEvent = cb;
        return () => {};
      }),
      onSessionSync: vi.fn(() => () => {}),
      getToolCatalog: vi.fn(async () => []),
    } as unknown as typeof window.electronAPI;

    render(<DesktopApp />);
    await act(async () => {
      onEvent?.({ tempMessageId: 'turn_1', conversationId: 'conv-1', seq: 1, phase: 'finished' } as TurnEvent);
    });
    await screen.findByText('What is in this picture?');

    const img = screen.getByRole('img', { name: TEXT.ATTACHMENT_IMAGE });
    expect(img.getAttribute('src')).toBe(IMAGE_DATA_URL);
  });

  it('desktop mode attaches a file dropped on the composer exactly once', async () => {
    window.electronAPI = {
      ...baseElectronApi(),
      onSessionSync: vi.fn(() => () => {}),
      getToolCatalog: vi.fn(async () => []),
    } as unknown as typeof window.electronAPI;

    render(<DesktopApp />);
    await screen.findByRole('textbox');

    const form = document.querySelector('[data-as="chat-composer"]') as HTMLElement;
    const file = new File(['png'], 'dropped.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.drop(form, { dataTransfer: { files: [file], types: ['Files'] } });
    });

    expect(await screen.findByText('1 attached')).toBeTruthy();
  });
});
