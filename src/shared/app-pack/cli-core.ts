import { validateManifest, type ValidatePackOptions } from './validate';
import type { PackValidationIssue, ValidatedPack } from './types';

/** CLI core (plan 26 S1): author-time helpers shared by `pack init | validate`. */

export function initTemplate(input: { id: string; title?: string }): string {
  const id = input.id.replace(/[^a-z0-9-]/g, '').toLowerCase();
  const title = input.title?.slice(0, 120) || id;
  const manifest = {
    apiVersion: 1,
    id,
    version: '0.1.0',
    kind: 'assessment',
    capabilities: ['fs-read', 'run', 'report'],
    privacy: { sendsContent: false, sensitiveGlobs: [] },
    run: {
      scan: {},
      classify: {
        keep: [{ id: 'fresh', when: { signal: 'meta.ageDays', op: 'lt', value: 7 } }],
        candidate: [{ id: 'cache', when: { signal: 'meta.name', op: 'matches', value: '*.tmp' } }],
      },
      compose: {},
    },
    report: {
      nodes: [
        { id: 'items', type: 'table', columns: ['path', 'verdict'] },
        { id: 'ev', type: 'evidence' },
      ],
    },
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          title,
          'rule.fresh': 'Recently modified',
          'rule.cache': 'Temporary file',
          'report.items': 'Items',
          'report.ev': 'Evidence',
        },
      },
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function validatePackFileContent(
  content: string,
  options: ValidatePackOptions = {}
): { ok: true; pack: ValidatedPack } | { ok: false; issues: PackValidationIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, issues: [{ path: '$', code: 'malformed', message: 'The file is not valid JSON.' }] };
  }
  const result = validateManifest(parsed, options);
  if (result.ok) {
    return { ok: true, pack: result.pack };
  }
  return { ok: false, issues: result.issues };
}
