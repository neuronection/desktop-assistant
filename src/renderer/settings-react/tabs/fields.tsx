import type { JSX } from 'react';
import { Combobox, type ComboboxOption } from '@neuronection/assistant-ui/combobox';
export function Label({ htmlFor, children }: { htmlFor: string; children: string }): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium opacity-80">
      {children}
    </label>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs opacity-50">{hint}</p>}
    </div>
  );
}

export interface SelectFieldProps {
  id: string;
  label: string;
  /** Accessible name when it must differ from the visible label. */
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  hint?: string;
  disabled?: boolean;
}

export function SelectField({ id, label, ariaLabel, value, onChange, options, hint, disabled }: SelectFieldProps): JSX.Element {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Combobox
        id={id}
        hideLabel
        label={ariaLabel ?? label}
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      {hint && <p className="text-xs opacity-60">{hint}</p>}
    </div>
  );
}
