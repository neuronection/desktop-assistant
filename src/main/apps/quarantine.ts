import { join } from 'path';
import type { PackError } from '@shared/app-pack';

/** Quarantine store seam (plan 26 S6, contract `quarantine`). */
export interface QuarantineRecord {
  id: string;
  proposalId: string;
  packId: string;
  runId: string;
  relPath: string;
  originPath: string;
  quarantinePath: string;
  size: number;
  movedAt: number;
  restoredAt: number | null;
}

export interface QuarantineStore {
  create(record: QuarantineRecord): Promise<void>;
  byProposal(proposalId: string): Promise<QuarantineRecord[]>;
  byRun(runId: string): Promise<QuarantineRecord[]>;
  byPack(packId: string): Promise<QuarantineRecord[]>;
  olderThan(packId: string, cutoff: number): Promise<QuarantineRecord[]>;
  markRestored(id: string, at: number): Promise<void>;
  delete(id: string): Promise<void>;
  /** Pack ids with quarantine records — retention prunes removed packs' leftovers too. */
  packIdsWithRecords(): Promise<string[]>;
}

export interface QuarantineFsDeps {
  mkdir(path: string, recursive: true): Promise<void>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number; dev: number }>;
  rename(from: string, to: string): Promise<void>;
  copyAndDelete(from: string, to: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  now(): number;
  newId(): string;
}

export interface QuarantineManifest {
  proposalId: string;
  packId: string;
  runId: string;
  createdAt: number;
  items: { relPath: string; originPath: string; quarantinePath: string; fingerprintAtArm: string; movedAt: number }[];
}

export type QuarantineMoveResult =
  | { ok: true; record: QuarantineRecord }
  | { ok: false; error: PackError };

const RETENTION_DAYS_DEFAULT = 30;

function ioError(error: unknown): PackError {
  return { code: 'io', detail: { message: String((error as Error)?.message ?? error).slice(0, 300) } };
}

function pathDenied(reason: string): PackError {
  return { code: 'path-denied', detail: { message: reason } };
}

/**
 * The destructive verb, host-executed (plan 26 S6, ADR-0029 clause 9):
 * move-to-quarantine under `<userData>/mini-apps/<pack>/quarantine/…`,
 * per-item-atomic, same-volume rename with cross-device fallback,
 * manifest-per-batch, retention prune (the only automatic deletion),
 * and a restore that never overwrites. Packs never touch this module.
 */
export class QuarantineService {
  constructor(
    private readonly deps: QuarantineFsDeps,
    private readonly store: QuarantineStore,
    private readonly userDataDir: () => Promise<string>
  ) {}

  private rootFor(packId: string, runId: string): Promise<string> {
    return this.userDataDir().then((userData) => join(userData, 'mini-apps', packId, 'quarantine', runId));
  }

