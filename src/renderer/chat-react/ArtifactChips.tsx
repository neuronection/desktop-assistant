import { useState, type JSX } from 'react';
import { File, FileArchive, FileImage, FileText, Folder, FolderOpen } from 'lucide-react';
import type { FileArtifact } from '@shared/artifacts';
import { TEXT, interpolate } from '@shared/constants/text';

export interface ArtifactChipsProps {
  artifacts: FileArtifact[];
  variant?: 'compact' | 'rich';
  className?: string;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function ArtifactIcon({ artifact }: { artifact: FileArtifact }): JSX.Element {
  if (artifact.kind === 'folder') {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />;
  }
  const lower = artifact.path.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(lower)) {
    return <FileImage className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />;
  }
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/.test(lower)) {
    return <FileArchive className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />;
  }
  if (/\.(md|txt|pdf|docx?|xlsx?|pptx?|csv|json|html?)$/.test(lower)) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />;
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />;
}

export function ArtifactChips(props: ArtifactChipsProps): JSX.Element | null {
  const { artifacts, variant = 'compact', className = '' } = props;
  const [error, setError] = useState<string | null>(null);
  if (artifacts.length === 0) {
    return null;
  }

  const open = async (artifact: FileArtifact): Promise<void> => {
    const failure = await window.electronAPI.openPath(artifact.path);
    setError(failure ? interpolate(TEXT.ARTIFACT_OPEN_FAILED, { error: failure }) : null);
  };

  const reveal = (artifact: FileArtifact): void => {
    window.electronAPI.showItemInFolder(artifact.path);
  };

  const list = (
    <ul className="flex flex-col gap-1" aria-label={TEXT.ARTIFACT_GROUP_LABEL}>
      {artifacts.map((artifact, index) => (
        <li
          key={`${artifact.path}_${index}`}
          data-no-drag
          className={`da-rise group flex items-center gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/80 transition-all duration-150 ease-out hover:border-[var(--as-primary)]/50 hover:bg-[var(--as-surface)] ${
            variant === 'compact' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'
          }`}
        >
          <ArtifactIcon artifact={artifact} />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title={artifact.path}
            aria-label={interpolate(TEXT.ARTIFACT_OPEN, { name: artifact.name })}
            onClick={() => void open(artifact)}
          >
            <span className="truncate font-medium">{artifact.name}</span>
            {artifact.kind === 'folder' && (
              <span className="shrink-0 rounded-full border border-[var(--as-border)] px-1 py-px text-[9px] uppercase tracking-wide opacity-70">
                {TEXT.ARTIFACT_FOLDER_BADGE}
              </span>
            )}
            <span className="shrink-0 tabular-nums opacity-60">{formatSize(artifact.sizeBytes)}</span>
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-1 opacity-50 transition-opacity hover:opacity-100"
            aria-label={interpolate(TEXT.ARTIFACT_REVEAL, { name: artifact.name })}
            title={interpolate(TEXT.ARTIFACT_REVEAL, { name: artifact.name })}
            onClick={() => reveal(artifact)}
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {list}
      {error && (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
