import type { JSX } from 'react';

export interface ModeIconProps {
  className?: string;
}

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Compact launcher surface: the floating input pill. */
export function LauncherModeIcon({ className }: ModeIconProps): JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="9" width="16" height="7" rx="3.5" />
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
    </svg>
  );
}

/** Expanded surface: the full conversation window. */
export function ExpandedModeIcon({ className }: ModeIconProps): JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="8.5" x2="21" y2="8.5" />
      <line x1="7" y1="12.5" x2="17" y2="12.5" />
      <line x1="7" y1="16" x2="13" y2="16" />
    </svg>
  );
}

/** Desktop surface: the taskbar-visible monitor window. */
export function DesktopModeIcon({ className }: ModeIconProps): JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <line x1="12" y1="16" x2="12" y2="19" />
      <line x1="8" y1="20" x2="16" y2="20" />
    </svg>
  );
}
