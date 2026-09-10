import type { JSX } from 'react';
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
