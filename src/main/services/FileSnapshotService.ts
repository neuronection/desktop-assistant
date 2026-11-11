import { createHash } from 'crypto';
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { PrismaClient } from 'generated/prisma/client';
import type { FileRevertResult, FileSnapshotView } from '@shared/files';

const MAX_AGE_MS = 7 * 86_400_000;
const MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const PRUNE_EVERY_CAPTURES = 25;

export class FileSnapshotService {
  private queue: Promise<unknown> = Promise.resolve();
  private captures = 0;

  constructor(
    private readonly getClient: () => PrismaClient,
    private readonly dir: string,
    private readonly maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    private readonly maxTotalBytes = MAX_BYTES
  ) {}

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private blobPath(sha256: string): string {
    return join(this.dir, sha256);
  }

  private async captureUnlocked(path: string): Promise<string | null> {
    const info = await lstat(path).catch(() => null);
    if (info?.isSymbolicLink() || info?.isDirectory()) {
      return null;
    }
    const client = this.getClient();
    if (!info) {
      const row = await client.fileSnapshot.create({ data: { path, sha256: '', size: 0, existed: false } });
      return row.id;
    }
    if (info.size > this.maxFileBytes) {
      return null;
    }
    const content = await readFile(path);
    const sha256 = createHash('sha256').update(content).digest('hex');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.blobPath(sha256), content, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    });
    const row = await client.fileSnapshot.create({
      data: { path, sha256, size: content.byteLength, existed: true },
    });
    this.captures += 1;
    if (this.captures >= PRUNE_EVERY_CAPTURES) {
      this.captures = 0;
      void this.prune().catch(() => undefined);
    }
    return row.id;
  }

  capture(path: string): Promise<string | null> {
    return this.runExclusive(() => this.captureUnlocked(path));
  }

  async list(limit = 50): Promise<FileSnapshotView[]> {
    const rows = await this.getClient().fileSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        path: row.path,
        size: row.size,
        existed: row.existed,
        createdAt: row.createdAt.toISOString(),
        available: row.existed
          ? await access(this.blobPath(row.sha256)).then(
              () => true,
              () => false
            )
          : true,
      }))
    );
  }

  revert(id: string, allowed: (path: string) => boolean): Promise<FileRevertResult> {
    return this.runExclusive(() => this.revertUnlocked(id, allowed));
  }

  private async revertUnlocked(id: string, allowed: (path: string) => boolean): Promise<FileRevertResult> {
    const client = this.getClient();
    const row = await client.fileSnapshot.findUnique({ where: { id } });
    if (!row) {
      return { ok: false, error: 'not-found' };
    }
    if (!allowed(row.path)) {
      return { ok: false, error: 'outside-granted-roots' };
    }
    const current = await lstat(row.path).catch(() => null);
    if (current?.isSymbolicLink() || current?.isDirectory()) {
      return { ok: false, error: 'not-a-file' };
    }
    if (!row.existed) {
      if (current) {
        const captured = await this.captureUnlocked(row.path).catch(() => null);
        if (!captured) {
          return { ok: false, error: 'snapshot-failed' };
        }
      }
      if (current) {
        await rm(row.path, { force: true });
      }
      return { ok: true, path: row.path };
    }
    const content = await readFile(this.blobPath(row.sha256)).catch(() => null);
    if (!content) {
      return { ok: false, error: 'blob-missing' };
    }
    if (current) {
      const captured = await this.captureUnlocked(row.path).catch(() => null);
      if (!captured) {
        return { ok: false, error: 'snapshot-failed' };
      }
    }
    const mode = current ? current.mode & 0o7777 : 0o666 & ~process.umask();
    const temp = `${row.path}.da-revert-${process.pid}-${Date.now()}.tmp`;
    try {
      await mkdir(dirname(row.path), { recursive: true });
      await writeFile(temp, content, { mode });
      await rename(temp, row.path);
      return { ok: true, path: row.path };
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      try {
        await writeFile(row.path, content, { mode });
        return { ok: true, path: row.path };
      } catch {
        return { ok: false, error: 'write-failed' };
      }
    }
  }

  prune(now = Date.now()): Promise<void> {
    return this.runExclusive(() => this.pruneUnlocked(now));
  }

  private async pruneUnlocked(now: number): Promise<void> {
    const client = this.getClient();
    await client.fileSnapshot.deleteMany({ where: { createdAt: { lt: new Date(now - MAX_AGE_MS) } } });
    const rows = await client.fileSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, sha256: true, size: true },
    });
    const keep = new Set<string>();
    const drop: string[] = [];
    const charged = new Set<string>();
    let keptBytes = 0;
    for (const row of rows) {
      const size = row.sha256 && !charged.has(row.sha256) ? row.size : 0;
      if (keptBytes + size <= this.maxTotalBytes) {
        keptBytes += size;
        if (row.sha256) {
          charged.add(row.sha256);
        }
        keep.add(row.sha256);
      } else {
        drop.push(row.id);
      }
    }
    if (drop.length > 0) {
      await client.fileSnapshot.deleteMany({ where: { id: { in: drop } } });
    }
    const files = await readdir(this.dir).catch(() => [] as string[]);
    for (const file of files) {
      if (!keep.has(file)) {
        await rm(join(this.dir, file), { force: true }).catch(() => undefined);
      }
    }
  }
}
