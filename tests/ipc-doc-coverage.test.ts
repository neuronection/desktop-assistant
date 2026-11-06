import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderIpcDocs } from '@shared/ipc/docs';
import { IPC_REGISTRY } from '@shared/ipc/registry';

const ROOT = process.cwd();
const DOCS = readFileSync(join(ROOT, 'docs/dev/ipc.md'), 'utf8');

describe('IPC documentation is generated (plan 44 S3)', () => {
  it('docs/dev/ipc.md is exactly the registry render (regen and diff)', () => {
    expect(DOCS).toBe(renderIpcDocs());
  });

  it('every registered channel appears with its exact name', () => {
    const missing = IPC_REGISTRY.map((entry) => entry.channel).filter((channel) => !DOCS.includes(`\`${channel}\``));
    expect(missing).toEqual([]);
  });
});
