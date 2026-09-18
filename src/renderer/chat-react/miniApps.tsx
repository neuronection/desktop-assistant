import type { JSX } from 'react';
import { Calculator, Languages } from 'lucide-react';
import type { CommandEntry } from '@shared/commands';
import { TEXT } from '@shared/constants/text';

/**
 * Mini-app modes (plan 14 §9): commands that turn the launcher input
 * into a focused surface — live result, accent border, explicit exit.
 * The registry is renderer-only; execution still flows through
 * `commands:execute` (calc) or the direct service bridge (translate
 * pad, plan 19 S6) so history and policy stay single-pathed.
 */
export interface MiniApp {
  id: string;
  title: string;
  icon: typeof Calculator;
  accent: string;
  placeholder: string;
  hint: string;
  /** Translate pad (plan 19 S6): target code captured at open time; null defers to `translation.defaultTarget` per call. */
  targetCode?: string | null;
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

const TRANSLATE_BASE: Omit<MiniApp, 'targetCode' | 'title'> = {
  id: 'tool:translate',
  icon: Languages,
  accent: 'var(--as-primary)',
  placeholder: TEXT.COMMAND_MINI_TRANSLATE_PLACEHOLDER,
  hint: TEXT.COMMAND_MINI_TRANSLATE_HINT,
};

export function miniAppForId(id: string): MiniApp | null {
  return MINI_APPS.find((app) => app.id === id) ?? null;
}

export interface MiniAppOpenOptions {
  targetCode?: string | null;
}

export function miniAppForEntry(entry: CommandEntry, options: MiniAppOpenOptions = {}): MiniApp | null {
  if (entry.action && entry.action === 'calc:evaluate') {
    return miniAppForId(entry.id);
  }
  if (entry.toolName === 'translate') {
    const targetCode = options.targetCode?.trim().toLowerCase() || null;
    return {
      ...TRANSLATE_BASE,
      targetCode,
      title: targetCode ? `${TEXT.COMMAND_MINI_TRANSLATE_TITLE} → ${targetCode}` : TEXT.COMMAND_MINI_TRANSLATE_TITLE,
    };
  }
  return null;
}

export function MiniAppIcon({ app }: { app: MiniApp }): JSX.Element {
  const Icon = app.icon;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}
