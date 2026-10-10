import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();
const registrarDir = join(repoRoot, 'src/main/ipc');
const registrarFiles = (): string[] =>
  readdirSync(registrarDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(registrarDir, name))
    .concat(join(repoRoot, 'src/main/apps/ipc.ts'));

const walkTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return walkTs(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ');

const handleChannels = (source: string): string[] =>
  [...stripComments(source).matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

const exportedChannelLists = (source: string): { name: string; channels: string[] }[] =>
  [...source.matchAll(/export const (\w+_IPC_CHANNELS)[^=]*= \[([^\]]*)\]/g)].map((match) => ({
    name: match[1],
    channels: [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]),
  }));

describe('IPC structure (source guard)', () => {
  it('every registrar exports a non-empty channel list', () => {
    for (const file of registrarFiles()) {
      const lists = exportedChannelLists(readFileSync(file, 'utf8'));
      expect(lists.length, file).toBeGreaterThan(0);
      for (const list of lists) {
        expect(list.channels.length, `${file}:${list.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('every *_IPC_CHANNELS list contains only channels its module registers', () => {
    for (const file of registrarFiles()) {
      const source = readFileSync(file, 'utf8');
      const handles = new Set(handleChannels(source));
      for (const list of exportedChannelLists(source)) {
        for (const channel of list.channels) {
          expect(handles.has(channel), `${file}:${list.name} lists unregistered channel '${channel}'`).toBe(true);
        }
      }
    }
  });

  it('every ipcMain.handle registration under src/main is covered by exactly one channel list', () => {
    const allRegistered = walkTs(join(repoRoot, 'src/main')).flatMap((file) => handleChannels(readFileSync(file, 'utf8')));
    const allListed = registrarFiles().flatMap((file) =>
      exportedChannelLists(readFileSync(file, 'utf8')).flatMap((list) => list.channels)
    );

    const registeredSet = new Set(allRegistered);
    expect(allRegistered.length).toBe(registeredSet.size);
    expect(allListed.length).toBe(new Set(allListed).size);

    for (const channel of allRegistered) {
      expect(allListed.includes(channel), `registered channel '${channel}' is missing from every teardown list`).toBe(true);
    }
    for (const channel of allListed) {
      expect(registeredSet.has(channel), `teardown list contains unknown channel '${channel}'`).toBe(true);
    }
  });
});
