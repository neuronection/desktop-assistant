import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeWithDefaults } from '@shared/config/AppConfig';
import {
  UpdateService,
  parseSemver,
  resolveUpdate,
  validateVersionDoc,
} from '@main/services/updates';
import type { VersionDoc } from '@main/services/updates/check';

const release = (version: string, channel: 'stable' | 'beta') => ({
  version,
  tag: `v${version}`,
  channel,
  publishedAt: '2026-10-30T00:00:00Z',
  url: `https://github.com/neuronection/desktop-assistant/releases/tag/v${version}`,
});

const doc = (overrides: Partial<VersionDoc> = {}): VersionDoc => ({
  schemaVersion: 1,
  project: 'desktop-assistant',
  repo: 'neuronection/desktop-assistant',
  generatedAt: '2026-10-30T00:00:00Z',
  checkIntervalSec: 21600,
  latestStable: release('0.10.0', 'stable'),
  latestBeta: null,
  history: [],
  ...overrides,
});

describe('update policy (ADR-0048 clause 2)', () => {
  it('never offers a prerelease to the stable channel, even when it outranks current', () => {
    const d = doc({ latestStable: release('0.10.0', 'stable'), latestBeta: release('0.11.0-rc.1', 'beta') });
    expect(resolveUpdate('0.10.0', 'stable', d)).toEqual({ status: 'up-to-date', release: null });
  });

  it('offers the stable update to the stable channel', () => {
    const d = doc({ latestStable: release('0.11.0', 'stable'), latestBeta: release('0.11.0-rc.1', 'beta') });
    const result = resolveUpdate('0.10.0', 'stable', d);
    expect(result.status).toBe('available');
    expect(result.release?.version).toBe('0.11.0');
  });

  it('offers the final release to a beta client sitting on its rc', () => {
    const d = doc({ latestStable: release('0.11.0', 'stable'), latestBeta: release('0.11.0-rc.1', 'beta') });
    const result = resolveUpdate('0.11.0-rc.1', 'beta', d);
    expect(result.release?.version).toBe('0.11.0');
  });

  it('offers the semver-max candidate to the beta channel', () => {
    const d = doc({ latestStable: release('0.10.0', 'stable'), latestBeta: release('0.11.0-rc.1', 'beta') });
    const result = resolveUpdate('0.10.0', 'beta', d);
    expect(result.release?.version).toBe('0.11.0-rc.1');
  });

  it('never offers a downgrade', () => {
    const d = doc({ latestStable: release('0.10.0', 'stable') });
    expect(resolveUpdate('0.12.0', 'stable', d)).toEqual({ status: 'up-to-date', release: null });
  });

  it('treats an unparseable current version as older than everything', () => {
    const result = resolveUpdate('0.0.0-dev.0', 'stable', doc());
    expect(result.release?.version).toBe('0.10.0');
  });
});

describe('version doc validation (vendored contract)', () => {
  it('agrees with the normative Ajv2020 validation on the real contract', async () => {
    const schema = JSON.parse(await readFile(join(process.cwd(), 'contracts', 'version-api.schema.json'), 'utf8'));
    const ajv = new Ajv2020({ strict: false });
    const ajvValidate = ajv.compile({ $ref: '#/$defs/productVersions', $defs: schema.$defs });
    const good = doc({ latestBeta: release('0.11.0-rc.1', 'beta'), history: [release('0.11.0-rc.1', 'beta'), release('0.10.0', 'stable')] });
    expect(ajvValidate(good)).toBe(true);
    expect(validateVersionDoc(good).ok).toBe(true);

    const bad = { ...good, latestStable: { ...good.latestStable, version: 'v0.10.0' } };
    expect(ajvValidate(bad)).toBe(false);
    expect(validateVersionDoc(bad).ok).toBe(false);

    const missing = { ...good } as Record<string, unknown>;
    delete missing.latestStable;
    expect(ajvValidate(missing)).toBe(false);
    expect(validateVersionDoc(missing).ok).toBe(false);
  });

  it('rejects a stable version carrying a prerelease suffix on the stable channel', () => {
    const bad = doc({ latestStable: release('0.11.0-rc.1', 'stable') });
    expect(validateVersionDoc(bad).ok).toBe(false);
  });

  it('rejects an unknown product document and non-https urls', () => {
    expect(validateVersionDoc({ ...doc(), project: 'Not A Product!' }).ok).toBe(false);
    expect(
      validateVersionDoc({
        ...doc(),
        latestStable: { ...release('0.10.0', 'stable'), url: 'http://insecure.example.com/x' },
      }).ok,
    ).toBe(false);
  });
});

