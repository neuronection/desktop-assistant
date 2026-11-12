import { ClipboardItem, clipboard, nativeImage } from 'electron';
import type { CaptureRequest } from '@shared/capture';
import { condenseOcrQuery } from '@shared/ai/ocr';
import { IPC } from '@shared/ipc/registry';
import type { CaptureService } from '@main/services/capture/CaptureService';
import type { OcrService } from '@main/services/ocr/OcrService';
import { describeCaptureCapabilities } from '@main/services/capture/capabilities';
import { register } from './register';

export type CaptureTextAction = 'copy' | 'insert' | 'search' | 'translate';

export interface CaptureIpcDeps {
  service: CaptureService;
  ocr: OcrService;
  translate(text: string): Promise<string>;
  /** Put text in a chat composer: `append` keeps the draft, `replace` starts over. */
  composeText(text: string, mode: 'append' | 'replace'): void;
  /** Display count from Electron's screen module — immediate, no capture. */
  displayCount(): number;
}

/** The capture channels (plan 80 + 82): capture, sources, OCR, text actions. */
export function registerCaptureIpc({ service, ocr, translate, composeText, displayCount }: CaptureIpcDeps): void {
  register(IPC['capture:begin'], async (_event, request: CaptureRequest) => service.begin(request));
  register(IPC['capture:sources'], async () => service.listSources());
  register(IPC['capture:capabilities'], async () =>
    describeCaptureCapabilities({
      capture: service,
      ocr,
      platform: process.platform,
      displayCount: () => displayCount(),
    })
  );

  register(IPC['image:ocr'], async (_event, dataUrl: string, options?: { language?: string }) =>
    ocr.extract(dataUrl, options ?? {})
  );

  register(IPC['image:copy'], async (_event, dataUrl: string) => {
    if (!dataUrl.startsWith('data:image/')) {
      return false;
    }
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      return false;
    }
    // Electron 44: the clipboard is the promise-based W3C shape — an image is
    // a ClipboardItem with a PNG blob, not `writeImage`.
    const png = image.toPNG();
    const bytes = new Uint8Array(png.byteLength);
    bytes.set(png);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    return true;
  });

  register(IPC['image:text-action'], async (_event, input: { action: CaptureTextAction; text: string }) => {
    const text = input.text.slice(0, 20_000);
    if (!text.trim()) {
      return { ok: false, error: 'empty' };
    }
    switch (input.action) {
      case 'copy':
        await clipboard.writeText(text);
        return { ok: true };
      case 'insert':
        composeText(text, 'append');
        return { ok: true };
      case 'search': {
        const query = condenseOcrQuery(text);
        if (!query) {
          return { ok: false, error: 'empty' };
        }
        composeText(`/web ${query}`, 'replace');
        return { ok: true };
      }
      case 'translate': {
        const translated = await translate(text);
        return translated ? { ok: true, text: translated } : { ok: false, error: 'empty' };
      }
      default:
        return { ok: false, error: 'unknown_action' };
    }
  });
}
