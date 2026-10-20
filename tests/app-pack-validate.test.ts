import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest, validatePackConfig } from '@shared/app-pack/validate';
import { initTemplate, validatePackFileContent } from '@shared/app-pack/cli-core';
import { DEFAULT_LIVE_CARD, ui } from '@shared/app-pack/builders';

const sample: Record<string, unknown> = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'sample-manifest.json'), 'utf8')
);

function variant(mutate: (pack: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(sample);
  mutate(clone);
  return clone;
}

describe('validateManifest — sample fixture', () => {
  it('accepts the sample pack and surfaces its structure', () => {
    const result = validateManifest(sample);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.manifest.id).toBe('sample-review');
    expect(result.pack.configKeys).toEqual(['freshDays', 'mode', 'dryRun', 'exceptions']);
    expect(result.pack.requiredI18nKeys).toContain('title');
    expect(result.pack.requiredI18nKeys).toContain('rule.exceptions');
    expect(result.pack.requiredI18nKeys).toContain('config.freshDays');
    expect(result.pack.requiredI18nKeys).toContain('report.ev');
  });

  it('round-trips through the CLI file-content validator', () => {
    const result = validatePackFileContent(JSON.stringify(sample));
    expect(result.ok).toBe(true);
  });
});

describe('validateManifest — apiVersion negotiation', () => {
  it('rejects a newer apiVersion with a typed requires-host reason', () => {
    const result = validateManifest(variant((pack) => {
      pack.apiVersion = 2;
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0].code).toBe('api-version');
    expect(result.issues[0].message).toContain('requires host apiVersion >= 2');
  });

  it('rejects apiVersion outside the deprecation window', () => {
    const result = validateManifest(variant((pack) => {
      pack.apiVersion = -1;
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'api-version')).toBe(true);
  });
});

describe('validateManifest — capabilities and tiers', () => {
  it('accepts ui:window on an IMPORTED (Tier 0) pack — declarative-surface class, not trusted-tier', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'decision', 'run', 'report', 'ui:window'];
    }), { bundled: false });
    expect(result.ok).toBe(true);
  });

  it('requires the report capability with ui:window (the window renders the report surface)', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'decision', 'run', 'ui:window'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'cross-reference' && issue.message.includes('ui:window'))).toBe(true);
  });

  it('still refuses ui:custom-code for imported packs (trusted-tier-only)', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'decision', 'run', 'report', 'ui:custom-code'];
    }), { bundled: false });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'reserved' && issue.message.includes('ui:custom-code'))).toBe(true);
  });

  it('rejects an unknown capability', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'teleport'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'capability' && issue.path === '$.capabilities')).toBe(true);
  });

  it('rejects the reserved fs-write-mutate with the contract-upgrade reason', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'fs-write-mutate'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'reserved' && issue.message.includes('apiVersion >= 2'))).toBe(true);
  });

  it('rejects net as reserved (exfiltration class, not unknown)', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'net'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'reserved')).toBe(true);
  });

  it('rejects the ui capability in imported manifests but allows it bundled', () => {
    const imported = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'decision', 'run', 'report', 'ui'];
    }));
    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.issues.some((issue) => issue.code === 'reserved')).toBe(true);
    }
    const bundled = validateManifest(variant((pack) => {
      pack.capabilities = ['fs-read', 'decision', 'run', 'report', 'ui'];
    }), { bundled: true });
    expect(bundled.ok).toBe(true);
  });

  it('rejects entry paths in Tier 0 imports', () => {
    const result = validateManifest(variant((pack) => {
      pack.entry = 'index.js';
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'reserved' && issue.path === '$.entry')).toBe(true);
  });

  it('requires assessment packs to declare fs-read and run', () => {
    const result = validateManifest(variant((pack) => {
      pack.capabilities = ['decision', 'report'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'cross-reference' && issue.message.includes('fs-read'))).toBe(true);
  });
});

describe('validateManifest — kind rules', () => {
  it('rejects a run pipeline on surface packs', () => {
    const result = validateManifest(variant((pack) => {
      pack.kind = 'surface';
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'kind' && issue.path === '$.run')).toBe(true);
  });

  it('requires privacy on assessment packs', () => {
    const result = validateManifest(variant((pack) => {
      delete pack.privacy;
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'privacy')).toBe(true);
  });
});

describe('validateManifest — envelope-shared fields (D25 / plan 34 §10.3)', () => {
  it('accepts the full shared set with closed-vocabulary categories and the fixed docs pointer', () => {
    const result = validateManifest(variant((pack) => {
      pack.author = 'Neuronection';
      pack.license = 'Apache-2.0';
      pack.repository = 'https://github.com/neuronection/desktop-assistant';
      pack.categories = ['files', 'utilities'];
      pack.docs = 'docs/docs-tree.json';
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects malformed provenance with typed issues', () => {
    for (const [field, value] of [['author', 7], ['author', ''], ['license', []], ['license', 'x'.repeat(121)]] as const) {
      const result = validateManifest(variant((pack) => {
        (pack as Record<string, unknown>)[field] = value;
      }));
      expect(result.ok, `${field}: ${JSON.stringify(value)}`).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.path === `$.${field}` && issue.code === 'malformed')).toBe(true);
      }
    }
  });

  it('rejects a non-https repository', () => {
    const result = validateManifest(variant((pack) => {
      pack.repository = 'http://insecure.example.com/repo.git';
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.path === '$.repository' && issue.code === 'malformed')).toBe(true);
  });

  it('rejects categories outside the closed vocabulary, duplicates, and over-cap lists', () => {
    for (const categories of [['not-a-category'], ['files', 'files'], ['files', 'data', 'search', 'utilities']]) {
      const result = validateManifest(variant((pack) => {
        pack.categories = categories;
      }));
      expect(result.ok, JSON.stringify(categories)).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.path === '$.categories')).toBe(true);
      }
    }
  });

  it('rejects any docs pointer value other than the fixed relative path', () => {
    for (const docs of ['docs/tree.json', 'https://example.com/docs-tree.json', '../docs/docs-tree.json']) {
      const result = validateManifest(variant((pack) => {
        pack.docs = docs;
      }));
      expect(result.ok, docs).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.path === '$.docs' && issue.code === 'malformed')).toBe(true);
      }
    }
  });
});

