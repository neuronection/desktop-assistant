import { describe, expect, it, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import type { ClipboardSettings } from '@shared/clipboard';
import { ClipboardService } from '@main/services/ClipboardService';
import { migration006 } from '@main/db/migrations/006-clipboard';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => value.toString().slice(4),
  },
}));

const clients: PrismaClient[] = [];
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const settings = (overrides: Partial<ClipboardSettings> = {}): ClipboardSettings => ({
  enabled: true,
  paused: false,
  retentionHours: 24,
  maxEntries: 200,
  ...overrides,
});

async function makeService(options: { encryption?: boolean; config?: Partial<ClipboardSettings> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'da-clipboard-'));
  roots.push(root);
  const client = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${join(root, 'test.db')}` }) });
  clients.push(client);
  await client.$connect();
  await migration006.run(client);
  const clipboard = {
    text: '',
    concealed: false,
    async readText() {
      return this.text;
    },
    async writeText(value: string) {
      this.text = value;
    },
    has(format: string) {
      return this.concealed && format === 'org.nspasteboard.ConcealedType';
    },
  };
  const encryption = options.encryption ?? true;
  const service = new ClipboardService({
    getClient: () => client,
    getConfig: () => settings(options.config),
    clipboard,
    storage: {
      isEncryptionAvailable: () => encryption,
      encryptString: (value) => Buffer.from(`enc:${value}`),
      decryptString: (value) => value.toString().slice(4),
    },
    now: (() => {
      let clock = new Date('2026-11-11T12:00:00').getTime();
      return () => (clock += 1000);
    })(),
  });
  return { service, client, clipboard };
}

describe('ClipboardService', () => {
  it('captures text encrypted and never stores it in plaintext', async () => {
    const { service, client, clipboard } = await makeService();
    clipboard.text = 'secret-ish note';
    await service.poll();
    const rows = await client.clipboardEntry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ciphertext).not.toContain('secret-ish');
    expect(await service.list()).toMatchObject([{ text: 'secret-ish note', pinned: false }]);
  });

  it('does nothing while disabled or paused or concealed', async () => {
    const disabled = await makeService({ config: { enabled: false } });
    disabled.clipboard.text = 'nope';
    await disabled.service.poll();
    expect(await disabled.client.clipboardEntry.count()).toBe(0);

    const paused = await makeService({ config: { paused: true } });
    paused.clipboard.text = 'nope';
    await paused.service.poll();
    expect(await paused.client.clipboardEntry.count()).toBe(0);

    const concealed = await makeService();
    concealed.clipboard.text = 'password';
    concealed.clipboard.concealed = true;
    await concealed.service.poll();
    expect(await concealed.client.clipboardEntry.count()).toBe(0);
  });

  it('dedupes the same text and caps the list', async () => {
    const { service, clipboard, client } = await makeService({ config: { maxEntries: 10 } });
    clipboard.text = 'one';
    await service.poll();
    clipboard.text = 'two';
    await service.poll();
    clipboard.text = 'one';
    await service.poll();
    expect(await client.clipboardEntry.count()).toBe(2);
    expect((await service.list())[0]?.text).toBe('one');
  });

  it('keeps history in memory when the keyring is unavailable', async () => {
    const { service, client, clipboard } = await makeService({ encryption: false });
    clipboard.text = 'session text';
    await service.poll();
    expect(await client.clipboardEntry.count()).toBe(0);
    const list = await service.list();
    expect(list).toMatchObject([{ text: 'session text', sessionOnly: true }]);
    const status = await service.status();
    expect(status.encryptionAvailable).toBe(false);
  });

  it('pins, copies, removes and clears', async () => {
    const { service, clipboard } = await makeService();
    clipboard.text = 'entry';
    await service.poll();
    const [first] = await service.list();
    expect(await service.setPinned(first!.id, true)).toBe(true);
    expect((await service.list())[0]?.pinned).toBe(true);
    expect(await service.copy(first!.id)).toBe(true);
    expect(clipboard.text).toBe('entry');
    expect(await service.remove(first!.id)).toBe(true);
    expect(await service.list()).toHaveLength(0);
    clipboard.text = 'again';
    await service.poll();
    await service.clear();
    expect(await service.list()).toHaveLength(0);
  });

  it('prunes unpinned entries past retention when a new capture lands', async () => {
    const { service, client, clipboard } = await makeService({ config: { retentionHours: 1 } });
    const old = new Date('2026-11-09T12:00:00');
    await client.clipboardEntry.create({ data: { ciphertext: Buffer.from('enc:old').toString('base64'), createdAt: old } });
    clipboard.text = 'fresh';
    await service.poll();
    const rows = await client.clipboardEntry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ciphertext).not.toContain('old');
  });
});