  async moveOne(input: {
    proposalId: string;
    packId: string;
    runId: string;
    originPath: string;
    relPath: string;
    expectedFingerprintAtArm: string;
    currentFingerprint: string | null;
    currentIsFile: boolean | null;
  }): Promise<QuarantineMoveResult> {
    if (input.currentFingerprint !== null && input.currentFingerprint !== input.expectedFingerprintAtArm) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'changed after assessment', path: input.relPath } } };
    }
    if (input.currentIsFile === false) {
      return { ok: false, error: pathDenied('target is no longer a regular file') };
    }
    const root = await this.rootFor(input.packId, input.runId);
    const quarantinePath = join(root, ...input.relPath.split(/[\\/]/));
    try {
      await this.deps.mkdir(join(quarantinePath, '..'), true);
      let size = 0;
      try {
        const stats = await this.deps.stat(input.originPath);
        size = stats.size;
        if (!stats.isFile) {
          return { ok: false, error: pathDenied('target is no longer a regular file') };
        }
      } catch {
        return { ok: false, error: { code: 'not-found', detail: { path: input.relPath } } };
      }
      try {
        await this.deps.rename(input.originPath, quarantinePath);
      } catch (error) {
        if (String((error as Error)?.message ?? error).includes('EXDEV')) {
          await this.deps.copyAndDelete(input.originPath, quarantinePath);
        } else {
          throw error;
        }
      }
      const record: QuarantineRecord = {
        id: this.deps.newId(),
        proposalId: input.proposalId,
        packId: input.packId,
        runId: input.runId,
        relPath: input.relPath,
        originPath: input.originPath,
        quarantinePath,
        size,
        movedAt: this.deps.now(),
        restoredAt: null,
      };
      await this.store.create(record);
      return { ok: true, record };
    } catch (error) {
      return { ok: false, error: ioError(error) };
    }
  }

  async writeManifest(input: { proposalId: string; packId: string; runId: string; items: QuarantineManifest['items'] }): Promise<void> {
    const root = await this.rootFor(input.packId, input.runId);
    const manifest: QuarantineManifest = {
      proposalId: input.proposalId,
      packId: input.packId,
      runId: input.runId,
      createdAt: this.deps.now(),
      items: input.items,
    };
    await this.deps.mkdir(root, true);
    await this.deps.writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  /** Restore never overwrites — an occupied origin lands at `<origin>.restore-<n>`. */
  async restore(record: QuarantineRecord): Promise<{ ok: true; restoredPath: string } | { ok: false; error: PackError }> {
    try {
      if (!(await this.deps.exists(record.quarantinePath))) {
        if (record.restoredAt !== null) {
          return { ok: false, error: { code: 'invalid', detail: { message: 'already restored' } } };
        }
        return { ok: false, error: { code: 'not-found', detail: { path: record.relPath } } };
      }
      await this.deps.mkdir(join(record.originPath, '..'), true);
      let target = record.originPath;
      let suffix = 1;
      while (await this.deps.exists(target)) {
        target = `${record.originPath}.restore-${suffix}`;
        suffix += 1;
      }
      try {
        await this.deps.rename(record.quarantinePath, target);
      } catch (error) {
        if (String((error as Error)?.message ?? error).includes('EXDEV')) {
          await this.deps.copyAndDelete(record.quarantinePath, target);
        } else {
          throw error;
        }
      }
      await this.store.markRestored(record.id, this.deps.now());
      return { ok: true, restoredPath: target };
    } catch (error) {
      return { ok: false, error: ioError(error) };
    }
  }

  /** Restore one item of a run (latest record for the path). */
  async restoreItem(runId: string, relPath: string): Promise<{ ok: true; restoredPath: string } | { ok: false; error: PackError }> {
    const all = await this.store.byRun(runId);
    const records = all.filter((record) => record.relPath === relPath);
    const record = records[records.length - 1];
    if (!record) {
      return { ok: false, error: { code: 'not-found', detail: { path: relPath } } };
    }
    return this.restore(record);
  }

  recordsByProposal(proposalId: string): Promise<QuarantineRecord[]> {
    return this.store.byProposal(proposalId);
  }

  recordsByRun(runId: string): Promise<QuarantineRecord[]> {
    return this.store.byRun(runId);
  }

  /** Retention prune (boot) — the ONLY automatic deletion, quarantine copies only. */
  async pruneRetention(packId: string, retentionDays = RETENTION_DAYS_DEFAULT): Promise<number> {
    const cutoff = this.deps.now() - retentionDays * 86_400_000;
    const stale = await this.store.olderThan(packId, cutoff);
    let removed = 0;
    for (const record of stale) {
      if (record.restoredAt === null && (await this.deps.exists(record.quarantinePath))) {
        await this.deps.unlink(record.quarantinePath).catch(() => undefined);
      }
      await this.store.delete(record.id);
      removed += 1;
    }
    return removed;
  }

  /** User-armed purge (the only path that empties quarantine beyond retention). */
  async empty(packId: string): Promise<number> {
    const records = await this.store.byPack(packId);
    let removed = 0;
    for (const record of records) {
      if (record.restoredAt === null && (await this.deps.exists(record.quarantinePath))) {
        await this.deps.unlink(record.quarantinePath).catch(() => undefined);
      }
      await this.store.delete(record.id);
      removed += 1;
    }
    return removed;
  }
}
