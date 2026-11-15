import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import Ajv2020 from 'ajv/dist/2020';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'docs', 'capabilities.json'), 'utf8')) as {
  version: number;
  capabilities: Array<Record<string, unknown> & { id: string; status: string; order: number; visual?: string }>;
};
const schema = JSON.parse(
  readFileSync(join(root, 'contracts', 'product-capabilities.schema.json'), 'utf8')
);

describe('docs/capabilities.json against the family contract', () => {
  it('validates against contracts/product-capabilities.schema.json', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(manifest);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('has unique ids and a stable order', () => {
    const ids = manifest.capabilities.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = manifest.capabilities.map((capability) => capability.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('names every component capture after its capability and ships the file', () => {
    for (const capability of manifest.capabilities) {
      if (!capability.visual) {
        continue;
      }
      expect(capability.visual).toBe(`images/components/${capability.id}.png`);
      expect(existsSync(join(root, 'docs', capability.visual))).toBe(true);
    }
  });

  it('keeps the lifecycle vocabulary closed', () => {
    const allowed = new Set(['shipped', 'beta', 'planned']);
    for (const capability of manifest.capabilities) {
      expect(allowed.has(capability.status), capability.id).toBe(true);
    }
  });
});
