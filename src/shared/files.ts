/** One captured file state (Settings → Tools → File changes). */
export interface FileSnapshotView {
  id: string;
  path: string;
  size: number;
  existed: boolean;
  createdAt: string;
  /** False when the snapshot blob cannot be read. */
  available: boolean;
}

export interface FileSnapshotListEntry extends FileSnapshotView {
  /** False when the path is no longer inside a granted root; revert is refused. */
  allowed: boolean;
}

export type FileRevertError =
  | 'not-found'
  | 'blob-missing'
  | 'outside-granted-roots'
  | 'not-a-file'
  | 'write-failed'
  | 'snapshot-failed';

export type FileRevertResult =
  | { ok: true; path: string }
  | {
      ok: false;
      error: FileRevertError;
    };
