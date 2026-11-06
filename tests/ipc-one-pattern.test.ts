import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const registrarFiles = readdirSync(join(root, 'src/main/ipc'))
  .filter((name) => name.endsWith('.ts') && name !== 'register.ts')
  .map((name) => join(root, 'src/main/ipc', name))
  .concat(join(root, 'src/main/apps/ipc.ts'));

describe('one IPC pattern (plan 44 S4)', () => {
  it('no registrar opens ipcMain directly', () => {
    for (const file of registrarFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/ipcMain\.(handle|on)\(/);
    }
  });

  it('the legacy channel-list and dual-path markers are gone', () => {
    const sources = registrarFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(sources).not.toContain('_IPC_CHANNELS');
    expect(sources).not.toContain('registerLegacy');
    expect(readFileSync(join(root, 'src/main/ipc-handlers.ts'), 'utf8')).not.toContain('ipcMain');
  });

  it('docs describe exactly the one registration pattern', () => {
    const docs = readFileSync(join(root, 'docs/dev/ipc.md'), 'utf8');
    expect(docs).toContain("register(IPC['channel'], handler)");
    expect(docs).not.toContain('_IPC_CHANNELS');
  });
});
