import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_CAPABILITIES, PACK_SLOTS, PACK_LEAF_OPS, PACK_ERROR_CODES } from '@shared/app-pack/contract.generated';

describe('mini-app pack contract sync (single source, plan 26 S1)', () => {
  it('the generated module has no drift from contracts/mini-app-packs.json', () => {
    expect(() =>
      execFileSync('node', [join('scripts', 'sync-app-pack-contract.mjs'), '--check', join('src', 'shared', 'app-pack', 'contract.generated.ts')], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    ).not.toThrow();
  });

  it('the generated vocabularies match the vendored canonical file', () => {
    const canonical = JSON.parse(readFileSync(join('contracts', 'mini-app-packs.json'), 'utf8'));
    expect([...PACK_CAPABILITIES]).toEqual(canonical.capabilities.map((capability: { id: string }) => capability.id));
    expect([...PACK_SLOTS]).toEqual(canonical.slots.taxonomy.map((slot: { id: string }) => slot.id));
    expect([...PACK_LEAF_OPS]).toEqual(canonical.pipeline.composeOperators.leafOps);
    expect([...PACK_ERROR_CODES]).toEqual(canonical.errors.codes.map((error: { code: string }) => error.code));
    expect(PACK_CAPABILITIES).toContain('fs-write-mutate');
    expect(PACK_LEAF_OPS).toContain('matches-any');
  });

  it('keeps the vendored copy byte-identical to the family canonical file when the dev repo is present', () => {
    const dev = join(process.cwd(), '..', 'dev', 'contracts', 'mini-app-packs.json');
    if (!existsSync(dev)) {
      return;
    }
    expect(readFileSync(dev, 'utf8')).toBe(readFileSync(join('contracts', 'mini-app-packs.json'), 'utf8'));
  });
});
