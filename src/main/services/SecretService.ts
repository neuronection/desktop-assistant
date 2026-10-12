import { app, safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

export interface SecretBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export const providerSecretKey = (providerId: string): string => `provider:${providerId}`;

export class SecretService {
  private static instance: SecretService;
  private backend: SecretBackend | null = null;
  private store: Record<string, string> | null = null;
  private readonly storePath: string;

  private constructor() {
    this.storePath = join(app.getPath('userData'), 'secrets.json');
  }

  static getInstance(): SecretService {
    if (!SecretService.instance) {
      SecretService.instance = new SecretService();
    }
    return SecretService.instance;
  }

  setBackend(backend: SecretBackend): void {
    this.backend = backend;
    this.store = null;
  }

  private getBackend(): SecretBackend {
    return this.backend ?? safeStorage;
  }

  private async loadStore(): Promise<Record<string, string>> {
    if (this.store) {
      return this.store;
    }
    const store: Record<string, string> = {};
    try {
      if (existsSync(this.storePath)) {
        Object.assign(store, JSON.parse(await readFile(this.storePath, 'utf-8')));
      }
    } catch (error) {
      console.error('Failed to read secrets store, starting empty:', error);
    }
    this.store = store;
    return store;
  }

  private async persistStore(): Promise<void> {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.storePath, JSON.stringify(this.store ?? {}));
  }

  async setSecret(key: string, value: string): Promise<void> {
    if (!value) {
      return;
    }
    const backend = this.getBackend();
    if (!backend.isEncryptionAvailable()) {
      throw new Error('OS-protected secret storage is not available on this system (keyring/backend missing). The key was NOT saved.');
    }
    const store = await this.loadStore();
    store[key] = backend.encryptString(value).toString('base64');
    await this.persistStore();
  }

  async getSecret(key: string): Promise<string | null> {
    const raw = (await this.loadStore())[key];
    if (!raw) {
      return null;
    }
    try {
      return this.getBackend().decryptString(Buffer.from(raw, 'base64'));
    } catch (error) {
      console.error(`Failed to decrypt secret '${key}':`, error);
      return null;
    }
  }

  async deleteSecret(key: string): Promise<void> {
    const store = await this.loadStore();
    if (key in store) {
      delete store[key];
      await this.persistStore();
    }
  }

  async hasSecret(key: string): Promise<boolean> {
    return Boolean((await this.loadStore())[key]);
  }

  static keyHint(value: string): string {
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
  }

  async scrubConfig(config: {
    providers?: Array<{ id: string; apiKey?: string; apiKeyHint?: string }>;
  }): Promise<number> {
    let scrubbed = 0;
    for (const provider of config.providers ?? []) {
      if (provider.apiKey) {
        try {
          await this.setSecret(providerSecretKey(provider.id), provider.apiKey);
          provider.apiKeyHint = SecretService.keyHint(provider.apiKey);
        } catch (error) {
          console.error(`Keyring unavailable: API key for provider '${provider.id}' was discarded instead of being stored in plaintext.`, error);
        }
        provider.apiKey = '';
        scrubbed++;
      }
    }
    return scrubbed;
  }
}
