import { IPC } from '@shared/ipc/registry';
import type { ViewerEditPayload, ViewerOpenInput } from '@shared/viewer';
import { ImageViewerStore, getImageViewerStore } from '@main/services/viewer/ImageViewerStore';
import { openViewerImage } from '@main/services/viewer/openViewer';
import { register } from './register';

export interface ViewerIpcDeps {
  openImage(token: string, title: string, openOcr: boolean): Promise<void>;
  /** Deliver an applied edit to the window that opened the image. */
  notifyEdit(openerId: number | null, payload: { token: string } & ViewerEditPayload): void;
}

/** One image surface (plan 80 viewer note, editing in plan 81). */
export function registerViewerIpc({ openImage, notifyEdit }: ViewerIpcDeps): void {
  register(IPC['viewer:open'], async (event, input: ViewerOpenInput) => {
    const entry = await openViewerImage(
      { ...input, openerId: event.sender.id },
      { show: (token, title, openOcr) => openImage(token, title, openOcr) }
    );
    return entry ? { ok: true, token: entry.token } : { ok: false, token: null };
  });

  register(IPC['viewer:image'], async (_event, token: string) => {
    return getImageViewerStore().get(token);
  });

  register(IPC['viewer:apply'], async (_event, token: string, payload: ViewerEditPayload) => {
    const store = getImageViewerStore();
    const entry = store.get(token);
    if (!entry || !entry.editable || !ImageViewerStore.isImageDataUrl(payload.dataUrl)) {
      return false;
    }
    store.update(token, { dataUrl: payload.dataUrl });
    notifyEdit(entry.openerId, { token, ...payload });
    return true;
  });
}
