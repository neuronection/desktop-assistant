/** One captured file state (Settings → Tools → File changes). */
export interface FileSnapshotView {
  id: string;
  path: string;
  size: number;
  existed: boolean;
  createdAt: string;
  /** False when the blob is missing or the path no longer exists for a deleted-file snapshot. */
  available: boolean;
}

export interface FileSnapshotListEntry extends FileSnapshotView {
  /** False when the path is no longer inside a granted root; revert is refused. */
  allowed: boolean;
}

export type FileRevertResult =
  | { ok: true; path: string }
  | {
      ok: false;
      error: 'not-found' | 'blob-missing' | 'outside-granted-roots' | 'not-a-file' | 'write-failed';
    };
