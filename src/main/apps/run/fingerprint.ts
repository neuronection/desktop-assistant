import { createHash } from 'node:crypto';

/**
 * The verdict fingerprint (contract `pipeline.run.fingerprint`):
 * sha256(rootId | relative path | size | mtimeMs | contentHash?) — the
 * same function the runner computes at assessment time and the proposal
 * executor re-computes at arm time. One implementation, never two.
 */
export function runnerFingerprint(rootId: string, relative: string, size: number, mtimeMs: number, contentHash?: string): string {
  return createHash('sha256')
    .update([rootId, relative, String(size), String(mtimeMs), contentHash ?? ''].join('|'))
    .digest('hex');
}
