import { describe, expect, it, afterAll } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { FileSnapshotService } from '@main/services/FileSnapshotService';
import { migration003 } from '@main/db/migrations/003-file-snapshots';

const clients: PrismaClient[] = [];
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeService(): Promise<{ service: FileSnapshotService; client: PrismaClient; dir: string; files: string }> {
  const root = await mkdtemp(join(tmpdir(), 'da-snapshots-'));
  roots.push(root);
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
  it('captures a file and reverts it byte-for-byte without changing its mode', async () => {
    const { service, files } = await makeService();
    const path = join(files, 'note.txt');
    await writeFile(path, 'one', { mode: 0o755 });
    const id = await service.capture(path);
    expect(id).toBeTruthy();
    await writeFile(path, 'two');
    const result = await service.revert(id as string, () => true);
    expect(result).toEqual({ ok: true, path });
    expect(await readFile(path, 'utf8')).toBe('one');
    expect((await stat(path)).mode & 0o777).toBe(0o755);
    const rows = await service.list();
    expect(rows.some((row) => row.id === id && row.available)).toBe(true);
  });

  it('records a missing file and reverting deletes it only after capturing the current content', async () => {
    const { service, files } = await makeService();
    const path = join(files, 'new.txt');
    const id = await service.capture(path);
    expect(id).toBeTruthy();
    await writeFile(path, 'created later');
    const before = await service.list();
    const result = await service.revert(id as string, () => true);
    expect(result.ok).toBe(true);
    await expect(access(path)).rejects.toBeTruthy();
    const after = await service.list();
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ path, existed: true, size: 'created later'.length });
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
    const service = new FileSnapshotService(() => client, join(files, '..', 'small-blobs'), 4);
    const path = join(files, 'large.txt');
    await writeFile(path, 'too large');
    expect(await service.capture(path)).toBeNull();
  });

  it('counts a shared blob once against the total budget', async () => {
    const { client, dir, files } = await makeService();
    const a = join(files, 'a.txt');
    const b = join(files, 'b.txt');
    await writeFile(a, 'same');
    await writeFile(b, 'same');
    const service = new FileSnapshotService(() => client, dir, 1024, 5);
    await service.capture(a);
    await service.capture(b);
    await service.prune();
    expect(await client.fileSnapshot.count()).toBe(2);
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
