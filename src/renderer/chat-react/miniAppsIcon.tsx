import type { JSX } from 'react';
import type { MiniApp } from './miniApps';

export function MiniAppIcon({ app }: { app: MiniApp }): JSX.Element {
  const Icon = app.icon;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}
