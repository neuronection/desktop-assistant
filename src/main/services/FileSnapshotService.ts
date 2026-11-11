import { createHash } from 'crypto';
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { PrismaClient } from 'generated/prisma/client';
import type { FileRevertResult, FileSnapshotView } from '@shared/files';

const MAX_AGE_MS = 7 * 86_400_000;
const MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export class FileSnapshotService {
  constructor(
    private readonly getClient: () => PrismaClient,
    private readonly dir: string,
    private readonly maxFileBytes = DEFAULT_MAX_FILE_BYTES
  ) {}

  private blobPath(sha256: string): string {
    return join(this.dir, sha256);
  }

  async capture(path: string): Promise<string | null> {
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) {
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
    return row.id;
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

  async revert(id: string, allowed: (path: string) => boolean): Promise<FileRevertResult> {
    const client = this.getClient();
    const row = await client.fileSnapshot.findUnique({ where: { id } });
    if (!row) {
      return { ok: false, error: 'not-found' };
    }
    if (!allowed(row.path)) {
      return { ok: false, error: 'outside-granted-roots' };
    }
    if (!row.existed) {
      const info = await stat(row.path).catch(() => null);
      if (info?.isDirectory()) {
        return { ok: false, error: 'not-a-file' };
      }
      if (info) {
        await rm(row.path, { force: true });
      }
      return { ok: true, path: row.path };
    }
    const content = await readFile(this.blobPath(row.sha256)).catch(() => null);
    if (!content) {
      return { ok: false, error: 'blob-missing' };
    }
    const current = await stat(row.path).catch(() => null);
    if (current?.isDirectory()) {
      return { ok: false, error: 'not-a-file' };
    }
    if (current) {
      await this.capture(row.path).catch(() => null);
    }
    const temp = `${row.path}.da-revert-${process.pid}-${Date.now()}.tmp`;
    try {
      await mkdir(dirname(row.path), { recursive: true });
      await writeFile(temp, content, { mode: 0o600 });
      await rename(temp, row.path);
      return { ok: true, path: row.path };
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      try {
        await writeFile(row.path, content, { mode: 0o600 });
        return { ok: true, path: row.path };
      } catch {
        return { ok: false, error: 'write-failed' };
      }
    }
  }

  async prune(now = Date.now()): Promise<void> {
    const client = this.getClient();
    await client.fileSnapshot.deleteMany({ where: { createdAt: { lt: new Date(now - MAX_AGE_MS) } } });
    const rows = await client.fileSnapshot.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, sha256: true, size: true } });
    const keep = new Set<string>();
    const drop: string[] = [];
    let keptBytes = 0;
    for (const row of rows) {
      const size = row.sha256 ? row.size : 0;
      if (keptBytes + size <= MAX_BYTES) {
        keptBytes += size;
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
