import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => dataDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
}));

import { SecretService, providerSecretKey } from '@main/services/SecretService';

const freshSecretService = (): SecretService => {
  (SecretService as any).instance = undefined;
  return SecretService.getInstance();
};

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(join(tmpdir(), 'da-secrets-'));
});

describe('SecretService', () => {
  it('round-trips a secret through the encrypted store', async () => {
    const svc = freshSecretService();
    await svc.setSecret(providerSecretKey('p1'), 'sk-test-1234');
    expect(await svc.getSecret(providerSecretKey('p1'))).toBe('sk-test-1234');
    expect(await svc.hasSecret(providerSecretKey('p1'))).toBe(true);
  });

  it('persists across service restarts (same data dir)', async () => {
    await freshSecretService().setSecret(providerSecretKey('p1'), 'sk-stt-key');
    const reloaded = freshSecretService();
    expect(await reloaded.getSecret(providerSecretKey('p1'))).toBe('sk-stt-key');
  });

  it('never stores plaintext in the store file', async () => {
    await freshSecretService().setSecret(providerSecretKey('p1'), 'sk-plaintext-secret');
    const raw = require('fs').readFileSync(join(dataDir, 'secrets.json'), 'utf-8');
    expect(raw).not.toContain('sk-plaintext-secret');
  });

  it('deletes secrets', async () => {
    const svc = freshSecretService();
    await svc.setSecret(providerSecretKey('p1'), 'sk-x');
    await svc.deleteSecret(providerSecretKey('p1'));
    expect(await svc.getSecret(providerSecretKey('p1'))).toBeNull();
  });

  it('returns null for missing keys', async () => {
    expect(await freshSecretService().getSecret('nope')).toBeNull();
  });

  it('fails closed when the OS backend is unavailable (set)', async () => {
    const svc = freshSecretService();
    svc.setBackend({
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from('x'),
      decryptString: () => '',
    });
    await expect(svc.setSecret('k', 'v')).rejects.toThrow(/not available/i);
  });

  it('keyHint masks everything but the last 4 chars', () => {
    expect(SecretService.keyHint('sk-abcd1234')).toBe('••••1234');
    expect(SecretService.keyHint('ab')).toBe('••••');
  });

  it('scrubConfig moves provider keys out of a config object', async () => {
    const svc = freshSecretService();
    const config: any = {
      providers: [
        { id: 'p1', apiKey: 'sk-provider-secret-9999', apiKeyHint: undefined },
        { id: 'p2', apiKey: '', apiKeyHint: '••••8888' },
      ],
    };
    const scrubbed = await svc.scrubConfig(config);
    expect(scrubbed).toBe(1);
    expect(config.providers[0].apiKey).toBe('');
    expect(config.providers[0].apiKeyHint).toBe('••••9999');
    expect(config.providers[1].apiKeyHint).toBe('••••8888');
    expect(await svc.getSecret(providerSecretKey('p1'))).toBe('sk-provider-secret-9999');
  });

  it('scrubConfig discards (never persists) keys when the backend is down', async () => {
    const svc = freshSecretService();
    svc.setBackend({
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from('x'),
      decryptString: () => '',
    });
    const config: any = { providers: [{ id: 'p1', apiKey: 'sk-plain' }] };
    await svc.scrubConfig(config);
    expect(config.providers[0].apiKey).toBe('');
    expect(config.providers[0].apiKeyHint).toBeUndefined();
  });
});
