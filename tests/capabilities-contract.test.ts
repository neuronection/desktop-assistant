import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Ajv2020 from 'ajv/dist/2020';

const repo = resolve(__dirname, '..');
const DOC_PATH = resolve(repo, 'docs', 'capabilities.json');
const SCHEMA_PATH = resolve(repo, 'contracts', 'product-capabilities.schema.json');
const DEV_SCHEMA_PATH = resolve(repo, '..', 'dev', 'contracts', 'product-capabilities.schema.json');
const DEV_FIXTURES_PATH = resolve(repo, '..', 'dev', 'contracts', 'product-capabilities.fixtures.json');

const MUST =
  'docs/capabilities.json must be updated in the same change as a shipped feature (family contract: contracts/product-capabilities.schema.json)';

interface Capability {
  id?: string;
  status?: string;
  shot?: string;
  proofs?: unknown;
  metric?: unknown;
}

interface CapabilitiesDoc {
  project?: string;
  capabilities?: Capability[];
}

interface FixtureCase {
  name: string;
  doc: CapabilitiesDoc;
  expectProject?: string;
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function structuralProblems(doc: CapabilitiesDoc, project: string): string[] {
  const problems: string[] = [];
  if (doc.project !== project) {
    problems.push(`project must be "${project}"`);
  }
  const ids = (doc.capabilities ?? []).map((capability) => capability.id ?? '');
  for (const id of duplicates(ids)) {
    problems.push(`duplicate capability id "${id}"`);
  }
  for (const capability of doc.capabilities ?? []) {
    if (
      typeof capability.visual === 'string' &&
      (capability.visual.startsWith('/') || capability.visual.includes('\\') || capability.visual.split('/').includes('..'))
    ) {
      problems.push(`capability "${capability.id}" visual escapes docs/ — ${capability.visual}`);
    }
    if (capability.status !== 'shipped' && (capability.proofs !== undefined || capability.metric !== undefined)) {
      problems.push(
        `capability "${capability.id}" (${capability.status}) must not claim proofs or a metric — shipped only`,
      );
    }
    if (
      typeof capability.shot === 'string' &&
      (capability.shot.startsWith('/') || capability.shot.includes('\\') || capability.shot.split('/').includes('..'))
    ) {
      problems.push(`capability "${capability.id}" shot escapes docs/ — ${capability.shot}`);
    }
  }
  return problems;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = ajv.compile(schema);

const raw = readFileSync(DOC_PATH, 'utf8');
let doc: CapabilitiesDoc | undefined;
let parseError = '';
try {
  doc = JSON.parse(raw) as CapabilitiesDoc;
} catch (error) {
  parseError = String(error);
}

describe('docs/capabilities.json against the family capability contract (plan 43)', () => {
  it('parses as JSON', () => {
    expect(parseError, MUST).toBe('');
  });

  it('validates against the vendored contract (draft 2020-12)', () => {
    const ok = validate(doc);
    expect(validate.errors ?? [], MUST).toEqual([]);
    expect(ok, MUST).toBe(true);
  });

  it('declares this repo and unique ids and honest statuses', () => {
    const problems = doc ? structuralProblems(doc, 'desktop') : ['unparsed'];
    expect(problems, MUST).toEqual([]);
  });

});

describe.skipIf(!existsSync(DEV_FIXTURES_PATH))('product-capabilities fixtures through the vendored contract', () => {
  const FIXTURES = (
    existsSync(DEV_FIXTURES_PATH)
      ? JSON.parse(readFileSync(DEV_FIXTURES_PATH, 'utf8'))
      : { valid: [], invalid: [] }
  ) as {
    valid: FixtureCase[];
    invalid: FixtureCase[];
  };

  for (const fixtureCase of FIXTURES.valid) {
    it(`accepts ${fixtureCase.name}`, () => {
      const ok = validate(fixtureCase.doc);
      expect(validate.errors ?? [], `${fixtureCase.name} must validate`).toEqual([]);
      expect(structuralProblems(fixtureCase.doc, fixtureCase.doc.project ?? ''), `${fixtureCase.name} must pass semantics`).toEqual([]);
      expect(ok, `${fixtureCase.name} must validate`).toBe(true);
    });
  }

  for (const fixtureCase of FIXTURES.invalid) {
    it(`rejects ${fixtureCase.name}`, () => {
      const ok = validate(fixtureCase.doc);
      const project = fixtureCase.expectProject ?? fixtureCase.doc.project ?? '';
      const problems = structuralProblems(fixtureCase.doc, project);
      expect(ok && problems.length === 0, `${fixtureCase.name} must be rejected`).toBe(false);
    });
  }

  it('keeps the vendored schema byte-identical to the family canonical file', () => {
    expect(readFileSync(DEV_SCHEMA_PATH, 'utf8')).toBe(readFileSync(SCHEMA_PATH, 'utf8'));
  });
});
