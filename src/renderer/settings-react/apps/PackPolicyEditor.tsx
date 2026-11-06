import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { Input } from '@neuronection/assistant-ui/input';
import { TEXT } from '@shared/constants/text';

const SECTIONS = [
  { key: 'keep', header: 'ALWAYS KEEP' },
  { key: 'review', header: 'ALWAYS REVIEW' },
  { key: 'never', header: 'NEVER DELETE' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

interface PolicyDraft {
  keep: string[];
  review: string[];
  never: string[];
  hintSafe: string;
  hintRecoverability: string;
}

const EMPTY_DRAFT: PolicyDraft = { keep: [], review: [], never: [], hintSafe: '', hintRecoverability: '' };

function compose(draft: PolicyDraft): string {
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const items = draft[section.key];
    if (items.length === 0) {
      continue;
    }
    lines.push(`${section.header}:`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }
  const hints = [
    draft.hintSafe.trim().length > 0 ? `safe: ${draft.hintSafe.trim()}` : '',
    draft.hintRecoverability.trim().length > 0 ? `recoverability: ${draft.hintRecoverability.trim()}` : '',
  ].filter(Boolean);
  if (hints.length > 0) {
    lines.push(`SCORING HINTS — ${hints.join('; ')}`);
  }
  return lines.join('\n');
}

function parse(guidelines: string): PolicyDraft {
  const draft: PolicyDraft = { ...EMPTY_DRAFT, keep: [], review: [], never: [] };
  let section: SectionKey | 'hints' | null = null;
  for (const rawLine of guidelines.split('\n')) {
    const line = rawLine.trim();
    const matchSection = SECTIONS.find((entry) => entry.header === line.replace(/:$/, ''));
    if (matchSection) {
      section = matchSection.key;
      continue;
    }
    if (line.startsWith('SCORING HINTS')) {
      section = 'hints';
      const rest = line.replace(/^SCORING HINTS\s*—?\s*/, '');
      for (const part of rest.split(';')) {
        const [name, ...value] = part.split(':');
        const text = value.join(':').trim();
        if (name.trim() === 'safe') {
          draft.hintSafe = text;
        }
        if (name.trim() === 'recoverability') {
          draft.hintRecoverability = text;
        }
      }
      continue;
    }
    const item = line.startsWith('- ') ? line.slice(2).trim() : section !== null && line.length > 0 ? line : '';
    if (item.length === 0 || section === null || section === 'hints') {
      continue;
    }
    draft[section].push(item);
  }
  return draft;
}

/**
 * The structured policy builder (plan 51 S5.1): composes the single
 * `guidelines` config string from grouped do/don't lines and
 * per-question scoring hints in a deterministic labeled format the
 * runner relies on. Contract-clean — one string key, structured input.
 */
export function PackPolicyEditor({
  guidelines,
  onChange,
}: {
  guidelines: string;
  onChange: (next: string) => void;
}): ReactElement {
  const draft = useMemo(() => parse(guidelines), [guidelines]);

  const setSection = useCallback(
    (key: SectionKey, text: string) => {
      const next: PolicyDraft = { ...draft, [key]: text.split('\n').map((line) => line.trim()).filter(Boolean) };
      onChange(compose(next));
    },
    [draft, onChange]
  );

  const setHint = useCallback(
    (key: 'hintSafe' | 'hintRecoverability', text: string) => {
      onChange(compose({ ...draft, [key]: text }));
    },
    [draft, onChange]
  );

  const composed = compose(draft);

  return (
    <fieldset className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <legend className="px-1 text-sm font-medium">{TEXT.MINIAPPS_POLICY_TITLE}</legend>
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_POLICY_HINT}</p>
      <div className="grid gap-2 md:grid-cols-3">
        {SECTIONS.map((section) => (
          <label key={section.key} className="flex flex-col gap-1 text-xs">
            <span>{section.header}</span>
            <textarea
              value={draft[section.key].join('\n')}
              onChange={(event) => setSection(section.key, event.target.value)}
              rows={3}
              aria-label={section.header}
              data-testid={`policy-${section.key}`}
              placeholder={TEXT.MINIAPPS_POLICY_LINES_HINT}
              className="rounded-md border border-[var(--as-border)] bg-[var(--as-background)] p-2 text-xs"
            />
          </label>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Input
          value={draft.hintSafe}
          onChange={(event) => setHint('hintSafe', event.target.value)}
          aria-label={`${TEXT.MINIAPPS_POLICY_SCORING}: safe`}
          data-testid="policy-hint-safe"
          placeholder={TEXT.MINIAPPS_POLICY_SAFE}
        />
        <Input
          value={draft.hintRecoverability}
          onChange={(event) => setHint('hintRecoverability', event.target.value)}
          aria-label={`${TEXT.MINIAPPS_POLICY_SCORING}: recoverability`}
          data-testid="policy-hint-recoverability"
          placeholder={TEXT.MINIAPPS_POLICY_RECOVERABILITY}
        />
      </div>
      {composed.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_POLICY_PREVIEW}</div>
          <pre className="max-h-40 overflow-y-auto rounded-md bg-[var(--as-muted)] p-2 text-[11px] whitespace-pre-wrap" data-testid="policy-preview">
            {composed}
          </pre>
        </div>
      )}
    </fieldset>
  );
}
