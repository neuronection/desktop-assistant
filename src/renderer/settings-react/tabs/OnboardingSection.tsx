import { useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { AppConfig } from '@shared/config/AppConfig';
import type { OnboardingPermission, OnboardingStatus } from '@shared/onboarding';
import { TEXT } from '@shared/constants/text';

const LABEL: Record<string, string> = {
  microphone: TEXT.ONBOARDING_PERMISSION_MICROPHONE,
  screen: TEXT.ONBOARDING_PERMISSION_SCREEN,
  accessibility: TEXT.ONBOARDING_PERMISSION_ACCESSIBILITY,
};

const STATUS: Record<string, string> = {
  granted: TEXT.ONBOARDING_PERMISSION_GRANTED,
  denied: TEXT.ONBOARDING_PERMISSION_DENIED,
  restricted: TEXT.ONBOARDING_PERMISSION_RESTRICTED,
  unknown: TEXT.ONBOARDING_PERMISSION_UNKNOWN,
  'not-applicable': TEXT.ONBOARDING_PERMISSION_NA,
};

function replaceText(platform: string): string {
  return platform === 'darwin'
    ? TEXT.ONBOARDING_REPLACE_MAC
    : platform === 'win32'
      ? TEXT.ONBOARDING_REPLACE_WIN
      : TEXT.ONBOARDING_REPLACE_LINUX;
}

function PermissionRow({ permission, onRequest, onOpen }: {
  permission: OnboardingPermission;
  onRequest: () => void;
  onOpen: () => void;
}): JSX.Element {
  const applicable = permission.status !== 'not-applicable';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--as-border)] px-2 py-1.5 text-xs">
      <span className="opacity-70">{LABEL[permission.kind]}</span>
      <span className="flex items-center gap-2">
        <span className={permission.status === 'granted' ? 'text-[var(--as-success)]' : 'opacity-60'}>
          {STATUS[permission.status]}
        </span>
        {applicable && permission.status !== 'granted' && (
          <>
            {permission.status === 'unknown' && (
              <Button variant="outline" size="sm" onClick={onRequest}>
                {TEXT.ONBOARDING_REQUEST}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onOpen}>
              {TEXT.ONBOARDING_OPEN_SETTINGS}
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

export interface OnboardingSectionProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
}

export function OnboardingSection({ onChange }: OnboardingSectionProps): JSX.Element {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    const refresh = (): void => {
      window.electronAPI?.getOnboardingStatus?.()?.then(setStatus).catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const refresh = async (kind: OnboardingPermission['kind'], request: boolean): Promise<void> => {
    const next = request
      ? await window.electronAPI.requestOnboardingPermission(kind)
      : (await window.electronAPI.openOnboardingPermissionSettings(kind), await window.electronAPI.getOnboardingStatus());
    setStatus(next);
  };

  return (
    <section className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{TEXT.ONBOARDING_PERMISSIONS_TITLE}</h3>
          {status && <p className="text-xs opacity-60">{replaceText(status.platform)}</p>}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void window.electronAPI.resetOnboarding().then(() =>
              onChange({ onboarding: { completed: false, completedAt: null } })
            );
          }}
        >
          {TEXT.ONBOARDING_SHOW_AGAIN}
        </Button>
      </div>
      {status?.platform === 'darwin' && status.permissions.some((permission) => permission.kind === 'screen' && permission.status === 'denied') && (
        <p className="text-[11px] opacity-60">{TEXT.ONBOARDING_SCREEN_RESTART}</p>
      )}
      {status && (
        <ul className="space-y-1">
          {status.permissions.map((permission) => (
            <PermissionRow
              key={permission.kind}
              permission={permission}
              onRequest={() => void refresh(permission.kind, true)}
              onOpen={() => void refresh(permission.kind, false)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
