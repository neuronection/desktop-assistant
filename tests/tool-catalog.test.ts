import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { describeParameters, nativeCatalogEntries } from '@main/ai/tools/catalog';
import type { NativeToolDefinition } from '@main/ai/tools/types';

const schema = z.object({
  path: z.string().describe('File path to read.'),
  maxBytes: z.number().int().min(1).optional().describe('Read cap.'),
  mode: z.enum(['text', 'binary']).default('text').describe('Read mode.'),
  tags: z.array(z.string()).optional(),
  meta: z.object({ deep: z.boolean() }).optional().describe('Nested metadata.'),
  ratio: z.number().optional(),
  legacy: z.boolean().nullable().describe('Legacy flag.'),
});

const tool: NativeToolDefinition = {
  name: 'read_file',
  description: 'Read a text file.',
  schema,
  risk: 'read-only',
  category: 'files',
  summarize: () => 'read',
  async exec() {
    return 'ok';
  },
};

describe('describeParameters', () => {
  it('flattens a zod object schema into parameter rows', () => {
    const parameters = describeParameters(schema);
    expect(parameters).toEqual([
      { name: 'path', type: 'string', required: true, description: 'File path to read.' },
      { name: 'maxBytes', type: 'integer', required: false, description: 'Read cap.' },
      { name: 'mode', type: 'enum', required: false, description: 'Read mode.', enumValues: ['text', 'binary'], defaultValue: '"text"' },
      { name: 'tags', type: 'array<string>', required: false },
      { name: 'meta', type: 'object', required: false, description: 'Nested metadata.' },
      { name: 'ratio', type: 'number', required: false },
      { name: 'legacy', type: 'boolean | null', required: true, description: 'Legacy flag.' },
    ]);
  });

  it('returns nothing for non-object schemas', () => {
    expect(describeParameters(z.string())).toEqual([]);
    expect(describeParameters(undefined as unknown as z.ZodTypeAny)).toEqual([]);
  });
});

describe('nativeCatalogEntries', () => {
  const snapshot = {
    toolGrants: { read_file: 'always' as const },
    disabledTools: ['other'],
    grantedRoots: [],
    toolSettings: { read_file: { mode: 'always_ask' as const } },
    classDefaults: { stateChanging: 'never' as const },
  };

  it('joins registry definitions with the policy snapshot', () => {
    const rows = nativeCatalogEntries([tool], snapshot);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'read_file',
      description: 'Read a text file.',
      risk: 'read-only',
      category: 'files',
      editableArgs: false,
      enabled: true,
      granted: true,
      source: 'native',
      verification: { mode: 'always_ask' },
      verificationCustom: true,
    });
    expect(rows[0].parameters.map((parameter) => parameter.name)).toContain('path');
  });

  it('reflects class defaults as non-custom verification', () => {
    const stateChangingTool: NativeToolDefinition = { ...tool, name: 'notify', risk: 'state-changing', category: 'desktop' };
    const rows = nativeCatalogEntries([stateChangingTool], snapshot);
    expect(rows[0].verification).toEqual({ mode: 'never' });
    expect(rows[0].verificationCustom).toBe(false);
  });

  it('defaults verification to standard', () => {
    const rows = nativeCatalogEntries([tool], {
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
      toolSettings: {},
      classDefaults: {},
    });
    expect(rows[0].verification).toEqual({ mode: 'standard' });
    expect(rows[0].verificationCustom).toBe(false);
  });
});
