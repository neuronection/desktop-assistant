import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Input } from '@neuronection/assistant-ui/input';
import { interpolate, TEXT } from '@shared/constants/text';
import {
  PACK_HOST_SENSITIVE_BASELINE,
  type MiniAppRuleBindingView,
  type MiniAppRuleImpactList,
  type MiniAppRuleImpactView,
  type MiniAppView,
  type PackRuleListId,
} from '@shared/app-pack';
import { classifyItemWithTrace, globToRegex, matchesGlob, type PolicyTrace } from '@shared/app-pack/policy';

const RULE_LIST_PURPOSE: Record<string, string> = {
  veto: TEXT.MINIAPPS_RULES_PURPOSE_VETO,
  keep: TEXT.MINIAPPS_RULES_PURPOSE_KEEP,
  ask: TEXT.MINIAPPS_RULES_PURPOSE_ASK,
  candidate: TEXT.MINIAPPS_RULES_PURPOSE_CANDIDATE,
};

const RULE_SNIPPETS: readonly string[] = [
  'node_modules/**',
  '**/__pycache__/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '*.log',
  '*.tmp',
  '*.bak',
  '.DS_Store',
  'Thumbs.db',
];

const AGE_SNIPPETS: readonly string[] = ['*.log:30', 'drafts/**:90'];

const LIST_TITLES: Record<PackRuleListId, string> = {
  veto: TEXT.MINIAPPS_RULES_LIST_VETO,
  keep: TEXT.MINIAPPS_RULES_LIST_KEEP,
  ask: TEXT.MINIAPPS_RULES_LIST_ASK,
  candidate: TEXT.MINIAPPS_RULES_LIST_CANDIDATE,
};

const IMPACT_DIRECTION_TEXT: Record<MiniAppRuleImpactList['direction'], string> = {
  'to-keep': TEXT.MINIAPPS_RULES_IMPACT_TO_KEEP,
  'to-ask': TEXT.MINIAPPS_RULES_IMPACT_TO_ASK,
  'to-candidate-queue': TEXT.MINIAPPS_RULES_IMPACT_TO_QUEUE,
};

const SENSITIVE_MATCHERS = PACK_HOST_SENSITIVE_BASELINE.map((glob) => ({
  glob,
  regex: globToRegex(glob),
  hasSlash: glob.includes('/'),
}));

function isHostSensitive(relativePath: string): boolean {
  return SENSITIVE_MATCHERS.some((entry) => matchesGlob(relativePath, entry.regex, entry.hasSlash));
}

