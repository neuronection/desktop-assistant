// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MiniAppsSection } from '@renderer/settings-react/apps/MiniAppsSection';
import { TEXT } from '@shared/constants/text';
import type { MiniAppSourceInstallView, MiniAppSourceView, MiniAppsState } from '@shared/app-pack';

afterEach(cleanup);

const consentPayload = {
  extensionId: 'cv-gallery',
  version: '1.1.0',
  subpath: 'cv-gallery',
  digest: 'a'.repeat(64),
  tier: 'T0' as const,
  importClass: 'imported' as const,
  originClass: 'imported' as const,
  capabilities: ['fs-read', 'run', 'report'],
  provenance: { author: 'Ada Author', license: 'MIT', repository: 'https://git.example.com/ada/cv-gallery' },
  disclosure: 'This extension is declarative data only — the verbatim charter disclosure.',
};

const source: MiniAppSourceView = {
  id: 'src-1',
  kind: 'git',
  origin: 'https://git.example.com/ada/extensions',
  status: 'ok',
  consecutiveFailures: 0,
  candidates: [
    {
      extensionId: 'cv-gallery',
      subpath: 'cv-gallery',
      digest: 'a'.repeat(64),
      ref: 'v1.1.0',
      compatible: true,
      consent: consentPayload,
    },
    {
      extensionId: 'page-pack',
      subpath: 'page-pack',
      digest: 'b'.repeat(64),
      ref: 'v1.1.0',
      compatible: false,
      reason: "capability 'ui:page' is not honored by this host — self-disable",
      consent: { ...consentPayload, extensionId: 'page-pack', digest: 'b'.repeat(64), capabilities: ['ui:page'] },
    },
  ],
  ref: { strategy: 'release-tag' },
  subpath: '',
  installs: [],
};

const install: MiniAppSourceInstallView = {
  extensionId: 'cv-gallery',
  sourceId: 'src-1',
  version: '1.0.0',
  digest: 'c'.repeat(64),
  pinRef: 'v1.0.0',
  parked: false,
  originClass: 'imported',
  provenance: consentPayload.provenance,
  consentedAt: 1_700_000_000_000,
  update: null,
  enabled: false,
};

function mockApi(sources: MiniAppSourceView[], installs: MiniAppSourceInstallView[], packs: MiniAppsState['packs'] = [], overrides: Record<string, unknown> = {}): void {
  window.electronAPI = {
    getMiniApps: vi.fn(async () => ({ masterEnabled: true, packs, removedBundled: [] })),
    getMiniAppSources: vi.fn(async () => ({ sources, installs })),
    addMiniAppSource: vi.fn(async () => ({ ok: true, source })),
    removeMiniAppSource: vi.fn(async () => ({ ok: true })),
    syncMiniAppSource: vi.fn(async () => ({ ok: true, resolvedRef: 'v1.1.0', candidates: [], updates: [] })),
    installMiniAppExtension: vi.fn(async () => ({ ok: true, extensionId: 'cv-gallery', view: install })),
    applyMiniAppExtensionUpdate: vi.fn(async () => ({ ok: true, extensionId: 'cv-gallery', view: install })),
    restoreMiniAppExtension: vi.fn(async () => ({ ok: true, extensionId: 'cv-gallery' })),
    openFile: vi.fn(async () => null),
  } as unknown as typeof window.electronAPI;
  for (const [key, value] of Object.entries(overrides)) {
    (window.electronAPI as unknown as Record<string, unknown>)[key] = value;
  }
}

