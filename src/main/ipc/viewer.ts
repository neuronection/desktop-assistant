import { IPC } from '@shared/ipc/registry';
import { ImageViewerStore, getImageViewerStore } from '@main/services/viewer/ImageViewerStore';
import { register } from './register';

export interface ViewerIpcDeps {
  openImage(token: string, title: string): Promise<void>;
}

/** One image surface (plan 80 viewer note): park the payload, open the window. */
export function registerViewerIpc({ openImage }: ViewerIpcDeps): void {
  register(IPC['viewer:open'], async (_event, input: { dataUrl: string; title: string }) => {
    if (!ImageViewerStore.isImageDataUrl(input.dataUrl)) {
      return false;
    }
    const entry = getImageViewerStore().put(input);
    await openImage(entry.token, entry.title);
    return true;
  });

  register(IPC['viewer:image'], async (_event, token: string) => {
    return getImageViewerStore().get(token);
  });
}
