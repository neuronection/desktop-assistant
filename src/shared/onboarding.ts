export type OnboardingPermissionKind = 'microphone' | 'screen' | 'accessibility';
export type OnboardingPermissionStatus = 'granted' | 'denied' | 'restricted' | 'unknown' | 'not-applicable';

export interface OnboardingPermission {
  kind: OnboardingPermissionKind;
  status: OnboardingPermissionStatus;
}

export interface OnboardingStatus {
  platform: NodeJS.Platform;
  hotkey: string;
  permissions: OnboardingPermission[];
  clipboardEnabled: boolean;
  providerConfigured: boolean;
  completed: boolean;
}

export interface OnboardingSettings {
  completed: boolean;
  completedAt: string | null;
}
