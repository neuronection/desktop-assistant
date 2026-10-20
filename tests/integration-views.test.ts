import { describe, it, expect } from 'vitest';
import { INTEGRATION_VIEW_MODELS_VERSION } from '@neuronection/assistant-ui/integration-contracts';
import {
  capabilityViews,
  consentView,
  installGroup,
  installGroups,
  orphanGroups,
  packCardView,
  packConfigFields,
  packConfigValues,
  sourceDraftToDescriptor,
  sourceRefStrategy,
  sourceRow,
  sourceRows,
  toConfigWire,
  updateConsentView,
} from '@renderer/settings-react/apps/integration-views';
import type { ConsentPayload, MiniAppSourceInstallView, MiniAppSourceView, MiniAppSourcesState, MiniAppView, SourceCandidate } from '@shared/app-pack';
import { EXTENSION_CHARTER } from '@shared/app-pack';

const pack: MiniAppView = {
  id: 'sample-review',
  version: '1.2.3',
  kind: 'assessment',
  title: 'Sample review',
  description: 'Reviews samples',
  capabilities: ['fs-read', 'ui', 'run', 'report'],
  enabled: true,
  originKind: 'imported',
  commands: [],
  configFields: [
    { name: 'freshDays', label: 'Keep days', type: 'number', default: 7, minimum: 0, maximum: 365 },
    { name: 'mode', type: 'string', enum: ['conservative', 'balanced'], default: 'conservative' },
    { name: 'dryRun', type: 'boolean', default: true },
    { name: 'exceptions', type: 'array', default: [] },
    { name: 'rootHint', type: 'string', pattern: '^/' },
  ],
  configValues: { freshDays: 14, junk: { nested: true } },
};

const consent: ConsentPayload = {
  extensionId: 'cv-gallery',
  version: '1.1.0',
  subpath: 'cv-gallery',
  digest: 'a'.repeat(64),
  tier: 'T0',
  importClass: 'imported',
  originClass: 'imported',
  capabilities: ['fs-read', 'run'],
  provenance: { author: 'Ada', license: 'MIT', repository: 'https://git.example.com/ada/cv-gallery' },
  disclosure: 'verbatim law text',
};

function installRow(overrides: Partial<MiniAppSourceInstallView> = {}): MiniAppSourceInstallView {
  return {
    extensionId: 'cv-gallery',
    sourceId: 'src-1',
    version: '1.0.0',
    digest: 'c'.repeat(64),
    pinRef: 'v1.0.0',
    parked: false,
    originClass: 'imported',
    provenance: {},
    consentedAt: 1_700_000_000_000,
    update: null,
    enabled: false,
    ...overrides,
  };
}

const source: MiniAppSourceView = {
  id: 'src-1',
  kind: 'git',
  origin: 'https://git.example.com/ada/extensions',
  status: 'degraded',
  error: 'timed out',
  lastCheckedAt: 1_700_000_000_000,
  consecutiveFailures: 2,
  candidates: [
    { extensionId: 'new-pack', subpath: 'new-pack', digest: 'b'.repeat(64), ref: 'v2', compatible: true, consent },
    { extensionId: 'cv-gallery', subpath: 'cv-gallery', digest: 'a'.repeat(64), ref: 'v1', compatible: true, consent },
  ],
  ref: { strategy: 'tag-pattern', value: 'v*' },
  subpath: 'packs',
  installs: [installRow()],
};

