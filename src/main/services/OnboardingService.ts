import { desktopCapturer, shell, systemPreferences } from 'electron';
import type { AppConfig } from '@shared/config/AppConfig';
import type { OnboardingPermission, OnboardingPermissionKind, OnboardingStatus } from '@shared/onboarding';
import { hasConfiguredProvider } from '@shared/ai/providerPresets';

interface PreferencesLike {
  getMediaAccessStatus(type: 'microphone' | 'screen' | 'camera'): string;
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  askForMediaAccess(type: 'microphone' | 'camera'): Promise<boolean>;
}

export interface OnboardingServiceDeps {
  getConfig: () => AppConfig;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  onChanged?: () => void;
  toggleHotkey: () => string | null;
  platform?: NodeJS.Platform;
  preferences?: PreferencesLike;
  openExternal?: (url: string) => Promise<void>;
  captureScreen?: () => Promise<unknown>;
}

function mapStatus(value: string): OnboardingPermission['status'] {
  if (value === 'granted') {
    return 'granted';
  }
  if (value === 'denied') {
    return 'denied';
  }
  if (value === 'restricted') {
    return 'restricted';
  }
  return 'unknown';
}

export class OnboardingService {
  constructor(private readonly deps: OnboardingServiceDeps) {}

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  private preferences(): PreferencesLike {
    return this.deps.preferences ?? (systemPreferences as unknown as PreferencesLike);
  }

  private permission(kind: OnboardingPermissionKind): OnboardingPermission {
    const platform = this.platform();
    if (kind === 'accessibility') {
      if (platform !== 'darwin') {
        return { kind, status: 'not-applicable' };
      }
      try {
        return { kind, status: this.preferences().isTrustedAccessibilityClient(false) ? 'granted' : 'unknown' };
      } catch {
        return { kind, status: 'unknown' };
      }
    }
    if (platform === 'linux') {
      return { kind, status: 'not-applicable' };
    }
    try {
      return { kind, status: mapStatus(this.preferences().getMediaAccessStatus(kind)) };
    } catch {
      return { kind, status: 'unknown' };
    }
  }

  status(): OnboardingStatus {
    const config = this.deps.getConfig();
    return {
      platform: this.platform(),
      hotkey: this.deps.toggleHotkey() ?? '',
      permissions: [this.permission('microphone'), this.permission('screen'), this.permission('accessibility')],
      clipboardEnabled: config.clipboard.enabled,
      providerConfigured: hasConfiguredProvider(config.providers),
      completed: config.onboarding?.completed === true,
    };
  }

  async request(kind: OnboardingPermissionKind): Promise<OnboardingStatus> {
    const platform = this.platform();
    try {
      if (kind === 'microphone' && platform === 'darwin') {
        await this.preferences().askForMediaAccess('microphone');
      } else if (kind === 'accessibility' && platform === 'darwin') {
        this.preferences().isTrustedAccessibilityClient(true);
      } else if (kind === 'screen' && platform === 'darwin') {
        await (this.deps.captureScreen ?? (() => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })))();
      } else {
        await this.openSettings(kind);
      }
    } catch {
      return this.status();
    }
    return this.status();
  }

  async openSettings(kind: OnboardingPermissionKind): Promise<boolean> {
    const platform = this.platform();
    const url =
      platform === 'darwin'
        ? kind === 'microphone'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
          : kind === 'screen'
            ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
            : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        : platform === 'win32'
          ? kind === 'microphone'
            ? 'ms-settings:privacy-microphone'
            : 'ms-settings:privacy'
          : null;
    if (!url) {
      return false;
    }
    await (this.deps.openExternal ?? ((target) => shell.openExternal(target)))(url);
    return true;
  }

  async complete(): Promise<void> {
    await this.deps.updateConfig({
      onboarding: { completed: true, completedAt: new Date().toISOString() },
    });
    this.deps.onChanged?.();
  }

  async reset(): Promise<void> {
    await this.deps.updateConfig({ onboarding: { completed: false, completedAt: null } });
    this.deps.onChanged?.();
  }
}
