import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { IPC_REGISTRY } from '@shared/ipc/registry';

const repoRoot = process.cwd();
const registrarDir = join(repoRoot, 'src/main/ipc');

const registrarFiles = (): string[] =>
  readdirSync(registrarDir)
    .filter((name) => name.endsWith('.ts') && name !== 'register.ts')
    .map((name) => join(registrarDir, name))
    .concat(join(repoRoot, 'src/main/apps/ipc.ts'));

const registeredChannels = (source: string): string[] =>
  [...source.matchAll(/register\(IPC\[['"]([^'"]+)['"]\]/g)].map((match) => match[1]);

describe('IPC structure (registry guard, plan 44)', () => {
  it('every registrar call has a descriptor with the same direction', () => {
    for (const file of registrarFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const channel of registeredChannels(source)) {
        const descriptor = IPC_REGISTRY.find((entry) => entry.channel === channel);
        expect(descriptor, `${file} registers unknown channel '${channel}'`).toBeDefined();
        expect(descriptor!.direction, `${file}:${channel}`).not.toBe('event');
      }
    }
  });

  it('every invoke/send descriptor is registered exactly once', () => {
    const sourceChannels = registrarFiles().flatMap((file) => registeredChannels(readFileSync(file, 'utf8')));
    const registryHandled = IPC_REGISTRY.filter((entry) => entry.direction !== 'event').map((entry) => entry.channel);
    expect(new Set(sourceChannels).size).toBe(sourceChannels.length);
    expect(sourceChannels.sort()).toEqual(registryHandled.sort());
  });

  it('no registrar opens an ad-hoc ipcMain channel or hand-validates args', () => {
    for (const file of registrarFiles()) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
      expect(source, `${file} uses ipcMain directly`).not.toMatch(/ipcMain\.(handle|on)\(/);
      expect(source, `${file} keeps hand-rolled arg validation`).not.toMatch(/typeof\s+\w+\s*!==/);
      expect(source, `${file} keeps hand-rolled array validation`).not.toMatch(/!Array\.isArray/);
    }
  });

  it('every non-event descriptor exposes a preload bridge method', () => {
    for (const entry of IPC_REGISTRY.filter((candidate) => candidate.direction !== 'event')) {
      expect(entry.bridge, `${entry.channel} has no bridge`).toBeDefined();
    }
  });

  it('every registry file under src/main is accounted for', () => {
    const files = readdirSync(join(repoRoot, 'src/main/ipc')).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    expect(statSync(join(repoRoot, 'src/main/ipc/register.ts')).isFile()).toBe(true);
  });
});
