import type { JSX } from 'react';
import { Calculator } from 'lucide-react';
import type { CommandEntry } from '@shared/commands';
import { TEXT } from '@shared/constants/text';

/**
 * Mini-app modes (plan 14 §9): commands that turn the launcher input
 * into a focused surface — live result, accent border, explicit exit.
 * The registry is renderer-only; execution still flows through
 * `commands:execute` so history and policy stay single-pathed.
 */
export interface MiniApp {
  id: 'calc:evaluate';
  title: string;
  icon: typeof Calculator;
  accent: string;
  placeholder: string;
  hint: string;
}

export const MINI_APPS: MiniApp[] = [
  {
    id: 'calc:evaluate',
    title: TEXT.COMMAND_MINI_CALC_TITLE,
    icon: Calculator,
    accent: 'var(--as-primary)',
    placeholder: TEXT.COMMAND_MINI_CALC_PLACEHOLDER,
    hint: TEXT.COMMAND_MINI_HINT,
  },
];

export function miniAppForId(id: string): MiniApp | null {
  return MINI_APPS.find((app) => app.id === id) ?? null;
}

export function miniAppForEntry(entry: CommandEntry): MiniApp | null {
  return entry.action && entry.action === 'calc:evaluate' ? miniAppForId(entry.id) : null;
}

export function MiniAppIcon({ app }: { app: MiniApp }): JSX.Element {
  const Icon = app.icon;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}