describe('integration view-model mapping (plan 33 Phase C)', () => {
  it('pins the kit view-model generation', () => {
    expect(INTEGRATION_VIEW_MODELS_VERSION).toBe(1);
  });

  it('maps pack cards onto the kit extension view with narrowable vocabularies', () => {
    const view = packCardView(pack);
    expect(view).toMatchObject({
      id: 'sample-review',
      name: 'Sample review',
      version: '1.2.3',
      summary: 'Reviews samples',
      originClass: 'imported',
      tier: 'T0',
      kind: 'mini-app',
    });
    expect(view.capabilities?.map((capability) => capability.id)).toEqual(['fs-read', 'ui', 'run', 'report']);
    expect(packCardView({ ...pack, originKind: 'bundled', description: undefined }).originClass).toBe('bundled');
    expect(capabilityViews(['fs-read', 'ui']).map((capability) => capability.riskClass)).toEqual([null, null]);
  });

  it('renders envelope-shared provenance + categories verbatim, narrowed through the generated vocabulary (D25)', () => {
    const view = packCardView({
      ...pack,
      author: 'Neuronection',
      license: 'Apache-2.0',
      repository: 'https://github.com/neuronection/desktop-assistant',
      categories: ['files', 'utilities', 'not-a-category'],
    });
    expect(view.provenance).toEqual({
      author: 'Neuronection',
      license: 'Apache-2.0',
      repository: 'https://github.com/neuronection/desktop-assistant',
      description: 'Reviews samples',
    });
    expect(view.categories).toEqual(['files', 'utilities']);
    expect(packCardView(pack).provenance).toBeNull();
    expect(packCardView(pack).categories).toBeUndefined();
    const authorOnly = packCardView({ ...pack, author: 'A' }).provenance;
    expect(authorOnly).toMatchObject({ author: 'A', description: 'Reviews samples' });
    expect(authorOnly).not.toHaveProperty('license');
    expect(authorOnly).not.toHaveProperty('repository');
  });

  it('maps the flattened config field views onto kit config fields', () => {
    const fields = packConfigFields(pack);
    expect(fields).toHaveLength(5);
    expect(fields[0]).toMatchObject({ name: 'freshDays', type: 'number', title: 'Keep days', defaultValue: 7, minimum: 0, maximum: 365, secret: false, required: false });
    expect(fields[1]).toMatchObject({ name: 'mode', enum: ['conservative', 'balanced'], title: null });
    expect(fields[3]).toMatchObject({ name: 'exceptions', type: 'array', itemType: null });
    expect(fields[4]).toMatchObject({ name: 'rootHint', pattern: '^/' });
  });

  it('seeds kit config values from stored values over defaults and drops them for the wire when null', () => {
    const values = packConfigValues(pack);
    expect(values.freshDays).toBe(14);
    expect(values.mode).toBe('conservative');
    expect(values.exceptions).toEqual([]);
    expect(values.junk).toBeUndefined();
    expect(toConfigWire({ freshDays: null, mode: 'balanced', dryRun: true, exceptions: ['a', 'b'] })).toEqual({
      mode: 'balanced',
      dryRun: true,
      exceptions: ['a', 'b'],
    });
  });

  it('narrows source ref strategies through the generated vocabulary', () => {
    expect(sourceRefStrategy('tag-pattern')).toBe('tag-pattern');
    expect(sourceRefStrategy('mystery')).toBeNull();
  });

  it('maps a source row: status, error, pinned ref, dead candidates filtered, installs nested as groups', () => {
    const row = sourceRow(source, source.installs);
    expect(row).toMatchObject({
      id: 'src-1',
      kind: 'git',
      origin: 'https://git.example.com/ada/extensions',
      status: 'degraded',
      error: 'timed out',
      lastCheckedAt: new Date(1_700_000_000_000).toISOString(),
      consecutiveFailures: 2,
      refStrategy: 'tag-pattern',
      refValue: 'v*',
      gitops: false,
    });
    expect(row.candidates.map((candidate) => candidate.extensionId)).toEqual(['new-pack']);
    expect(row.candidates[0].consent?.disclosure).toBe('verbatim law text');
    expect(row.candidates[0].metadata).toEqual({ subpath: 'new-pack' });
    expect(row.groups).toHaveLength(1);
    expect(row.groups[0].instances[0].id).toBe('cv-gallery');
  });

  it('maps an installed group: digest, pin metadata, update states, park and failure status', () => {
    const instance = installGroup(
      installRow({
        parked: true,
        parkedReason: 'source removed',
        error: '$.apiVersion: too old',
        update: {
          state: 'available',
          ref: 'v1.1.0',
          digest: 'a'.repeat(64),
          manifestDiff: { byteIdentical: false, changed: ['version', 'capabilities'], versionFrom: '1.0.0', versionTo: '1.1.0', capabilitiesAdded: ['propose'], configSchemaChanged: false },
          requiresReconsent: true,
        },
      })
    ).instances[0];
    expect(instance).toMatchObject({
      id: 'cv-gallery',
      name: 'cv-gallery',
      enabled: false,
      status: 'failing',
      originClass: 'imported',
      tier: 'T0',
      parked: true,
      digest: 'c'.repeat(64),
    });
    expect(instance.update).toEqual({
      state: 'available',
      version: '1.1.0',
      ref: 'v1.1.0',
      digest: 'a'.repeat(64),
      requiresReconsent: true,
      detail: null,
    });
    const metadata = instance.metadata as Record<string, unknown>;
    expect(metadata).toMatchObject({ pinRef: 'v1.0.0', absentFromSource: false, requiresReconsent: true });

    const drift = installGroup(installRow({ update: { state: 'digest-drift', ref: 'v1', expectedDigest: 'c', foundDigest: 'd', detail: 'changed' } })).instances[0];
    expect(drift.update).toMatchObject({ state: 'digest-drift', digest: 'd', detail: 'changed' });

    const absent = installGroup(installRow({ update: { state: 'absent-from-source' } })).instances[0];
    expect(absent.update).toBeNull();
    expect((absent.metadata as Record<string, unknown>).absentFromSource).toBe(true);
  });

  it('groups installs by extension and separates orphans whose source is gone', () => {
    const state: MiniAppSourcesState = {
      sources: [source],
      installs: [
        installRow(),
        installRow({ extensionId: 'parked-pack', sourceId: 'gone-src', parked: true }),
        installRow({ extensionId: 'cv-gallery' }),
      ],
    };
    expect(sourceRows(state)).toHaveLength(1);
    expect(installGroups(state.installs)).toHaveLength(2);
    const orphans = orphanGroups(state);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].extension.id).toBe('parked-pack');
    expect(orphans[0].instances[0].parked).toBe(true);
  });

  it('maps consent payloads verbatim and update consents with change summaries', () => {
    const installed = consentView(consent);
    expect(installed).toMatchObject({
      variant: 'install',
      extensionId: 'cv-gallery',
      version: '1.1.0',
      tier: 'T0',
      importClass: 'imported',
      digest: 'a'.repeat(64),
      disclosure: 'verbatim law text',
      changeSummary: null,
    });
    expect(installed.capabilities.map((capability) => capability.id)).toEqual(['fs-read', 'run']);

    const updateInstall = installRow({
      update: {
        state: 'available',
        ref: 'v1.1.0',
        digest: 'a'.repeat(64),
        manifestDiff: { byteIdentical: false, changed: ['version', 'capabilities', 'configSchema'], versionFrom: '1.0.0', versionTo: '1.1.0', capabilitiesAdded: ['propose'], configSchemaChanged: true },
        requiresReconsent: true,
      },
    });
    const reconsent = updateConsentView(updateInstall, { consent: { ...consent, capabilities: ['fs-read', 'run', 'propose'] } } as SourceCandidate);
    expect(reconsent).toMatchObject({ variant: 're-consent', extensionId: 'cv-gallery', version: '1.1.0' });
    expect(reconsent?.changeSummary).toEqual({
      changed: ['version', 'capabilities', 'configSchema'],
      addedCapabilities: ['propose'],
      versionChange: { from: '1.0.0', to: '1.1.0' },
      digestChange: { from: 'c'.repeat(64), to: 'a'.repeat(64) },
    });

    const orphanUpdate = updateConsentView(updateInstall, undefined);
    expect(orphanUpdate).toMatchObject({ variant: 're-consent', disclosure: '' });
    expect(orphanUpdate?.provenance).toEqual(updateInstall.provenance);

    const plainUpdate = updateConsentView(
      installRow({ update: { state: 'available', ref: 'v', digest: 'a', manifestDiff: { byteIdentical: true, changed: [], versionFrom: '1', versionTo: '1', capabilitiesAdded: [], configSchemaChanged: false }, requiresReconsent: false } }),
      undefined
    );
    expect(plainUpdate?.variant).toBe('update');
    expect(updateConsentView(installRow(), undefined)).toBeNull();
  });

  it('keys the disclosure to the charter text (F40): keyed, verbatim, equality-pinned', () => {
    const t0 = consentView({ ...consent, disclosure: EXTENSION_CHARTER.consent.t0DeclarativeDisclosure as string });
    expect(t0.disclosureKey).toBe('t0DeclarativeDisclosure');
    expect(t0.disclosure).toBe(EXTENSION_CHARTER.consent.t0DeclarativeDisclosure);
    const t2 = consentView({
      ...consent,
      tier: 'T2',
      disclosure: EXTENSION_CHARTER.consent.t2SandboxDisclosure as string,
    });
    expect(t2.disclosureKey).toBe('t2SandboxDisclosure');
    expect(t2.disclosure).toBe(EXTENSION_CHARTER.consent.t2SandboxDisclosure);
    // no disclosure text, no key — the key must never name text that is absent
    expect(consentView({ ...consent, disclosure: '' }).disclosureKey).toBeNull();
  });

  it('converts kit source drafts into validated-descriptor documents and sealed secrets', () => {
    expect(sourceDraftToDescriptor({ url: 'https://git.example.com/x', localPath: '', refStrategy: 'release-tag', refValue: '', subpath: '', secretSlot: null, secretValue: '' })).toEqual({
      descriptor: { url: 'https://git.example.com/x', ref: { strategy: 'release-tag' } },
      secrets: undefined,
    });
    expect(
      sourceDraftToDescriptor({ url: 'https://git.example.com/x', localPath: '', refStrategy: 'branch', refValue: 'main', subpath: 'packs', secretSlot: null, secretValue: '' })
    ).toEqual({
      descriptor: { url: 'https://git.example.com/x', ref: { strategy: 'branch', value: 'main' }, subpath: 'packs' },
      secrets: undefined,
    });
    expect(
      sourceDraftToDescriptor({ url: '', localPath: '/home/you/exts', refStrategy: 'commit-pin', refValue: 'abc', subpath: '', secretSlot: 'ext-source:token', secretValue: 'tok' })
    ).toEqual({
      descriptor: { local: { path: '/home/you/exts' }, ref: { strategy: 'commit-pin', value: 'abc' } },
      secrets: { 'ext-source:token': 'tok' },
    });
  });
});
