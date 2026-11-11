import { describe, expect, it, afterAll } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { FileSnapshotService } from '@main/services/FileSnapshotService';
import { migration003 } from '@main/db/migrations/003-file-snapshots';

const clients: PrismaClient[] = [];
let root: string;

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeService(): Promise<{ service: FileSnapshotService; client: PrismaClient; dir: string; files: string }> {
  root = await mkdtemp(join(tmpdir(), 'da-snapshots-'));
  const dir = join(root, 'db');
  const files = join(root, 'files');
  await mkdir(files, { recursive: true });
  const client = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${join(root, 'test.db')}` }) });
  clients.push(client);
  await client.$connect();
  await migration003.run(client);
  return { service: new FileSnapshotService(() => client, dir), client, dir, files };
}

describe('FileSnapshotService', () => {
  it('captures a file and reverts it byte-for-byte', async () => {
    const { service, files } = await makeService();
    const path = join(files, 'note.txt');
    await writeFile(path, 'one');
    const id = await service.capture(path);
    expect(id).toBeTruthy();
    await writeFile(path, 'two');
    const result = await service.revert(id as string, () => true);
    expect(result).toEqual({ ok: true, path });
    expect(await readFile(path, 'utf8')).toBe('one');
    const rows = await service.list();
    expect(rows.some((row) => row.id === id && row.available)).toBe(true);
  });

  it('records a missing file and reverting deletes it', async () => {
    const { service, files } = await makeService();
    const path = join(files, 'new.txt');
    const id = await service.capture(path);
    expect(id).toBeTruthy();
    await writeFile(path, 'created later');
    const result = await service.revert(id as string, () => true);
    expect(result.ok).toBe(true);
    await expect(access(path)).rejects.toBeTruthy();
  });

  it('refuses a path outside the allowed roots', async () => {
    const { service, files } = await makeService();
    const path = join(files, 'note.txt');
    await writeFile(path, 'one');
    const id = await service.capture(path);
    await writeFile(path, 'two');
    const result = await service.revert(id as string, () => false);
    expect(result).toEqual({ ok: false, error: 'outside-granted-roots' });
    expect(await readFile(path, 'utf8')).toBe('two');
  });

  it('skips files larger than the configured cap', async () => {
    const { client, files } = await makeService();
    const service = new FileSnapshotService(() => client, join(root, 'small-blobs'), 4);
    const path = join(files, 'large.txt');
    await writeFile(path, 'too large');
    expect(await service.capture(path)).toBeNull();
  });

  it('prunes snapshots older than the retention window', async () => {
    const { service, client, files } = await makeService();
    const old = await client.fileSnapshot.create({
      data: {
        path: join(files, 'old.txt'),
        sha256: '',
        size: 0,
        existed: false,
        createdAt: new Date(Date.now() - 8 * 86_400_000),
      },
    });
    await service.prune();
    expect(await client.fileSnapshot.count({ where: { id: old.id } })).toBe(0);
  });
});