describe('ExtensionSourcesSection (plan 32 Phase 8)', () => {
  it('lists sources with kind + status + ref chips and listed candidates with origin chips', async () => {
    mockApi([source], []);
    render(<MiniAppsSection />);
    expect(await screen.findByText('https://git.example.com/ada/extensions')).toBeTruthy();
    expect(screen.getByText(TEXT.EXT_SOURCES_KIND_GIT)).toBeTruthy();
    expect(screen.getByText(TEXT.EXT_SOURCES_STATUS_OK)).toBeTruthy();
    expect(screen.getAllByText(TEXT.EXT_SOURCES_ORIGIN_LISTED).length).toBe(2);
    expect(screen.getByText('cv-gallery')).toBeTruthy();
    expect(screen.getByText(/not honored by this host/)).toBeTruthy();
    const installButtons = screen.getAllByRole('button', { name: 'Install…' });
    expect(installButtons.length).toBe(2);
    expect(installButtons[1].hasAttribute('disabled')).toBe(true);
  });

  it('the consent dialog names capabilities, provenance, digest, tier and the verbatim disclosure before install', async () => {
    mockApi([source], []);
    render(<MiniAppsSection />);
    const installButtons = await screen.findAllByRole('button', { name: 'Install…' });
    fireEvent.click(installButtons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('cv-gallery');
    expect(dialog.textContent).toContain('fs-read');
    expect(dialog.textContent).toContain('Ada Author');
    expect(dialog.textContent).toContain('MIT');
    expect(dialog.textContent).toContain('https://git.example.com/ada/cv-gallery');
    expect(dialog.textContent).toContain('a'.repeat(64));
    expect(dialog.textContent).toContain('T0 — declarative data only');
    expect(dialog.textContent).toContain('verbatim charter disclosure');
    fireEvent.click(within(dialog).getByRole('button', { name: TEXT.EXT_SOURCES_CONSENT_CONFIRM }));
    await waitFor(() => expect(window.electronAPI.installMiniAppExtension).toHaveBeenCalledWith('src-1', 'cv-gallery', true));
  });

  it('shows pin + update state and routes re-consent updates through the consent dialog', async () => {
    const updateInstall: MiniAppSourceInstallView = {
      ...install,
      update: {
        state: 'available',
        ref: 'v1.1.0',
        digest: 'a'.repeat(64),
        manifestDiff: { versionFrom: '1.0.0', versionTo: '1.1.0', capabilitiesAdded: ['propose'], configSchemaChanged: false },
        requiresReconsent: true,
      },
    };
    mockApi([source], [updateInstall]);
    render(<MiniAppsSection />);
    expect(await screen.findByText(/1\.0\.0 → 1\.1\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.EXT_SOURCES_UPDATE_APPLY }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain(TEXT.EXT_SOURCES_CONSENT_RECONSENT_NOTICE);
    fireEvent.click(within(dialog).getByRole('button', { name: TEXT.EXT_SOURCES_CONSENT_CONFIRM }));
    await waitFor(() => expect(window.electronAPI.applyMiniAppExtensionUpdate).toHaveBeenCalledWith('src-1', 'cv-gallery', true));
  });

  it('renders digest drift as a loud failure and parked installs with restore', async () => {
    mockApi([source], [
      {
        ...install,
        update: { state: 'digest-drift', ref: 'v1.0.0', expectedDigest: 'c'.repeat(64), foundDigest: 'd'.repeat(64), detail: 'changed' },
      },
      {
        ...install,
        extensionId: 'parked-pack',
        parked: true,
        parkedReason: 'source removed',
        update: { state: 'absent-from-source' },
      },
    ]);
    render(<MiniAppsSection />);
    expect(await screen.findByText(TEXT.EXT_SOURCES_UPDATE_DRIFT)).toBeTruthy();
    expect(screen.getByText(TEXT.EXT_SOURCES_UPDATE_ABSENT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.EXT_SOURCES_RESTORE }));
    await waitFor(() => expect(window.electronAPI.restoreMiniAppExtension).toHaveBeenCalledWith('parked-pack'));
  });

  it('adds a source through the form (descriptor assembled renderer-side, validated main-side)', async () => {
    mockApi([], []);
    render(<MiniAppsSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.EXT_SOURCES_ADD }));
    fireEvent.click(await screen.findByRole('button', { name: TEXT.EXT_SOURCES_ADD_KIND_GIT }));
    const url = screen.getByPlaceholderText(TEXT.EXT_SOURCES_ADD_URL_PLACEHOLDER) as HTMLInputElement;
    fireEvent.change(url, { target: { value: 'https://git.example.com/ada/extensions' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.EXT_SOURCES_ADD_SUBMIT }));
    await waitFor(() =>
      expect(window.electronAPI.addMiniAppSource).toHaveBeenCalledWith(
        { url: 'https://git.example.com/ada/extensions', ref: { strategy: 'release-tag' } },
        undefined
      )
    );
  });

  it('surfaces a failed sync as a typed notice', async () => {
    mockApi([source], [], [], {
      syncMiniAppSource: vi.fn(async () => ({ ok: false, error: { code: 'unreachable', detail: 'git ls-remote timed out' } })),
    });
    render(<MiniAppsSection />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.EXT_SOURCES_SYNC }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('unreachable'));
  });
});
