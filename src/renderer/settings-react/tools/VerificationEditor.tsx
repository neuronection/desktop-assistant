import { type JSX } from 'react';
import { Plus, X } from 'lucide-react';
import type { ToolParameterInfo, ToolRiskClass, ToolVerificationCondition, ToolVerificationMode, ToolVerificationSettings } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

const OPERATORS: { value: ToolVerificationCondition['operator']; label: string }[] = [
  { value: 'present', label: 'is provided' },
  { value: 'absent', label: 'is not provided' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: 'is greater than' },
  { value: 'lt', label: 'is less than' },
  { value: 'matches', label: 'matches regex' },
];

const VALUE_OPERATORS = new Set<ToolVerificationCondition['operator']>(['equals', 'not_equals', 'contains', 'gt', 'lt', 'matches']);

export interface VerificationEditorProps {
  risk: ToolRiskClass;
  value: ToolVerificationSettings;
  onChange: (next: ToolVerificationSettings) => void;
  parameters: ToolParameterInfo[];
  /** Unique per tool — radio group name + accessible group label. */
  toolName: string;
}

interface ModeOption {
  mode: ToolVerificationMode;
  label: string;
  hint: string;
  lockedForDestructive: boolean;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: 'standard', label: TEXT.TOOLS_VERIFICATION_STANDARD, hint: TEXT.TOOLS_VERIFICATION_STANDARD_HINT, lockedForDestructive: false },
  { mode: 'always_ask', label: TEXT.TOOLS_VERIFICATION_ALWAYS_ASK, hint: TEXT.TOOLS_VERIFICATION_ALWAYS_ASK_HINT, lockedForDestructive: false },
  { mode: 'conditions', label: TEXT.TOOLS_VERIFICATION_CONDITIONS, hint: TEXT.TOOLS_VERIFICATION_CONDITIONS_HINT, lockedForDestructive: true },
  { mode: 'never', label: TEXT.TOOLS_VERIFICATION_NEVER, hint: TEXT.TOOLS_VERIFICATION_NEVER_HINT, lockedForDestructive: true },
];

export function VerificationEditor({ risk, value, onChange, parameters, toolName }: VerificationEditorProps): JSX.Element {
  const destructive = risk === 'destructive';
  const setMode = (mode: ToolVerificationMode): void => {
    if (mode === 'conditions') {
      onChange({ mode, conditions: value.conditions?.length ? value.conditions : [{ param: parameters[0]?.name ?? '', operator: 'present' }] });
      return;
    }
    onChange({ mode });
  };
  const updateCondition = (index: number, patch: Partial<ToolVerificationCondition>): void => {
    onChange({ mode: 'conditions', conditions: (value.conditions ?? []).map((condition, i) => (i === index ? { ...condition, ...patch } : condition)) });
  };
  const removeCondition = (index: number): void => {
    const next = (value.conditions ?? []).filter((_, i) => i !== index);
    onChange({ mode: 'conditions', conditions: next });
  };
  const addCondition = (): void => {
    onChange({ mode: 'conditions', conditions: [...(value.conditions ?? []), { param: parameters[0]?.name ?? '', operator: 'present' }] });
  };

  return (
    <div className="space-y-2">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold">{TEXT.TOOLS_VERIFICATION_TITLE}</legend>
        <p className="text-xs opacity-60">{TEXT.TOOLS_VERIFICATION_HINT}</p>
        <div role="radiogroup" aria-label={interpolate(TEXT.TOOLS_VERIFICATION_MODE_GROUP_ARIA, { name: toolName })} className="space-y-1.5">
          {MODE_OPTIONS.map((option) => {
            const disabled = destructive && option.lockedForDestructive;
            const checked = value.mode === option.mode;
            return (
              <label
                key={option.mode}
                className={`flex items-start gap-2 rounded-lg border p-2 text-sm transition-colors ${
                  checked ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/5' : 'border-[var(--as-border)]'
                } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={`${toolName}-verification-mode`}
                  value={option.mode}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => setMode(option.mode)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-xs opacity-60">{disabled ? TEXT.TOOLS_VERIFICATION_DESTRUCTIVE_LOCKED : option.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {value.mode === 'conditions' && (
        <div className="space-y-1.5 rounded-lg border border-[var(--as-border)] bg-[var(--as-muted)]/40 p-2.5">
          <p className="text-xs font-medium">{TEXT.TOOLS_CONDITION_MATCH_ANY}</p>
          {(value.conditions ?? []).map((condition, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <select
                aria-label={interpolate(TEXT.TOOLS_CONDITION_PARAM_ARIA, { index: index + 1 })}
                className="w-36 min-w-0 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-1.5 py-1 text-xs"
                value={condition.param}
                onChange={(e) => updateCondition(index, { param: e.target.value })}
              >
                {parameters.length === 0 && <option value="">{condition.param || '—'}</option>}
                {parameters.map((parameter) => (
                  <option key={parameter.name} value={parameter.name}>
                    {parameter.name}
                  </option>
                ))}
                {condition.param && !parameters.some((parameter) => parameter.name === condition.param) && (
                  <option value={condition.param}>{condition.param}</option>
                )}
              </select>
              <select
                aria-label={interpolate(TEXT.TOOLS_CONDITION_OPERATOR_ARIA, { index: index + 1 })}
                className="w-32 min-w-0 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-1.5 py-1 text-xs"
                value={condition.operator}
                onChange={(e) => updateCondition(index, { operator: e.target.value as ToolVerificationCondition['operator'] })}
              >
                {OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>
                    {operator.label}
                  </option>
                ))}
              </select>
              {VALUE_OPERATORS.has(condition.operator) && (
                <input
                  type="text"
                  aria-label={interpolate(TEXT.TOOLS_CONDITION_VALUE_ARIA, { index: index + 1 })}
                  className="min-w-0 flex-1 rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-1.5 py-1 font-mono text-xs"
                  value={condition.value ?? ''}
                  onChange={(e) => updateCondition(index, { value: e.target.value })}
                />
              )}
              <button
                type="button"
                aria-label={interpolate(TEXT.TOOLS_CONDITION_REMOVE_ARIA, { index: index + 1 })}
                className="shrink-0 rounded p-1 opacity-60 hover:opacity-100"
                onClick={() => removeCondition(index)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-dashed border-[var(--as-border)] px-2 py-1 text-xs opacity-70 hover:opacity-100"
            onClick={addCondition}
          >
            <Plus className="h-3 w-3" aria-hidden />
            {TEXT.TOOLS_CONDITION_ADD}
          </button>
        </div>
      )}
    </div>
  );
}
