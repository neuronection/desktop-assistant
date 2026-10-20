import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverManifests } from '@main/apps/sources/lifecycle';
import { tierForManifest, tierProblems } from '@shared/app-pack/registration';

/**
 * The canonical entry fixture channel (plan 38 W4) through the desktop
 * stack: the same `entry` cases the Python hosts run through
 * `contract.run_manifest_fixtures` must produce the same OUTCOMES here —
 * discovery rejects with a typed reason, or the tier mirror agrees with the
 * provenance rule. Bundle materialization is deliberately minimal and pinned
 * by the case keys (the fixtures are the wall; the language implementation is
 * replaceable).
 */

type EntryCase = {
  name: string;
  doc: Record<string, unknown>;
  bundled?: boolean;
  tier?: string;
  bundle?: { files?: Record<string, string>; symlinks?: Record<string, string> };
  expect?: { problems?: string[] };
};

const FIXTURES = JSON.parse(readFileSync(join('contracts', 'extension-contract.fixtures.json'), 'utf8')) as {
  entry: { valid: EntryCase[]; invalid: EntryCase[] };
};

async function materialize(root: string, entryCase: EntryCase): Promise<void> {
  for (const [rel, content] of Object.entries(entryCase.bundle?.files ?? {})) {
    const target = join(root, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  for (const [rel, link] of Object.entries(entryCase.bundle?.symlinks ?? {})) {
    const target = join(root, rel);
    await mkdir(dirname(target), { recursive: true });
    await symlink(link, target);
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(entryCase.doc), 'utf8');
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'da-entry-fixtures-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the canonical entry fixtures through the desktop stack (plan 38 W4)', () => {
  for (const entryCase of FIXTURES.entry.valid) {
    it(`accepts ${entryCase.name} as T2 provenance`, async () => {
      if (entryCase.bundled === true) {
        // Bundled/T1 has no imported-lane meaning on desktop — the Python
        // runner owns that half of the pairing rule.
        expect(tierForManifest(entryCase.doc, { bundled: true })).toBe('T1');
        return;
      }
      await materialize(root, entryCase);
      const found = await discoverManifests(root, '');
      expect(found).toHaveLength(1);
      expect(found[0].tier).toBe('T2');
    });
  }

  for (const entryCase of FIXTURES.entry.invalid) {
    it(`rejects ${entryCase.name} with a typed reason`, async () => {
      const expected = entryCase.expect?.problems ?? [];
      if (entryCase.tier !== undefined) {
        // A caller-claim contradiction has no discovery expression — the
        // mirror rule is the enforcement point and must match the Python
        // wording the fixture pins.
        const problems = tierProblems(entryCase.doc, entryCase.tier);
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join('; ')).toContain(expected[0] ?? 'provenance derives tier');
        return;
      }
      await materialize(root, entryCase);
      let message = '';
      try {
        await discoverManifests(root, '');
      } catch (error) {
        message = String((error as Error)?.message ?? error);
      }
      expect(message, `${entryCase.name} must be rejected at discovery`).not.toBe('');
      expect(
        expected.some((fragment) => message.includes(fragment)),
        `${entryCase.name}: rejection ${JSON.stringify(message)} matches none of ${JSON.stringify(expected)}`,
      ).toBe(true);
    });
  }
});

describe('the tier mirror agrees with the provenance rule (plan 38 W3)', () => {
  it('entry is T2 imported / T1 bundled, mcp makes T3, and a T0 claim is a problem', () => {
    const doc = FIXTURES.entry.valid[0].doc;
    expect(tierForManifest(doc)).toBe('T2');
    expect(tierForManifest(doc, { bundled: true })).toBe('T1');
    expect(tierForManifest({ ...doc, mcp: { transport: 'stdio' } })).toBe('T3');
    expect(tierProblems(doc, 'T0').join('; ')).toContain('provenance derives tier');
    expect(tierProblems(doc, 'T2')).toEqual([]);
    const declarative = { ...doc };
    delete declarative.entry;
    expect(tierForManifest(declarative)).toBe('T0');
  });
});
