import type { UpdateApplyState, UpdateChannel, UpdateState } from '@shared/types';
import { fetchVersionDoc, validateVersionDoc, type VersionDoc } from './check';
import { resolveUpdate } from './policy';
import { UpdateInstaller, type AutoUpdaterLike, type UpdateInstallerLike } from './updater';

const INITIAL_DELAY_MS = 3_000;
const MIN_INTERVAL_MS = 15 * 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILED_RETRY_MS = 6 * 60 * 60 * 1000;
const JITTER_FRACTION = 0.1;

export interface UpdateServiceDeps {
  getAppVersion: () => string;
  getChannel: () => UpdateChannel;
  fetchDoc?: (product: string) => Promise<VersionDoc>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  installerPlatform?: NodeJS.Platform;
  installerIsPackaged?: boolean;
  installerIsAppImage?: boolean;
  loadUpdater?: () => Promise<AutoUpdaterLike | null>;
  onProgressPush?: (percent: number) => void;
  onStateChange?: (state: UpdateState) => void;
  installer?: UpdateInstallerLike;
}

export class UpdateService {
  private readonly deps: UpdateServiceDeps;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly fetchDoc: (product: string) => Promise<VersionDoc>;
  private readonly installer: UpdateInstallerLike;
  private timer: unknown = null;
  private checking = false;
  private state: UpdateState;

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.fetchDoc = deps.fetchDoc ?? ((product) => fetchVersionDoc(product));
    this.installer =
      deps.installer ??
      new UpdateInstaller({
        platform: deps.installerPlatform,
        isPackaged: deps.installerIsPackaged,
        isAppImage: deps.installerIsAppImage,
        channel: deps.getChannel,
        onProgress: (percent) => {
          this.patchApply({ phase: 'downloading', progress: percent });
          deps.onProgressPush?.(percent);
        },
        onDownloaded: () => this.patchApply({ phase: 'downloaded', progress: 100 }),
        loadUpdater: deps.loadUpdater,
      });
    this.state = {
      status: 'idle',
      channel: deps.getChannel(),
      currentVersion: '',
      release: null,
      lastCheckedAt: null,
      nextCheckAt: null,
      error: null,
      apply: {
        ...this.installer.support(),
        mode: this.installer.mode(),
        phase: 'idle',
        progress: null,
        error: null,
      },
    };
  }

  getState(): UpdateState {
    return {
      ...this.state,
      channel: this.deps.getChannel(),
      currentVersion: this.deps.getAppVersion(),
    };
  }

  start(): void {
    this.arm(INITIAL_DELAY_MS, 0);
  }

  stop(): void {
    this.disarm();
    this.patch({ nextCheckAt: null });
  }

  async checkNow(): Promise<UpdateState> {
    if (this.checking) return this.getState();
    this.checking = true;
    this.patch({ status: 'checking', error: null });
    try {
      const doc = await this.fetchDoc('desktop-assistant');
      const validation = validateVersionDoc(doc);
      if (!validation.ok) {
        throw new Error(`version API response rejected: ${validation.reason}`);
      }
      const resolved = resolveUpdate(this.deps.getAppVersion(), this.deps.getChannel(), doc);
      this.patch({
        status: resolved.status,
        release: resolved.release,
        currentVersion: this.deps.getAppVersion(),
        lastCheckedAt: new Date(this.now()).toISOString(),
        error: null,
      });
      this.arm(clampInterval(doc.checkIntervalSec * 1000));
    } catch (error) {
      this.patch({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: new Date(this.now()).toISOString(),
      });
      this.arm(FAILED_RETRY_MS);
    } finally {
      this.checking = false;
    }
    return this.getState();
  }

  async apply(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const release = this.state.release;
    if (!release) return { ok: false, reason: 'nothing-offered' };
    if (!this.state.apply.supported) {
      return { ok: false, reason: this.state.apply.reason ?? 'unsupported' };
    }
    this.patchApply({ phase: 'downloading', progress: 0, error: null });
    let result: { ok: true } | { ok: false; reason: string };
    try {
      result = await this.installer.apply(release);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.patchApply({ phase: 'error', error: reason });
      return { ok: false, reason };
    }
    if (!result.ok) {
      this.patchApply({ phase: 'error', error: result.reason });
      return result;
    }
    this.patchApply({
      phase: this.installer.mode() === 'wizard' ? 'opened' : 'downloaded',
      progress: 100,
    });
    return { ok: true };
  }

  install(): void {
    if (this.state.apply.phase !== 'downloaded') return;
    this.installer.install();
  }

  private patchApply(partial: Partial<UpdateApplyState>): void {
    this.patch({ apply: { ...this.state.apply, ...partial } });
  }

  private arm(intervalMs: number, jitterFraction: number = JITTER_FRACTION): void {
    this.disarm();
    const jitter = Math.floor(Math.random() * intervalMs * jitterFraction);
    const delay = Math.max(0, Math.floor(intervalMs) + jitter);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.checkNow();
    }, delay);
    this.patch({ nextCheckAt: new Date(this.now() + delay).toISOString() });
  }

  private disarm(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private patch(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial };
    this.deps.onStateChange?.(this.getState());
  }
}

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return FAILED_RETRY_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

export { resolveUpdate } from './policy';
export { fetchVersionDoc, validateVersionDoc, UPDATE_API_BASE, UPDATE_PRODUCT } from './check';
export { compareSemver, channelOf, parseSemver } from './semver';
