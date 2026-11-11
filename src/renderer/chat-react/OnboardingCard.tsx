import { useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { LLMProvider } from '@shared/types';
import type { OnboardingPermissionStatus, OnboardingStatus } from '@shared/onboarding';
import { TEXT, interpolate } from '@shared/constants/text';

const STATUS_LABEL: Record<OnboardingPermissionStatus, string> = {
  granted: TEXT.ONBOARDING_PERMISSION_GRANTED,
  denied: TEXT.ONBOARDING_PERMISSION_DENIED,
  restricted: TEXT.ONBOARDING_PERMISSION_RESTRICTED,
  unknown: TEXT.ONBOARDING_PERMISSION_UNKNOWN,
  'not-applicable': TEXT.ONBOARDING_PERMISSION_NA,
};

export function OnboardingCard({ providers }: { providers?: LLMProvider[] }): JSX.Element | null {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    window.electronAPI?.getOnboardingStatus?.().then(setStatus).catch(() => undefined);
  }, []);

  if (!status || status.completed) {
    return null;
  }
  const relevant = status.permissions.filter((permission) => permission.status !== 'not-applicable');
  const finish = (): void => {
    void window.electronAPI.completeOnboarding();
    setStatus({ ...status, completed: true });
  };

  return (
    <div className="mx-auto mt-3 max-w-md space-y-2 rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-3 text-left text-xs">
      <p className="text-sm font-semibold">{TEXT.ONBOARDING_WELCOME_TITLE}</p>
      <p className="opacity-70">{interpolate(TEXT.ONBOARDING_WELCOME_HINT, { hotkey: status.hotkey || 'Control+Space' })}</p>
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.ONBOARDING_PERMISSIONS_TITLE}</p>
        {relevant.length === 0 ? (
          <p className="opacity-60">{TEXT.ONBOARDING_NO_PERMISSIONS}</p>
        ) : (
          <ul className="space-y-0.5">
            {relevant.map((permission) => (
              <li key={permission.kind} className="flex items-center justify-between gap-2">
                <span className="opacity-70">
                  {permission.kind === 'microphone'
                    ? TEXT.ONBOARDING_PERMISSION_MICROPHONE
                    : permission.kind === 'screen'
                      ? TEXT.ONBOARDING_PERMISSION_SCREEN
                      : TEXT.ONBOARDING_PERMISSION_ACCESSIBILITY}
                </span>
                <span className={permission.status === 'granted' ? 'text-[var(--as-success)]' : 'opacity-60'}>
                  {STATUS_LABEL[permission.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {status.clipboardEnabled && <p className="opacity-60">{TEXT.ONBOARDING_CLIPBOARD_ON}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={finish}>
          {TEXT.ONBOARDING_GOT_IT}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void window.electronAPI.onSettingsOpen({ tab: 'general' });
            finish();
          }}
        >
          {TEXT.ONBOARDING_REVIEW}
        </Button>
        {!status.providerConfigured && providers && (
          <Button variant="outline" size="sm" onClick={() => void window.electronAPI.onSettingsOpen({ tab: 'api' })}>
            {TEXT.SETUP_EMPTY_STATE_CTA}
          </Button>
        )}
      </div>
    </div>
  );
}
