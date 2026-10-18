import { describe, expect, it } from 'vitest';
import { validateManifest, validatePackConfig } from '@shared/app-pack/validate';
import type { ValidatedPack } from '@shared/app-pack/validate';

function packWithConfigSchema(configSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    apiVersion: 1,
    id: 'redos-pack',
    version: '1.0.0',
    kind: 'surface',
    capabilities: ['state'],
    i18n: { defaultLocale: 'en', locales: { en: { title: 'redos-pack' } } },
    code: { entry: 'code/entry.js' },
    configSchema,
  };
}

describe('manifest config patterns are timeout-safe at import (F9 — the ReDoS wall)', () => {
  it("the audit repro — pattern '(a+)+$' with a 40-a default — is rejected at import, fast", async () => {
    const manifest = packWithConfigSchema({
      type: 'object',
      properties: {
        doom: { type: 'string', pattern: '(a+)+$', default: 'a'.repeat(40) },
      },
    });
    const started = Date.now();
    const verdict = validateManifest(manifest, { bundled: false, sandboxed: true });
    const elapsed = Date.now() - started;
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.issues.some((issue) => issue.message.toLowerCase().includes('timeout-safe'))).toBe(true);
    }
    expect(elapsed).toBeLessThan(1000);
  });

  it('nested-quantifier and backreference classes are refused; linear family patterns stay accepted', async () => {
    const mod = (await import('@shared/app-pack/safePattern').catch(() => null)) as null | {
      isTimeoutSafePattern(source: string): { ok: true } | { ok: false; reason: string };
    };
    const refused = ['(a+)+$', '([a-z]+)*$', '(a|b+)+', '^([a-zA-Z0-9]+)@([a-z]+)+$', '(a)\\1', '(a{0,10}){0,10}', '(?=a+)', 'a{100000}'];
    const accepted = ['^[a-z]+$', '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$', '^[a-z][a-z0-9-]{2,39}$', '(a|b)*$', '(\\d\\d)+$', '^https://[A-Za-z0-9.-]+(/[^\\s]*)?$', '^[a-z]{2,10}$', 'data:image/(png|jpeg)'];
    for (const source of refused) {
      const verdict = mod ? mod.isTimeoutSafePattern(source) : { ok: true as const };
      expect(verdict.ok, `pattern '${source}' must be refused`).toBe(false);
    }
    for (const source of accepted) {
      const verdict = mod ? mod.isTimeoutSafePattern(source) : { ok: true as const };
      expect(verdict.ok, `pattern '${source}' must stay accepted`).toBe(true);
    }
  });

  it('pattern application is bounded: over-length subjects answer a typed issue instead of unbounded backtracking', () => {
    const manifest = packWithConfigSchema({
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z]+$', default: 'a'.repeat(40) },
      },
    });
    const verdict = validateManifest(manifest, { bundled: false, sandboxed: true });
    expect(verdict.ok, verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')).toBe(true);
    if (!verdict.ok) {
      return;
    }
    const pack = verdict.pack as ValidatedPack;
    const bounded = validatePackConfig(pack, { id: 'a'.repeat(600) });
    expect(bounded.ok).toBe(false);
    if (!bounded.ok) {
      expect(bounded.issues.some((issue) => issue.message.includes('pattern-check'))).toBe(true);
    }
    const short = validatePackConfig(pack, { id: 'abc' });
    expect(short.ok, short.ok ? '' : short.issues.map((issue) => issue.message).join('; ')).toBe(true);
  });
});
