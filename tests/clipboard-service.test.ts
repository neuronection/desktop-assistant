import { describe, expect, it, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import type { ClipboardSettings } from '@shared/clipboard';
import { ClipboardService } from '@main/services/ClipboardService';
import { migration006 } from '@main/db/migrations/006-clipboard';

const electronState = vi.hoisted(() => ({ text: '', concealed: false }));

vi.mock('electron', () => ({
  clipboard: {
    readText: async () => electronState.text,
    writeText: async (value: string) => {
      electronState.text = value;
    },
    has: async () => electronState.concealed,
  },
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
      decryptString: (value) => {
        if (!encryption) {
          throw new Error('keyring unavailable');
        }
        return value.toString().slice(4);
      },
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

  it('falls back to the Electron clipboard when no adapter is injected', async () => {
    const { client } = await makeService();
    electronState.text = 'from electron';
    const service = new ClipboardService({
      getClient: () => client,
      getConfig: () => settings(),
      now: () => new Date('2026-11-11T12:00:00').getTime(),
    });
    await service.poll();
    expect(await service.list()).toMatchObject([{ text: 'from electron' }]);
  });

  it('caps unpinned entries and keeps pins beyond the cap', async () => {
    const { service, client, clipboard } = await makeService({ config: { maxEntries: 2 } });
    for (const text of ['a', 'b', 'c']) {
      clipboard.text = text;
      await service.poll();
    }
    expect(await client.clipboardEntry.count()).toBe(2);
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

  it('never prunes pins and applies the cap to unpinned rows only', async () => {
    const { service, client, clipboard } = await makeService({ config: { maxEntries: 2 } });
    clipboard.text = 'pinned';
    await service.poll();
    const [first] = await service.list();
    await service.setPinned(first!.id, true);
    clipboard.text = 'b';
    await service.poll();
    clipboard.text = 'c';
    await service.poll();
    const rows = await client.clipboardEntry.findMany();
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.pinned)).toHaveLength(1);
    expect(rows.filter((row) => !row.pinned)).toHaveLength(2);
  });

  it('hides expired rows from the list and status', async () => {
    const { service, client } = await makeService({ config: { retentionHours: 1 } });
    await client.clipboardEntry.create({
      data: { ciphertext: Buffer.from('enc:old').toString('base64'), createdAt: new Date('2026-11-09T12:00:00') },
    });
    expect(await service.list()).toHaveLength(0);
    expect((await service.status()).count).toBe(0);
  });

  it('reports unreadable rows when the keyring is unavailable after capture', async () => {
    const first = await makeService();
    first.clipboard.text = 'encrypted';
    await first.service.poll();
    const lost = new ClipboardService({
      getClient: () => first.client,
      getConfig: () => settings(),
      clipboard: first.clipboard,
      storage: {
        isEncryptionAvailable: () => false,
        encryptString: () => {
          throw new Error('no keyring');
        },
        decryptString: () => {
          throw new Error('no keyring');
        },
      },
      now: () => new Date('2026-11-11T12:05:00').getTime(),
    });
    expect(await lost.list()).toHaveLength(0);
    expect((await lost.status()).unreadable).toBe(1);
  });

  it('sweeps expired rows on the timer even without a new copy', async () => {
    vi.useFakeTimers();
    try {
      const { service, client } = await makeService();
      await client.clipboardEntry.create({
        data: { ciphertext: Buffer.from('enc:expired').toString('base64'), createdAt: new Date('2026-11-09T12:00:00') },
      });
      service.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await client.clipboardEntry.count()).toBe(0);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a pinned session entry beyond the cap', async () => {
    const { service, clipboard } = await makeService({ encryption: false, config: { maxEntries: 2 } });
    clipboard.text = 'pinned';
    await service.poll();
    const [first] = await service.list();
    await service.setPinned(first!.id, true);
    for (const text of ['b', 'c', 'd']) {
      clipboard.text = text;
      await service.poll();
    }
    const list = await service.list();
    expect(list.filter((entry) => entry.pinned)).toHaveLength(1);
    expect(list.filter((entry) => !entry.pinned)).toHaveLength(2);
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
