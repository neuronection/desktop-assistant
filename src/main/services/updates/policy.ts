import type { UpdateChannel, UpdateRelease } from '@shared/types';
import type { VersionDoc } from './check';
import { compareSemver, parseSemver } from './semver';

export interface ResolvedUpdate {
  status: 'up-to-date' | 'available';
  release: UpdateRelease | null;
}

export function resolveUpdate(
  currentVersion: string,
  channel: UpdateChannel,
  doc: VersionDoc,
): ResolvedUpdate {
  const current = parseSemver(currentVersion);
  const candidates: UpdateRelease[] =
    channel === 'stable'
      ? [doc.latestStable]
      : [doc.latestBeta, doc.latestStable].filter((release) => release !== null);

  let best: UpdateRelease | null = null;
  let bestParsed: ReturnType<typeof parseSemver> = null;
  for (const release of candidates) {
    const parsed = parseSemver(release.version);
    if (!parsed) continue;
    if (current && compareSemver(parsed, current) <= 0) continue;
    if (!bestParsed || compareSemver(parsed, bestParsed) > 0) {
      best = release;
      bestParsed = parsed;
    }
  }
  return { status: best ? 'available' : 'up-to-date', release: best };
}
