import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureOutcome } from '@shared/capture';
import { screenCaptureTool, screenCaptureSchema } from '@main/ai/tools/native/screen-capture';
import { setCaptureService } from '@main/ai/tools/capture-bridge';

const begin = vi.fn(async (_request: unknown): Promise<CaptureOutcome> => ({
  ok: true,
  dataUrl: 'data:image/jpeg;base64,AAAA',
  meta: { kind: 'display', label: 'Full display', width: 1280, height: 800, displayId: 1 },
}));
const captureNamedWindow = vi.fn(async (_name: string): Promise<CaptureOutcome> => ({
  ok: true,
  dataUrl: 'data:image/jpeg;base64,BBBB',
  meta: { kind: 'window', label: 'GitHub — Firefox', width: 900, height: 600, displayId: 1 },
}));
const cancel = vi.fn();

beforeEach(() => {
  begin.mockClear();
  captureNamedWindow.mockClear();
  cancel.mockClear();
  begin.mockImplementation(async () => ({
    ok: true,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    meta: { kind: 'display', label: 'Full display', width: 1280, height: 800, displayId: 1 },
  }));
  setCaptureService({ begin, captureNamedWindow, cancel } as never);
});

type Block = { type: string; text?: string; url?: string; mimeType?: string };

describe('screen_capture modes (plan 80 S9)', () => {
  it('captures the display under the pointer by default', async () => {
    const result = (await screenCaptureTool.exec({}, {})) as Block[];
    expect(begin).toHaveBeenCalledWith({ intent: 'display' });
    expect(result[0].type).toBe('text');
    expect(result[0].text).toContain('display under the pointer (1280x800)');
    expect(result[1]).toMatchObject({ type: 'image', url: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' });
  });

  it('opens the overlay when the model asks the user to point', async () => {
    begin.mockImplementationOnce(async () => ({
      ok: true,
      dataUrl: 'data:image/jpeg;base64,CCCC',
      meta: { kind: 'region', label: 'Region 820×460', width: 820, height: 460, displayId: 1 },
    }));
    const result = (await screenCaptureTool.exec({ interactive: true }, {})) as Block[];
    expect(begin).toHaveBeenCalledWith({ intent: 'overlay' });
    expect(result[0].text).toContain('Region 820×460');
  });

  it('treats a cancelled ask as an outcome, not an error', async () => {
    begin.mockImplementationOnce(async () => ({ ok: false, reason: 'cancelled' }));
    const result = await screenCaptureTool.exec({ interactive: true }, {});
    expect(result).toBe('The user cancelled the screen capture request.');
  });

  it('reports unavailable and failed captures compactly', async () => {
    begin.mockImplementationOnce(async () => ({ ok: false, reason: 'unavailable' }));
    expect(await screenCaptureTool.exec({}, {})).toContain('not available');
    begin.mockImplementationOnce(async () => ({ ok: false, reason: 'failed', message: 'boom' }));
    expect(await screenCaptureTool.exec({}, {})).toBe('Error: screen capture failed (boom).');
  });

  it('captures a named window without asking', async () => {
    const result = (await screenCaptureTool.exec({ windowName: 'git' }, {})) as Block[];
    expect(captureNamedWindow).toHaveBeenCalledWith('git');
    expect(begin).not.toHaveBeenCalled();
    expect(result[0].text).toContain("window 'git'");
  });

  it('closes the overlay when the turn is aborted', async () => {
    const controller = new AbortController();
    begin.mockImplementationOnce(
      async () =>
        await new Promise<CaptureOutcome>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }));
        })
    );
    const pending = screenCaptureTool.exec({ interactive: true }, { signal: controller.signal });
    controller.abort();
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('never accepts model-guessed coordinates', () => {
    expect(screenCaptureSchema.safeParse({ region: { x: 1, y: 2, width: 3, height: 4 } }).success).toBe(false);
    expect(screenCaptureSchema.safeParse({ interactive: true, windowName: 'x' }).success).toBe(false);
    expect(screenCaptureSchema.safeParse({}).success).toBe(true);
  });

  it('gives the interactive call a user-sized timeout only', () => {
    expect(screenCaptureTool.timeoutFor?.({ interactive: true })).toBe(135_000);
    expect(screenCaptureTool.timeoutFor?.({})).toBe(20_000);
  });
});
