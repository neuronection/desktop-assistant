import type { FileSnapshotService } from '@main/services/FileSnapshotService';
import { resolveWithinGrantedRoots } from '@main/ai/tools/policy';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface FilesIpcDeps {
  fileSnapshots: FileSnapshotService;
  grantedRoots: () => string[];
}

export function registerFilesIpc(deps: FilesIpcDeps): void {
  const { fileSnapshots, grantedRoots } = deps;

  register(IPC['files:snapshots:list'], async () => {
    const roots = grantedRoots();
    return (await fileSnapshots.list()).map((row) => ({
      ...row,
      allowed: resolveWithinGrantedRoots(roots, row.path) !== null,
    }));
  });

  register(IPC['files:snapshots:revert'], async (_event, id: string) => {
    const roots = grantedRoots();
    return fileSnapshots.revert(id, (path) => resolveWithinGrantedRoots(roots, path) !== null);
  });
}
