import * as fs from 'fs';
import { BrowserWindow, dialog } from 'electron';
import type { PdfProcessResponse } from '@shared/types';
import type { AttachmentService } from '@main/services/AttachmentService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface AttachmentIpcDeps {
  attachmentService: AttachmentService;
}

export function registerAttachmentIpc(deps: AttachmentIpcDeps): void {
  const { attachmentService } = deps;

  register(IPC['download-attachment'],
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

  register(IPC['process-pdf-attachment'], async (event, dataUrl: string): Promise<PdfProcessResponse> => {
    try {
      const result = await attachmentService.processPdf(dataUrl);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

}
