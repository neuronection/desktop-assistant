import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

// The setup path (plan 52): `.env.example` documents DESKTOP_GOOGLE_CLIENT_ID
// and friends, but electron-vite does NOT load `.env` into the main process —
// so the documented way to configure a calendar client id did nothing. This
// pins the loader that makes it real.
describe('loadEnvFile', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'envtest-'));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const remember = (key: string) => {
    saved[key] = process.env[key];
    delete process.env[key];
  };

  it('loads KEY=VALUE lines into process.env', async () => {
    remember('DESKTOP_GOOGLE_CLIENT_ID');
    const { loadEnvFile } = await import('@main/loadEnv');
    const path = join(dir, '.env');
    writeFileSync(path, 'DESKTOP_GOOGLE_CLIENT_ID=abc-123\n');
    loadEnvFile(path);
    expect(process.env.DESKTOP_GOOGLE_CLIENT_ID).toBe('abc-123');
  });

  it('never overrides a value already in the environment', async () => {
    remember('DESKTOP_GOOGLE_CLIENT_ID');
    process.env.DESKTOP_GOOGLE_CLIENT_ID = 'from-the-shell';
    const { loadEnvFile } = await import('@main/loadEnv');
    const path = join(dir, '.env');
    writeFileSync(path, 'DESKTOP_GOOGLE_CLIENT_ID=from-the-file\n');
    loadEnvFile(path);
    expect(process.env.DESKTOP_GOOGLE_CLIENT_ID).toBe('from-the-shell');
  });

  it('skips comments/blanks and strips quotes', async () => {
    remember('DESKTOP_MICROSOFT_CLIENT_ID');
    const { loadEnvFile } = await import('@main/loadEnv');
    const path = join(dir, '.env');
    writeFileSync(
      path,
      '# a comment\n\nDESKTOP_MICROSOFT_CLIENT_ID="quoted-value"\nnot a pair\n',
    );
    loadEnvFile(path);
    expect(process.env.DESKTOP_MICROSOFT_CLIENT_ID).toBe('quoted-value');
  });

  it('is a no-op when the file is absent', async () => {
    const { loadEnvFile } = await import('@main/loadEnv');
    expect(loadEnvFile(join(dir, 'nope.env'))).toEqual([]);
  });

  it('returns key names only — never the value', async () => {
    remember('DESKTOP_GOOGLE_CLIENT_ID');
    const { loadEnvFile } = await import('@main/loadEnv');
    const path = join(dir, '.env');
    writeFileSync(path, 'DESKTOP_GOOGLE_CLIENT_ID=super-secret-value\n');
    const loaded = loadEnvFile(path);
    // the loader reports WHICH keys it set — a returned value would be one
    // careless console.log away from a leak
    expect(loaded).toContain('DESKTOP_GOOGLE_CLIENT_ID');
    expect(JSON.stringify(loaded)).not.toContain('super-secret-value');
  });
});