function listOfValues(values: Record<string, unknown>, key: string): string[] {
  const raw = values[key];
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

function globWarning(entry: string): string | null {
  if (entry.trim() === '**') {
    return TEXT.MINIAPPS_RULES_WARN_GLOB;
  }
  return null;
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return index > slash + 1 ? path.slice(index + 1).toLowerCase() : '';
}

function ruleLabelOf(view: MiniAppView, ruleId: string): string {
  const binding = view.ruleBindings?.find((entry) => entry.ruleId === ruleId);
  return binding?.label ?? ruleId;
}

function RuleChipList({
  binding,
  entries,
  onChange,
}: {
  binding: MiniAppRuleBindingView;
  entries: string[];
  onChange: (next: string[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const warning = globWarning(trimmed);
  const move = (index: number, delta: -1 | 1): void => {
    const next = [...entries];
    const target = index + delta;
    if (target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = (): void => {
    if (trimmed.length === 0 || entries.includes(trimmed)) {
      return;
    }
    onChange([...entries, trimmed]);
    setDraft('');
  };
  return (
    <fieldset className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <legend className="px-1 text-sm font-medium">{binding.label}</legend>
      <p className="-mt-0.5 text-[11px] text-[var(--as-muted-fg)]">{RULE_LIST_PURPOSE[binding.list]}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RULES_EMPTY}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {entries.map((entry, index) => (
            <li
              key={entry}
              className="flex items-center gap-1 rounded-full border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-0.5 text-xs"
            >
              <span className="font-mono">{entry}</span>
              <button
                type="button"
                aria-label={interpolate(TEXT.MINIAPPS_RULES_MOVE_UP_ARIA, { pattern: entry })}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className="px-0.5 text-[var(--as-muted-foreground)] disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={interpolate(TEXT.MINIAPPS_RULES_MOVE_DOWN_ARIA, { pattern: entry })}
                disabled={index === entries.length - 1}
                onClick={() => move(index, 1)}
                className="px-0.5 text-[var(--as-muted-foreground)] disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={interpolate(TEXT.MINIAPPS_RULES_REMOVE_ARIA, { pattern: entry })}
                onClick={() => onChange(entries.filter((_, candidate) => candidate !== index))}
                className="px-0.5 text-[var(--as-muted-foreground)] hover:text-[var(--as-foreground)]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="*.log:30"
          aria-label={interpolate(TEXT.MINIAPPS_RULES_ADD_ARIA, { list: binding.label })}
          className="w-56"
        />
        <Button size="sm" variant="outline" disabled={trimmed.length === 0} onClick={add}>
          {TEXT.MINIAPPS_RULES_ADD}
        </Button>
      </div>
      {warning && <p className="text-xs text-[var(--as-warning)]">{warning}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RULES_SNIPPETS}</span>
        {[...RULE_SNIPPETS, ...AGE_SNIPPETS].map((snippet) => (
          <button
            key={snippet}
            type="button"
            aria-label={interpolate(TEXT.MINIAPPS_RULES_SNIPPET_ARIA, { pattern: snippet })}
            disabled={entries.includes(snippet)}
            onClick={() => onChange([...entries, snippet])}
            className="rounded-full border border-dashed border-[var(--as-border)] px-2 py-0.5 font-mono text-[11px] text-[var(--as-muted-foreground)] hover:text-[var(--as-foreground)] disabled:opacity-30"
          >
            + {snippet}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Simulator({ view, values }: { view: MiniAppView; values: Record<string, unknown> }): ReactElement {
  const [path, setPath] = useState('');
  const [size, setSize] = useState('2048');
  const [age, setAge] = useState('120');

  const trace = useMemo<PolicyTrace | null>(() => {
    const trimmed = path.trim();
    if (trimmed.length === 0 || !view.classifyRules) {
      return null;
    }
    return classifyItemWithTrace(view.classifyRules, {
      meta: {
        path: trimmed,
        name: basenameOf(trimmed),
        ext: extensionOf(trimmed),
        size: Math.max(0, Number.parseInt(size, 10) || 0),
        ageDays: Math.max(0, Number.parseFloat(age) || 0),
      },
      config: values,
      matchedRules: new Set<string>(),
      answers: {},
    });
  }, [path, size, age, values, view]);

  const hostSensitive = path.trim().length > 0 ? isHostSensitive(path.trim()) : false;

  return (
    <section aria-label={TEXT.MINIAPPS_RULES_SIMULATOR_TITLE} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <h4 className="text-sm font-medium">{TEXT.MINIAPPS_RULES_SIMULATOR_TITLE}</h4>
      <div className="flex flex-wrap gap-2">
        <Input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="src/assets/logo.png"
          aria-label={TEXT.MINIAPPS_RULES_SIMULATOR_PATH}
          className="w-72"
        />
        <Input
          value={size}
          onChange={(event) => setSize(event.target.value)}
          inputMode="numeric"
          aria-label={TEXT.MINIAPPS_RULES_SIMULATOR_SIZE}
          className="w-32"
        />
        <Input
          value={age}
          onChange={(event) => setAge(event.target.value)}
          inputMode="decimal"
          aria-label={TEXT.MINIAPPS_RULES_SIMULATOR_AGE}
          className="w-32"
        />
      </div>
      {hostSensitive && (
        <p className="text-xs" data-testid="rules-simulator-host">
          {TEXT.MINIAPPS_RULES_SIMULATOR_HOST}
        </p>
      )}
      {trace && !hostSensitive && (
        <p className="text-xs" data-testid="rules-simulator-verdict">
          {trace.outcome.kind === 'final' ? (
            interpolate(TEXT.MINIAPPS_RULES_SIMULATOR_VERDICT, {
              verdict: `${trace.outcome.verdict} — ${ruleLabelOf(view, trace.outcome.rule)}`,
            })
          ) : trace.outcome.candidateRule !== null ? (
            interpolate(TEXT.MINIAPPS_RULES_SIMULATOR_VERDICT, {
              verdict: `candidate — ${ruleLabelOf(view, trace.outcome.candidateRule)}`,
            })
          ) : (
            TEXT.MINIAPPS_RULES_SIMULATOR_RESIDUAL
          )}
        </p>
      )}
      {trace && (
        <ul className="space-y-1 text-xs">
          {trace.steps.map((step) => (
            <li key={`${step.list}-${step.ruleId}`} className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{LIST_TITLES[step.list]}</Badge>
              <span className="font-mono">{ruleLabelOf(view, step.ruleId)}</span>
              <span className="text-[var(--as-muted-foreground)]">
                {step.matched
                  ? TEXT.MINIAPPS_RULES_SIMULATOR_STEP_MATCH
                  : step.reason === 'age-gate'
                    ? TEXT.MINIAPPS_RULES_SIMULATOR_STEP_AGE
                    : TEXT.MINIAPPS_RULES_SIMULATOR_STEP_NO}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RULES_SIMULATOR_BASENAME}</p>
    </section>
  );
}

function ImpactPreview({
  packId,
  values,
  bindings,
}: {
  packId: string;
  values: Record<string, unknown>;
  bindings: MiniAppRuleBindingView[];
}): ReactElement | null {
  const keyFor = (list: PackRuleListId): string | null => bindings.find((binding) => binding.list === list)?.configKey ?? null;
  const keepKey = keyFor('keep');
  const reviewKey = keyFor('ask');
  const junkKey = keyFor('candidate');
  const draftKey = JSON.stringify([
    keepKey ? listOfValues(values, keepKey) : [],
    reviewKey ? listOfValues(values, reviewKey) : [],
    junkKey ? listOfValues(values, junkKey) : [],
  ]);
  const draft = useMemo(
    () => JSON.parse(draftKey) as { keep: string[]; review: string[]; junk: string[] },
    [draftKey]
  );
  const [data, setData] = useState<MiniAppRuleImpactView | null>(null);
  const latestRef = useRef(0);

  useEffect(() => {
    const ticket = latestRef.current + 1;
    latestRef.current = ticket;
    const timer = setTimeout(() => {
      window.electronAPI
        .ruleImpactPreview(packId, draft)
        .then((result) => {
          if (latestRef.current === ticket) {
            setData(result);
          }
        })
        .catch(() => {
          if (latestRef.current === ticket) {
            setData(null);
          }
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [packId, draft]);

  if (!data) {
    return null;
  }
  return (
    <section aria-label={TEXT.MINIAPPS_RULES_IMPACT_TITLE} className="space-y-1.5 rounded-xl border border-[var(--as-border)] p-3">
      <h4 className="text-sm font-medium">{TEXT.MINIAPPS_RULES_IMPACT_TITLE}</h4>
      {data.lists.map((list) =>
        list.count === 0 ? null : (
          <div key={list.configKey} className="text-xs">
            <p>{interpolate(IMPACT_DIRECTION_TEXT[list.direction], { count: String(list.count) })}</p>
            {list.samples.length > 0 && (
              <p className="font-mono text-[11px] text-[var(--as-muted-foreground)]">
                {interpolate(TEXT.MINIAPPS_RULES_IMPACT_SAMPLES, { samples: list.samples.join(', ') })}
              </p>
            )}
          </div>
        )
      )}
      {data.unverifiable > 0 && (
        <p className="text-xs text-[var(--as-muted-foreground)]">
          {interpolate(TEXT.MINIAPPS_RULES_IMPACT_UNVERIFIABLE, { count: String(data.unverifiable) })}
        </p>
      )}
      <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RULES_IMPACT_LAST_RUN}</p>
    </section>
  );
}

/** The AI rule-drafting seam (plan 51 S6.2): proposals only — a draft glob becomes a real pattern only when the user adds it, through the normal save path. */
function RuleDrafting({ view, onAdd }: { view: MiniAppView; onAdd: (list: 'keep' | 'ask' | 'candidate', glob: string) => void }): ReactElement | null {
  if (view.configValues?.ruleDrafting !== true) {
    return null;
  }
  return (
    <RuleDraftingInner
      view={view}
      onAdd={onAdd}
    />
  );
}

function RuleDraftingInner({ view, onAdd }: { view: MiniAppView; onAdd: (list: 'keep' | 'ask' | 'candidate', glob: string) => void }): ReactElement {
  const [intent, setIntent] = useState('');
  const [list, setList] = useState<'keep' | 'ask' | 'candidate'>('keep');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.draftMiniAppRules(view.id, intent);
      if (result.ok) {
        setDrafts(result.globs.filter((glob) => glob.trim().length > 0));
      } else {
        setError(interpolate(TEXT.MINIAPPS_RULES_DRAFT_FAILED, { error: result.error }));
      }
    } catch (draftError) {
      setError(interpolate(TEXT.MINIAPPS_RULES_DRAFT_FAILED, { error: draftError instanceof Error ? draftError.message : String(draftError) }));
    } finally {
      setBusy(false);
    }
  }, [view.id, intent]);

  const listLabels: Record<'keep' | 'ask' | 'candidate', string> = {
    keep: TEXT.MINIAPPS_RULES_DRAFT_LIST_KEEP,
    ask: TEXT.MINIAPPS_RULES_DRAFT_LIST_REVIEW,
    candidate: TEXT.MINIAPPS_RULES_DRAFT_LIST_JUNK,
  };

  return (
    <section aria-label={TEXT.MINIAPPS_RULES_DRAFT_TITLE} className="space-y-2 rounded-xl border border-dashed border-[var(--as-border)] p-3" data-testid="rules-drafting">
      <h4 className="text-sm font-medium">{TEXT.MINIAPPS_RULES_DRAFT_TITLE}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          aria-label={TEXT.MINIAPPS_RULES_DRAFT_INPUT_ARIA}
          placeholder={TEXT.MINIAPPS_RULES_DRAFT_INPUT_ARIA}
          className="w-72"
        />
        <select
          aria-label={TEXT.MINIAPPS_RULES_DRAFT_LIST_ARIA}
          data-testid="rules-draft-list"
          className="rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1 text-xs"
          value={list}
          onChange={(event) => setList(event.target.value as 'keep' | 'ask' | 'candidate')}
        >
          <option value="keep">{listLabels.keep}</option>
          <option value="ask">{listLabels.ask}</option>
          <option value="candidate">{listLabels.candidate}</option>
        </select>
        <Button size="sm" variant="outline" disabled={busy || intent.trim().length === 0} onClick={() => void draft()} data-testid="rules-draft-go">
          {TEXT.MINIAPPS_RULES_DRAFT_BUTTON}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {error}
        </p>
      )}
      {drafts.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_AI_LABEL}</p>
          <ul className="flex flex-wrap gap-1.5">
            {drafts.map((glob) => (
              <li key={glob}>
                <button
                  type="button"
                  aria-label={interpolate(TEXT.MINIAPPS_RULES_DRAFT_ADD_ARIA, { pattern: glob })}
                  data-testid={`rules-draft-add-${glob}`}
                  onClick={() => {
                    onAdd(list, glob);
                    setDrafts((current) => current.filter((entry) => entry !== glob));
                  }}
                  className="rounded-full border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-0.5 font-mono text-[11px] hover:text-[var(--as-foreground)]"
                >
                  + {glob}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The host-generic rules editor (plan 51 S2.3): driven entirely by the
 * registry's ruleBindings + classifyRules introspection — no pack ids.
 * Edits ride the page's config draft and persist through the standard
 * `miniapps:save-config` path.
 */
export function ConfigRulesEditor({
  view,
  values,
  onValuesChange,
  onSave,
}: {
  view: MiniAppView;
  values: Record<string, unknown>;
  onValuesChange: (values: Record<string, unknown>) => void;
  onSave: () => Promise<void>;
}): ReactElement | null {
  const bindings = view.ruleBindings ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = useCallback(
    (configKey: string, next: string[]) => {
      onValuesChange({ ...values, [configKey]: next });
    },
    [onValuesChange, values]
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave();
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  if (bindings.length === 0) {
    return null;
  }

  return (
    <section aria-label={TEXT.MINIAPPS_RULES_EDITOR_TITLE} className="space-y-3" data-testid={`rules-editor-${view.id}`}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{TEXT.MINIAPPS_RULES_EDITOR_TITLE}</h3>
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RULES_EDITOR_PRECEDENCE}</p>
      </div>
      {bindings.map((binding) => (
        <RuleChipList
          key={binding.ruleId}
          binding={binding}
          entries={listOfValues(values, binding.configKey)}
          onChange={(next) => update(binding.configKey, next)}
        />
      ))}
      <RuleDrafting
        view={view}
        onAdd={(list, glob) => {
          const binding = bindings.find((entry) => (list === 'keep' ? entry.list === 'keep' : list === 'ask' ? entry.list === 'ask' : entry.list === 'candidate'));
          if (binding) {
            update(binding.configKey, [...listOfValues(values, binding.configKey).filter((entry) => entry !== glob), glob]);
          }
        }}
      />
      <Simulator view={view} values={values} />
      <ImpactPreview packId={view.id} values={values} bindings={bindings} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {TEXT.MINIAPPS_CONFIG_SAVE}
        </Button>
        {saved && (
          <span className="text-xs text-[var(--as-success)]" role="status">
            {TEXT.MINIAPPS_CONFIG_SAVED}
          </span>
        )}
        {error && <span className="text-xs text-[var(--as-danger)]">{error}</span>}
      </div>
    </section>
  );
}
