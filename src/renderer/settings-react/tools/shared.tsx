import type { JSX } from 'react';
import { Brain, Cpu, FolderOpen, Globe, Monitor, Plus, Power, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import type { LucideIcon } from 'lucide-react';
import type { ToolCategory, ToolRiskClass, ToolVerificationSettings } from '@shared/turns';
import { TEXT } from '@shared/constants/text';

export const RISK_BADGE_CLASS: Record<ToolRiskClass, string> = {
  'read-only': 'bg-emerald-500/15 text-emerald-500',
  'state-changing': 'bg-amber-500/15 text-amber-500',
  destructive: 'bg-red-500/15 text-red-500',
};

export const RISK_LABEL: Record<ToolRiskClass, string> = {
  'read-only': TEXT.TOOLS_FILTER_READ_ONLY,
  'state-changing': TEXT.TOOLS_FILTER_STATE_CHANGING,
  destructive: TEXT.TOOLS_FILTER_DESTRUCTIVE,
};

export const CATEGORY_META: Record<ToolCategory, { icon: LucideIcon; label: string }> = {
  files: { icon: FolderOpen, label: TEXT.TOOLS_CAT_FILES },
  system: { icon: Cpu, label: TEXT.TOOLS_CAT_SYSTEM },
  desktop: { icon: Monitor, label: TEXT.TOOLS_CAT_DESKTOP },
  network: { icon: Globe, label: TEXT.TOOLS_CAT_NETWORK },
  power: { icon: Power, label: TEXT.TOOLS_CAT_POWER },
  memory: { icon: Brain, label: TEXT.TOOLS_CAT_MEMORY },
};

/** Short badge text for a non-standard verification mode; null = standard. */
export function verificationBadge(settings: ToolVerificationSettings): string | null {
  switch (settings.mode) {
    case 'always_ask':
      return TEXT.TOOLS_DEFAULTS_ALWAYS_ASK;
    case 'never':
      return TEXT.TOOLS_BADGE_AUTO_RUN;
    case 'conditions': {
      const count = settings.conditions?.length ?? 0;
      return `${count} ${count === 1 ? TEXT.TOOLS_WORD_RULE : TEXT.TOOLS_WORD_RULES}`;
    }
    default:
      return null;
  }
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Row layouts that already name the item render the control alone. */
  hideLabel?: boolean;
}

export function Switch({ checked, onCheckedChange, label, disabled, hideLabel }: SwitchProps): JSX.Element {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        checked
          ? 'border-[var(--as-primary)] bg-[var(--as-primary)]'
          : 'border-[var(--as-border)] bg-[var(--as-muted)]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
  if (hideLabel) {
    return control;
  }
  return (
    <span className="flex items-center gap-2 py-1">
      {control}
      <span className="text-xs">{label}</span>
    </span>
  );
}

export interface AliasListEditorProps {
  label: string;
  aliases: string[];
  onChange: (aliases: string[]) => void;
  addLabel: string;
  removeLabel: string;
}

/** Strips the display slash, trims, drops empties and duplicates. */
export function sanitizeAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((alias) => alias.trim().replace(/^\//, '')).filter(Boolean))];
}

export function AliasListEditor({ label, aliases, onChange, addLabel, removeLabel }: AliasListEditorProps): JSX.Element {
  return (
    <div>
      <p className="mb-1 font-medium">{label}</p>
      <div className="flex flex-col gap-1">
        {aliases.map((alias, index) => (
          <span key={index} className="flex items-center gap-1">
            <span className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--as-border)] bg-transparent">
              <span className="pl-2 text-sm opacity-50" aria-hidden="true">
                /
              </span>
              <input
                aria-label={`${label} ${index + 1}`}
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none"
                value={alias}
                onChange={(event) => onChange(aliases.map((candidate, i) => (i === index ? event.target.value.replace(/^\//, '') : candidate)))}
              />
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`${removeLabel} ${alias || index + 1}`}
              onClick={() => onChange(aliases.filter((_, i) => i !== index))}
            >
              <X className="h-3 w-3" aria-hidden />
            </Button>
          </span>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-1" onClick={() => onChange([...aliases, ''])}>
        <Plus className="mr-1 h-3 w-3" aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}