describe('validateManifest — pipeline strictness', () => {
  it('rejects unknown fields (packs never half-run)', () => {
    const result = validateManifest(variant((pack) => {
      (pack.run as Record<string, unknown>).quantum = true;
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'pipeline' && issue.path.includes('quantum'))).toBe(true);
  });

  it('rejects duplicate rule ids across lists', () => {
    const result = validateManifest(variant((pack) => {
      const run = pack.run as Record<string, any>;
      run.classify.keep.push({ id: 'cache', when: { signal: 'meta.ext', op: 'eq', value: 'tmp' } });
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'cross-reference' && issue.message.includes('Duplicate rule id'))).toBe(true);
  });

  it('rejects a leaf carrying both value and valueSignal', () => {
    const result = validateManifest(variant((pack) => {
      const run = pack.run as Record<string, any>;
      run.classify.keep[0].when = { signal: 'meta.ageDays', op: 'lt', value: 7, valueSignal: 'config.freshDays' };
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'pipeline' && issue.message.includes('Exactly one'))).toBe(true);
  });

  it('requires matches-any valueSignal to reference an array config key', () => {
    const result = validateManifest(variant((pack) => {
      const run = pack.run as Record<string, any>;
      run.classify.veto[0].when = { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.freshDays' };
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'pipeline' && issue.message.includes('array config key'))).toBe(true);
  });

  it('runs the privacy-consistency lint (readContext without sendsContent)', () => {
    const result = validateManifest(variant((pack) => {
      const run = pack.run as Record<string, any>;
      run.decide.readContext = true;
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'privacy' && issue.path === '$.run.decide.readContext')).toBe(true);
  });

  it('rejects compose references to undeclared rules/questions', () => {
    const result = validateManifest(variant((pack) => {
      const run = pack.run as Record<string, any>;
      run.compose = { candidateWhen: { signal: 'answer.ghost.confidence', op: 'gte', value: 0.5 } };
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'cross-reference' && issue.message.includes('ghost'))).toBe(true);
  });
});

describe('validateManifest — report rules', () => {
  it('requires an evidence component wherever recommendations render', () => {
    const result = validateManifest(variant((pack) => {
      const report = pack.report as Record<string, unknown>;
      report.nodes = (report.nodes as Record<string, unknown>[]).filter((node) => node.type !== 'evidence');
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'report' && issue.message.includes('evidence'))).toBe(true);
  });

  it('requires run:arm to be backed by a propose step and quarantine capability', () => {
    const result = validateManifest(variant((pack) => {
      const report = pack.report as Record<string, any>;
      report.nodes.push({ id: 'arm', type: 'actions', actions: ['run:arm'] });
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'cross-reference' && issue.message.includes('run:arm'))).toBe(true);
  });

  it('rejects actions outside the closed vocabulary', () => {
    const result = validateManifest(variant((pack) => {
      const report = pack.report as Record<string, any>;
      report.nodes.push({ id: 'hack', type: 'actions', actions: ['run:format-disk'] });
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'report' && issue.message.includes('closed vocabulary'))).toBe(true);
  });
});

describe('validateManifest — live card rules (plan 28 S1)', () => {
  function withLiveCard(nodes: unknown[], extra: (pack: Record<string, unknown>) => void = (): void => undefined): unknown {
    return variant((pack) => {
      pack.liveCard = { nodes };
      const i18n = pack.i18n as Record<string, Record<string, string>>;
      i18n.locales.en['live.ask'] = 'Ask';
      extra(pack);
    });
  }

  it('accepts the SDK DEFAULT_LIVE_CARD and requires live.<id> labels for stat nodes', () => {
    const result = validateManifest(variant((pack) => {
      pack.liveCard = DEFAULT_LIVE_CARD;
      const i18n = pack.i18n as Record<string, Record<string, string>>;
      for (const key of ['live.status', 'live.progress', 'live.scanned', 'live.keep', 'live.ask', 'live.candidate']) {
        i18n.locales.en[key] = key;
      }
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.requiredI18nKeys).toEqual(expect.arrayContaining(['live.scanned', 'live.keep', 'live.ask', 'live.candidate']));
  });

  it('accepts a custom card and round-trips through the ui.liveCard builder', () => {
    const schema = ui.liveCard({
      nodes: [
        { id: 'status', type: 'badge', bind: 'run.status' },
        { id: 'progress', type: 'progress', bind: 'progress' },
        { id: 'ask', type: 'stat', bind: 'totals.ask' },
      ],
    });
    const result = validateManifest(withLiveCard(schema.nodes));
    expect(result.ok).toBe(true);
  });

  it('refuses unknown component types and unknown binds', () => {
    const result = validateManifest(withLiveCard([{ id: 'gauge', type: 'gauge', bind: 'run.status' }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'liveCard' && issue.message.includes('Unknown component type'))).toBe(true);

    const unknownBind = validateManifest(withLiveCard([{ id: 'x', type: 'stat', bind: 'totals.bytes' }]));
    expect(unknownBind.ok).toBe(false);
    if (!unknownBind.ok) {
      return;
    }
    expect(unknownBind.issues.some((issue) => issue.code === 'liveCard' && issue.message.includes('Unknown bind'))).toBe(true);
  });

  it('enforces the per-type bind rules', () => {
    const badge = validateManifest(withLiveCard([{ id: 'b', type: 'badge', bind: 'totals.keep' }]));
    expect(badge.ok).toBe(false);
    if (!badge.ok) {
      return;
    }
    expect(badge.issues.some((issue) => issue.message.includes('badge binds run.status'))).toBe(true);

    const stat = validateManifest(withLiveCard([{ id: 's', type: 'stat', bind: 'progress' }]));
    expect(stat.ok).toBe(false);
    if (!stat.ok) {
      return;
    }
    expect(stat.issues.some((issue) => issue.message.includes('progress belongs to the progress component'))).toBe(true);

    const progress = validateManifest(withLiveCard([{ id: 'p', type: 'progress', bind: 'totals.keep' }]));
    expect(progress.ok).toBe(false);
    if (!progress.ok) {
      return;
    }
    expect(progress.issues.some((issue) => issue.message.includes('progress binds progress'))).toBe(true);
  });

  it('refuses duplicates, empty node lists, and nodes over the limit', () => {
    const duplicate = validateManifest(withLiveCard([
      { id: 'ask', type: 'stat', bind: 'totals.ask' },
      { id: 'ask', type: 'stat', bind: 'totals.keep' },
    ]));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      return;
    }
    expect(duplicate.issues.some((issue) => issue.code === 'cross-reference')).toBe(true);

    const empty = validateManifest(withLiveCard([]));
    expect(empty.ok).toBe(false);

    const nodes = Array.from({ length: 17 }, (_, index) => ({ id: `stat${index}`, type: 'stat', bind: 'totals.keep' }));
    const overLimit = validateManifest(variant((pack) => {
      pack.liveCard = { nodes };
      const i18n = pack.i18n as Record<string, Record<string, string>>;
      for (let index = 0; index < nodes.length; index += 1) {
        i18n.locales.en[`live.stat${index}`] = `Stat ${index}`;
      }
    }));
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) {
      return;
    }
    expect(overLimit.issues.some((issue) => issue.code === 'limits' && issue.message.includes('Too many components (17'))).toBe(true);
  });

  it('requires the live.<id> i18n label for stat nodes', () => {
    const result = validateManifest(variant((pack) => {
      pack.liveCard = { nodes: [{ id: 'ask', type: 'stat', bind: 'totals.ask' }] };
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'i18n' && issue.message.includes('live.ask'))).toBe(true);
  });

  it('refuses a live card on a surface pack', () => {
    const result = validateManifest(variant((pack) => {
      pack.kind = 'surface';
      delete pack.run;
      delete pack.privacy;
      pack.liveCard = { nodes: [{ id: 'status', type: 'badge', bind: 'run.status' }] };
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'kind' && issue.message.includes('Live cards belong to assessment packs'))).toBe(true);
  });
});

describe('validateManifest — i18n discipline', () => {
  it('flags a required key missing from every locale', () => {
    const result = validateManifest(variant((pack) => {
      const i18n = pack.i18n as Record<string, any>;
      delete i18n.locales.en['rule.fresh'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'i18n' && issue.message.includes('rule.fresh'))).toBe(true);
  });

  it('flags locale key-set drift', () => {
    const result = validateManifest(variant((pack) => {
      const i18n = pack.i18n as Record<string, any>;
      i18n.locales.de = { ...i18n.locales.en };
      delete i18n.locales.de['rule.cache'];
    }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.code === 'i18n' && issue.message.includes('same key set'))).toBe(true);
  });
});

describe('validatePackConfig', () => {
  it('fills defaults when no values are stored', () => {
    const validated = validateManifest(sample);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const result = validatePackConfig(validated.pack, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.freshDays).toBe(7);
      expect(result.values.mode).toBe('conservative');
      expect(result.values.dryRun).toBe(true);
    }
  });

  it('validates stored values against the schema subset', () => {
    const validated = validateManifest(sample);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const bad = validatePackConfig(validated.pack, { freshDays: 999, mode: 'yolo', zap: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.some((issue) => issue.path === '$.freshDays')).toBe(true);
      expect(bad.issues.some((issue) => issue.path === '$.mode')).toBe(true);
      expect(bad.issues.some((issue) => issue.path === '$.zap')).toBe(true);
    }
    const good = validatePackConfig(validated.pack, { freshDays: 30, mode: 'balanced', dryRun: false, exceptions: ['*.safe'] });
    expect(good.ok).toBe(true);
  });
});

describe('cli-core init template', () => {
  it('produces a manifest that passes the shared validator', () => {
    const template = initTemplate({ id: 'my-mini-app', title: 'My app' });
    const result = validatePackFileContent(template);
    expect(result.ok).toBe(true);
  });
});
