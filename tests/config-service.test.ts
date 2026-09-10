import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
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

const freshConfigService = async () => {
  const mod = await import('@main/services/ConfigService');
  (mod.MainConfigService as any).instance = undefined;
  return mod.MainConfigService.getInstance();
};

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(join(tmpdir(), 'da-config-'));
});

describe('MainConfigService', () => {
  it('starts from defaults and persists config.json on first load', async () => {
    const svc = await freshConfigService();
    await svc.loadConfig();
    const cfg = svc.getConfig();
    expect(cfg.providers.length).toBeGreaterThan(0);
    const raw = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf-8'));
    expect(raw.providers.length).toBe(cfg.providers.length);
  });

  it('loads and merges an existing config file', async () => {
    const seeded = {
      theme: 'light',
      providers: [
        { id: 'p1', name: 'Local', type: 4, apiKey: '', apiBase: 'http://localhost:11434/v1', timeout: 30, temperature: 0.7, maxTokens: 2048 },
      ],
      defaultProviderId: 'p1',
    };
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify(seeded));
    const svc = await freshConfigService();
    await svc.loadConfig();
    const cfg = svc.getConfig();
    expect(cfg.theme).toBe('light');
    expect(cfg.providers[0].name).toBe('Local');
    expect(cfg.defaultProviderId).toBe('p1');
  });

  it('round-trips window state', async () => {
    const svc = await freshConfigService();
    await svc.loadConfig();
    await svc.updateWindowBounds({ x: 10, y: 20, width: 800, height: 600 });
    const raw = JSON.parse(readFileSync(join(dataDir, 'window-state.json'), 'utf-8'));
    expect(raw.position).toEqual({ x: 10, y: 20 });
    expect(raw.rememberedBounds.width).toBe(800);
  });

  it('rejects default-provider switch to unknown id', async () => {
    const svc = await freshConfigService();
    await svc.loadConfig();
    await expect(svc.setDefaultLLMProvider('nope')).rejects.toThrow(/not found/i);
  });

  it('keeps config.json parse errors non-fatal (falls back to defaults)', async () => {
    writeFileSync(join(dataDir, 'config.json'), '{ not json');
    const svc = await freshConfigService();
    await svc.loadConfig();
    expect(svc.getConfig().providers.length).toBeGreaterThan(0);
  });

  it('migrates legacy plaintext API keys to the encrypted store on load', async () => {
    const seeded = {
      providers: [
        { id: 'p1', name: 'OpenAI', type: 0, apiKey: 'sk-legacy-secret-4321', apiBase: 'https://api.openai.com/v1', timeout: 30, temperature: 0.7, maxTokens: 2048 },
      ],
      defaultProviderId: 'p1',
      stt: { enabled: true, provider: 0, apiBase: 'https://api.openai.com/v1', apiKey: 'sk-legacy-stt-8765', model: 'whisper-1', timeout: 15000 },
    };
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify(seeded));

    const svc = await freshConfigService();
    await svc.loadConfig();

    const onDisk = readFileSync(join(dataDir, 'config.json'), 'utf-8');
    expect(onDisk).not.toContain('sk-legacy-secret-4321');

    const cfg = svc.getConfig();
    expect(cfg.providers[0].apiKey).toBe('');
    expect(cfg.providers[0].apiKeyHint).toBe('••••4321');

    const { SecretService, providerSecretKey } = await import('@main/services/SecretService');
    const secrets = SecretService.getInstance();
    expect(await secrets.getSecret(providerSecretKey('p1'))).toBe('sk-legacy-secret-4321');
  });

  it('seeds the STT task assignment from a legacy STT model that exists in the registry', async () => {
    const seeded = {
      providers: [
        {
          id: 'p1', name: 'OpenAI', type: 0, apiBase: 'https://api.openai.com/v1', timeout: 30, temperature: 0.7, maxTokens: 2048,
          availableModels: [{ id: 'whisper-1', name: 'Whisper', providerType: 0, providerId: 'p1', caps: ['audio'] }],
        },
      ],
      defaultProviderId: 'p1',
      stt: { enabled: true, provider: 0, apiBase: 'https://api.openai.com/v1', apiKey: '', model: 'whisper-1', timeout: 15000 },
    };
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify(seeded));

    const svc = await freshConfigService();
    await svc.loadConfig();
    expect(svc.getConfig().taskAssignments.stt).toBe('whisper-1');
  });

  it('strips newly saved provider keys before they hit disk', async () => {
    const svc = await freshConfigService();
    await svc.loadConfig();
    await svc.addLLMProvider({
      name: 'Groq', type: 1, apiKey: 'sk-new-key-1111', apiBase: 'https://api.groq.com/openai/v1',
      timeout: 30, temperature: 0.7, maxTokens: 1024, systemPrompt: '',
    } as any);
    const onDisk = readFileSync(join(dataDir, 'config.json'), 'utf-8');
    expect(onDisk).not.toContain('sk-new-key-1111');
    const added = svc.getConfig().providers.find(p => p.name === 'Groq');
    expect(added?.apiKey).toBe('');
    expect(added?.apiKeyHint).toBe('••••1111');
  });
});
