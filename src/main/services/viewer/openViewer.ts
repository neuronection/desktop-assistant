import {
  ImageViewerStore,
  getImageViewerStore,
  type ViewerImage,
} from './ImageViewerStore';

export interface OpenViewerInput {
  dataUrl: string;
  title: string;
  /** The chat window that opened it; `null` for main-owned captures (HUD). */
  openerId?: number | null;
  editable?: boolean;
  openOcr?: boolean;
}

export interface OpenViewerDeps {
  show(token: string, title: string, openOcr: boolean): Promise<unknown>;
}

/**
 * The one way to open the image viewer (plan 80 + 82): park the payload under
 * a token, then show the window. The IPC registrar and main-owned captures
 * (HUD text mode) share it so a viewer opened from either place behaves the
 * same — including OCR-on-mount and editability.
 */
export async function openViewerImage(
  input: OpenViewerInput,
  deps: OpenViewerDeps
): Promise<ViewerImage | null> {
  if (!ImageViewerStore.isImageDataUrl(input.dataUrl)) {
    return null;
  }
  const entry = getImageViewerStore().put({
    dataUrl: input.dataUrl,
    title: input.title,
    openerId: input.openerId ?? null,
    editable: input.editable === true,
    openOcr: input.openOcr === true,
  });
  await deps.show(entry.token, entry.title, entry.openOcr);
  return entry;
}
