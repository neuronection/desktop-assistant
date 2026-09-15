/**
 * File-artifact convention (plan 12 §3 ride-along): tools that produce a
 * file or folder on disk append a machine-readable marker as the LAST
 * line of their result text. `TurnManager` extracts it main-side from
 * the untruncated result, persists it in the message metadata and ships
 * it on the `finished` turn event; the renderer shows open/reveal chips
 * — never parses model prose. Model output is untrusted: a marker only
 * ever comes from tool exec code, and opening re-validates main-side
 * (exists, not an executable, files confined to granted roots).
 */
export interface FileArtifact {
  kind: 'file' | 'folder';
  path: string;
  name: string;
  sizeBytes?: number | null;
}

export const ARTIFACT_MARKER_PREFIX = '[artifact]';

export function appendArtifactMarker(text: string, artifact: FileArtifact): string {
  return `${text}\n${ARTIFACT_MARKER_PREFIX} ${JSON.stringify(artifact)}`;
}

/** Scans the final line only — earlier look-alike lines are prose. */
export function extractArtifactMarker(text: string): FileArtifact | null {
  const lines = text.trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (!last.startsWith(`${ARTIFACT_MARKER_PREFIX} `)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(last.slice(ARTIFACT_MARKER_PREFIX.length + 1));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const candidate = parsed as Partial<FileArtifact>;
    if (candidate.kind !== 'file' && candidate.kind !== 'folder') {
      return null;
    }
    if (typeof candidate.path !== 'string' || candidate.path.length === 0 || candidate.path.length > 4096) {
      return null;
    }
    const name =
      typeof candidate.name === 'string' && candidate.name.length > 0 && candidate.name.length <= 512
        ? candidate.name
        : candidate.path.split(/[\\/]/).pop() || candidate.path;
    const sizeBytes =
      candidate.sizeBytes === undefined || candidate.sizeBytes === null
        ? null
        : typeof candidate.sizeBytes === 'number' && Number.isFinite(candidate.sizeBytes) && candidate.sizeBytes >= 0
          ? Math.round(candidate.sizeBytes)
          : null;
    return { kind: candidate.kind, path: candidate.path, name, sizeBytes };
  } catch {
    return null;
  }
}

export function artifactDisplayName(artifact: FileArtifact): string {
  return artifact.name;
}