describe('update config', () => {
  it('defaults to the stable channel and honors a saved beta choice', () => {
    expect(mergeWithDefaults({} as never).updates.channel).toBe('stable');
    expect(mergeWithDefaults({ updates: { channel: 'beta' } } as never).updates.channel).toBe('beta');
  });
});

describe('UpdateService', () => {
  const setTimer = vi.fn();
  const clearTimer = vi.fn();

  const service = (overrides: {
    current?: string;
    channel?: 'stable' | 'beta';
    fetchDoc?: (product: string) => Promise<VersionDoc>;
  }) =>
    new UpdateService({
      getAppVersion: () => overrides.current ?? '0.10.0',
      getChannel: vi.fn(() => overrides.channel ?? 'stable'),
      fetchDoc: overrides.fetchDoc ?? (async () => doc()),
      now: () => 1_000_000,
      setTimer,
      clearTimer,
    });

  beforeEach(() => {
    setTimer.mockReset();
    clearTimer.mockReset();
    setTimer.mockReturnValue({ id: setTimer.mock.calls.length });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks 3 s after start and reports an available stable update', async () => {
    const fetchDoc = vi.fn(async () => doc({ latestStable: release('0.11.0', 'stable') }));
    const svc = service({ fetchDoc });
    svc.start();
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer.mock.calls[0][1]).toBe(3_000);

    const armed = setTimer.mock.calls[0][0] as () => void;
    armed();
    const state = await vi.waitFor(() => {
      const current = svc.getState();
      expect(current.status).toBe('available');
      return current;
    });
    expect(fetchDoc).toHaveBeenCalledWith('desktop-assistant');
    expect(state.release?.version).toBe('0.11.0');
    expect(state.lastCheckedAt).not.toBeNull();
  });

  it('arms the next check from checkIntervalSec clamped to 15 min–24 h with jitter', async () => {
    const svc = service({ fetchDoc: async () => doc({ checkIntervalSec: 21_600 }) });
    svc.start();
    (setTimer.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(svc.getState().status).toBe('up-to-date'));
    expect(setTimer).toHaveBeenCalledTimes(2);
    const delay = setTimer.mock.calls[1][1] as number;
    expect(delay).toBeGreaterThanOrEqual(21_600_000);
    expect(delay).toBeLessThanOrEqual(21_600_000 * 1.1 + 1);
  });

  it('arms the ceiling interval at the contract-max checkIntervalSec', async () => {
    const svc = service({ fetchDoc: async () => doc({ checkIntervalSec: 86_400 }) });
    svc.start();
    (setTimer.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(svc.getState().status).toBe('up-to-date'));
    const delay = setTimer.mock.calls[1][1] as number;
    expect(delay).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(24 * 60 * 60 * 1000 * 1.1 + 1);
  });

  it('rejects an out-of-contract interval instead of arming it', async () => {
    const svc = service({ fetchDoc: async () => doc({ checkIntervalSec: 500_000 }) });
    svc.start();
    (setTimer.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(svc.getState().status).toBe('error'));
    expect(svc.getState().error).toContain('checkIntervalSec');
  });

  it('fails soft: an unreachable API becomes an error state plus a delayed retry', async () => {
    const svc = service({ fetchDoc: async () => { throw new Error('version API 503 for desktop-assistant'); } });
    svc.start();
    (setTimer.mock.calls[0][0] as () => void)();
    const state = await vi.waitFor(() => {
      const current = svc.getState();
      expect(current.status).toBe('error');
      return current;
    });
    expect(state.error).toContain('503');
    expect(setTimer).toHaveBeenCalledTimes(2);
    const retryDelay = setTimer.mock.calls[1][1] as number;
    expect(retryDelay).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
    expect(retryDelay).toBeLessThanOrEqual(6 * 60 * 60 * 1000 * 1.1 + 1);
  });

  it('rejects a schema-invalid document instead of trusting it', async () => {
    const invalid = doc({ latestStable: { ...release('0.10.0', 'stable'), version: 'garbage' } }) as unknown as VersionDoc;
    const svc = service({ fetchDoc: async () => invalid });
    svc.start();
    (setTimer.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(svc.getState().status).toBe('error'));
    expect(svc.getState().error).toContain('rejected');
  });

  it('re-checks immediately when the saved channel flips to beta', async () => {
    const fetchDoc = vi.fn(async () => doc({ latestStable: release('0.10.0', 'stable'), latestBeta: release('0.11.0-rc.1', 'beta') }));
    let channel: 'stable' | 'beta' = 'stable';
    const svc = new UpdateService({
      getAppVersion: () => '0.10.0',
      getChannel: () => channel,
      fetchDoc,
      now: () => 1_000_000,
      setTimer,
      clearTimer,
    });
    svc.start();
    (setTimer.mock.calls[0][0] as () => void)();
    await vi.waitFor(() => expect(svc.getState().status).toBe('up-to-date'));
    channel = 'beta';
    await svc.checkNow();
    expect(svc.getState().release?.version).toBe('0.11.0-rc.1');
  });

  it('coalesces concurrent checks', async () => {
    let releaseFetch: () => void = () => {};
    const gated = new Promise<VersionDoc>((resolve) => { releaseFetch = () => resolve(doc()); });
    const svc = service({ fetchDoc: () => gated });
    const first = svc.checkNow();
    const second = svc.checkNow();
    releaseFetch();
    await Promise.all([first, second]);
    expect(svc.getState().status).toBe('up-to-date');
  });

  it('stops cleanly and clears the pending check', () => {
    const svc = service({});
    svc.start();
    svc.stop();
    expect(clearTimer).toHaveBeenCalled();
    expect(svc.getState().nextCheckAt).toBeNull();
  });

  describe('apply (W5a — consent-gated, Linux AppImage)', () => {
    const release = {
      version: '0.11.0',
      tag: 'v0.11.0',
      channel: 'stable' as const,
      publishedAt: '2026-10-30T00:00:00Z',
      url: 'https://github.com/neuronection/desktop-assistant/releases/tag/v0.11.0',
    };

    const installer = (supported: boolean, applyResult?: { ok: true } | { ok: false; reason: string }, mode: 'in-place' | 'wizard' = 'in-place') => ({
      support: () => (supported ? { supported: true, reason: null } : { supported: false, reason: 'dev' }),
      mode: vi.fn(() => mode),
      apply: vi.fn(async () => applyResult ?? { ok: true }),
      install: vi.fn(),
    });

    const svcWithOffer = (
      inst: ReturnType<typeof installer>,
      offered: boolean,
    ) => {
      setTimer.mockClear();
      const svc = new UpdateService({
        getAppVersion: () => '0.10.0',
        getChannel: () => 'stable',
        fetchDoc: async () => (offered ? doc({ latestStable: release }) : doc()),
        installer: inst,
        now: () => 0,
        setTimer,
        clearTimer,
      });
      svc.start();
      (setTimer.mock.calls[0][0] as () => void)();
      return waitForOffer(svc, offered);
    };

    const waitForOffer = (svc: UpdateService, offered: boolean) =>
      vi.waitFor(() => {
        expect(Boolean(svc.getState().release)).toBe(offered);
        return svc;
      });

    it('pushes every state change to the host', async () => {
      const onStateChange = vi.fn();
      setTimer.mockClear();
      const svc = new UpdateService({
        getAppVersion: () => '0.10.0',
        getChannel: () => 'stable',
        fetchDoc: async () => doc({ latestStable: release }),
        installer: installer(true),
        onStateChange,
        now: () => 0,
        setTimer,
        clearTimer,
      });
      svc.start();
      (setTimer.mock.calls[0][0] as () => void)();
      await waitForOffer(svc, true);
      expect(onStateChange).toHaveBeenCalled();
      expect(onStateChange.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'available' });
      expect(onStateChange.mock.calls.at(-1)?.[0].release?.tag).toBe('v0.11.0');
    });

    it('refuses without an offered release', async () => {
      const inst = installer(true);
      const svc = await svcWithOffer(inst, false);
      expect(await svc.apply()).toEqual({ ok: false, reason: 'nothing-offered' });
      expect(inst.apply).not.toHaveBeenCalled();
    });

    it('refuses on unsupported platforms so the UI links out', async () => {
      const inst = installer(false);
      const svc = await svcWithOffer(inst, true);
      expect(svc.getState().apply.supported).toBe(false);
      expect(await svc.apply()).toEqual({ ok: false, reason: 'dev' });
      expect(inst.apply).not.toHaveBeenCalled();
    });

    it('applies the offered release and lands in the downloaded phase', async () => {
      const inst = installer(true);
      const svc = await svcWithOffer(inst, true);
      expect(await svc.apply()).toEqual({ ok: true });
      expect(inst.apply).toHaveBeenCalledWith(release);
      expect(svc.getState().apply.phase).toBe('downloaded');
      svc.install();
      expect(inst.install).toHaveBeenCalled();
    });

    it('lands in the opened phase after a wizard hand-off', async () => {
      const inst = installer(true, undefined, 'wizard');
      const svc = await svcWithOffer(inst, true);
      expect(await svc.apply()).toEqual({ ok: true });
      expect(svc.getState().apply.phase).toBe('opened');
      expect(svc.getState().apply.mode).toBe('wizard');
    });

    it('surfaces a refused apply as an error phase', async () => {
      const inst = installer(true, { ok: false, reason: 'feed-disagreement: test' });
      const svc = await svcWithOffer(inst, true);
      const result = await svc.apply();
      expect(result.ok).toBe(false);
      expect(svc.getState().apply.phase).toBe('error');
      expect(svc.getState().apply.error).toContain('feed-disagreement');
    });

    it('surfaces a thrown apply as an error phase and allows a retry', async () => {
      const inst = installer(true);
      inst.apply.mockImplementationOnce(async () => {
        throw new Error('network down');
      });
      const svc = await svcWithOffer(inst, true);
      expect(await svc.apply()).toEqual({ ok: false, reason: 'network down' });
      expect(svc.getState().apply.phase).toBe('error');
      expect(svc.getState().apply.error).toBe('network down');

      inst.apply.mockImplementationOnce(async () => ({ ok: true }));
      expect(await svc.apply()).toEqual({ ok: true });
      expect(svc.getState().apply.phase).toBe('downloaded');
    });

    it('no-ops install before a download finished', async () => {
      const inst = installer(true);
      const svc = await svcWithOffer(inst, false);
      svc.install();
      expect(inst.install).not.toHaveBeenCalled();
    });
  });
});

describe('generated schema module matches the vendored contract', () => {
  it('VERSION_API_SCHEMA equals contracts/version-api.schema.json (regen drift gate)', async () => {
    const contract = JSON.parse(
      await readFile(join(process.cwd(), 'contracts', 'version-api.schema.json'), 'utf8'),
    );
    const generated = await import('@shared/updates/version-api.schema.generated');
    expect(generated.VERSION_API_SCHEMA).toEqual(contract);
  });
});
