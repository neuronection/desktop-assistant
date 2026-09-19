import { app } from 'electron';
import path from 'node:path';

export function needleResourceDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'needle')
    : path.join(app.getAppPath(), 'src', 'main', 'resources', 'needle');
}

export function needleUserDataDir(): string {
  return app.getPath('userData');
}
