import { describe, expect, it } from 'vitest';
import {
  parseIntegrationManifest,
  manifestSecretRefs,
  manifestCommandArity,
  isSecretRef,
  secretRefKey,
} from '@shared/commands/manifest';

const VALID_MANIFEST = {
  manifestVersion: 1,
  id: 'acme-pack',
  name: 'Acme Pack',
  commands: [
    {
      kind: 'tool',
      name: 'open-docs',
      title: 'Open Acme docs',
      aliases: ['acme'],
      toolName: 'open_url',
      argTemplate: { url: 'https://docs.acme.example/{{1}}' },
    },
  ],
};

describe('parseIntegrationManifest', () => {
  it('accepts a valid manifest', () => {
    const result = parseIntegrationManifest(JSON.stringify(VALID_MANIFEST));
    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON, wrong versions and bad shapes', () => {
    expect(parseIntegrationManifest('not json').ok).toBe(false);
    expect(
      parseIntegrationManifest(JSON.stringify({ ...VALID_MANIFEST, manifestVersion: 2 })).ok
    ).toBe(false);
    expect(parseIntegrationManifest(JSON.stringify({ ...VALID_MANIFEST, commands: [] })).ok).toBe(false);
    expect(
      parseIntegrationManifest(JSON.stringify({ ...VALID_MANIFEST, id: 'Bad Id!' })).ok
    ).toBe(false);
  });

  it('enforces kind-specific required fields with a path in the error', () => {
    const missingTemplate = {
      ...VALID_MANIFEST,
      commands: [{ kind: 'tool', name: 'x', title: 'X', toolName: 'open_url' }],
    };
    const result = parseIntegrationManifest(JSON.stringify(missingTemplate));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('argTemplate');
    }
    const missingBody = {
      ...VALID_MANIFEST,
      commands: [{ kind: 'http', name: 'x', title: 'X', method: 'POST', urlTemplate: 'https://x' }],
    };
    const bodyResult = parseIntegrationManifest(JSON.stringify(missingBody));
    expect(bodyResult.ok).toBe(false);
    if (!bodyResult.ok) {
      expect(bodyResult.error).toContain('bodyTemplate');
    }
  });
});

describe('secret refs', () => {
  it('detects and extracts secret references', () => {
    expect(isSecretRef('${secret:deployKey}')).toBe(true);
    expect(isSecretRef('Bearer ${secret:token}')).toBe(false);
    expect(isSecretRef('application/json')).toBe(false);
    expect(secretRefKey('${secret:deploy-Key_1}')).toBe('deploy-Key_1');
  });

  it('lists secret refs across headers only', () => {
    const refs = manifestSecretRefs({
      kind: 'http',
      name: 'trigger',
      title: 'Trigger',
      method: 'POST',
      urlTemplate: 'https://api.example/{{1}}',
      headers: { Authorization: '${secret:deployKey}', 'Content-Type': 'application/json' },
      bodyTemplate: '{}',
    });
    expect(refs).toEqual(['deployKey']);
  });
});

describe('manifestCommandArity', () => {
  it('takes the highest placeholder index across templates', () => {
    expect(
      manifestCommandArity({ argTemplate: { url: 'https://x/{{1}}/{{3}}' }, promptTemplate: '{{query}}' })
    ).toBe(3);
    expect(manifestCommandArity({})).toBe(0);
  });
});
