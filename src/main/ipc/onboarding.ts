import type { OnboardingService } from '@main/services/OnboardingService';
import type { OnboardingPermissionKind } from '@shared/onboarding';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface OnboardingIpcDeps {
  onboardingService: OnboardingService;
}

export function registerOnboardingIpc({ onboardingService }: OnboardingIpcDeps): void {
  register(IPC['onboarding:status'], async () => onboardingService.status());
  register(IPC['onboarding:request'], async (_event, kind: OnboardingPermissionKind) => onboardingService.request(kind));
  register(IPC['onboarding:open-settings'], async (_event, kind: OnboardingPermissionKind) => onboardingService.openSettings(kind));
  register(IPC['onboarding:complete'], async () => {
    await onboardingService.complete();
    return true;
  });
  register(IPC['onboarding:reset'], async () => {
    await onboardingService.reset();
    return true;
  });
}
