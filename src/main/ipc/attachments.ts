import * as fs from 'fs';
import { ipcMain, BrowserWindow, dialog } from 'electron';
import type { PdfProcessResponse } from '@shared/types';
import type { AttachmentService } from '@main/services/AttachmentService';

/** Every channel this module registers (the teardown list consumes this). */
export const ATTACHMENT_IPC_CHANNELS: string[] = [
  'download-attachment', 'process-pdf-attachment', 'attachment:download',
];

export interface AttachmentIpcDeps {
  attachmentService: AttachmentService;
}

export function registerAttachmentIpc(deps: AttachmentIpcDeps): void {
  const { attachmentService } = deps;

  ipcMain.handle(
    'download-attachment',
    async (event, args: { dataUrl: string; filename: string }) => {
      try {
        const { dataUrl, filename } = args;

        if (!dataUrl || !filename) {
          throw new Error('Invalid arguments: dataUrl and filename are required.');
        }

        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          throw new Error('Could not find the associated browser window.');
        }

        const result = await dialog.showSaveDialog(window, {
          title: 'Save Attachment',
          defaultPath: filename,
          buttonLabel: 'Save',
        });

        if (result.canceled || !result.filePath) {
          return { success: true, cancelled: true };
        }
        const base64Data = dataUrl.split(';base64,').pop();
        if (!base64Data) {
          throw new Error('Invalid Data URL format.');
        }

        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(result.filePath, buffer);

        return { success: true, path: result.filePath };

      } catch (error) {
        console.error('Failed to download attachment:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('process-pdf-attachment', async (event, dataUrl: string): Promise<PdfProcessResponse> => {
    try {
      const result = await attachmentService.processPdf(dataUrl);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('attachment:download', async (event, dataUrl: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;

    try {
      const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid data URL format.');
      }

      const mimeType = matches[1];
      const base64Data = matches[2];
      const extension = mimeType.split('/')[1] || 'png';

      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Save Attachment',
        defaultPath: `attachment-${Date.now()}.${extension}`,
        filters: [{ name: 'Images', extensions: [extension, 'jpg', 'png', 'gif'] }]
      });

      if (!canceled && filePath) {
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filePath, buffer);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to download attachment:', error);
      dialog.showErrorBox('Download Error', 'Could not save the attachment. Please try again.');
      return false;
    }
  });
}
