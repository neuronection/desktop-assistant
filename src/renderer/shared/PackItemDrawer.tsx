import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ExternalLink, FolderOpen, RotateCcw } from 'lucide-react';
import { interpolate, TEXT } from '@shared/constants/text';
import type { MiniAppRunItemView, PackOverrideAction } from '@shared/app-pack';

const OVERRIDE_LABELS = {
  keep: TEXT.MINIAPPS_REVIEW_KEEP,
  candidate: TEXT.MINIAPPS_REVIEW_CANDIDATE,
  exclude: TEXT.MINIAPPS_REVIEW_EXCLUDE,
} as const;

export function humanBytes(size: number): string {
  if (size < 1024) {
    return `${size} ${TEXT.MINIAPPS_UNIT_BYTES}`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} ${TEXT.MINIAPPS_UNIT_KB}`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} ${TEXT.MINIAPPS_UNIT_MB}`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} ${TEXT.MINIAPPS_UNIT_GB}`;
}

export function humanAge(days: number): string {
  if (days < 365) {
    return interpolate(TEXT.MINIAPPS_AGE_DAYS, { days: String(Math.round(days)) });
  }
  return interpolate(TEXT.MINIAPPS_AGE_YEARS, { years: (days / 365).toFixed(1) });
}

interface EvidenceAnswerRow {
  id: string;
  label: string;
  value: string;
  confidence: number | null;
}

function answerRows(answers: Record<string, unknown>, labels: Record<string, string>): EvidenceAnswerRow[] {
  return Object.entries(answers)
    .filter((entry): entry is [string, Record<string, unknown>] => entry[1] !== null && typeof entry[1] === 'object')
    .map(([id, answer]) => {
      const label = labels[`question.${id}`] ?? id;
      const confidence = typeof answer.confidence === 'number' ? answer.confidence : null;
      if (answer.type === 'choice' && typeof answer.choice === 'string') {
        return { id, label, value: labels[`status.${answer.choice}`] ?? answer.choice, confidence };
      }
      if (answer.type === 'score' && typeof answer.score === 'number') {
        return { id, label, value: labels[`level.${id}.${answer.score}`] ?? String(answer.score), confidence };
      }
      if (answer.type === 'noul' && typeof answer.noul === 'number') {
        return { id, label, value: answer.noul >= 0.5 ? TEXT.MINIAPPS_EVIDENCE_YES : TEXT.MINIAPPS_EVIDENCE_NO, confidence };
      }
      return { id, label, value: JSON.stringify(answer), confidence };
    });
}

function ConfidenceBar({ value }: { value: number }): ReactElement {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-[var(--as-muted)]">
        <span className="block h-full rounded-full bg-[var(--as-primary)]" style={{ width: `${percent}%` }} />
      </span>
      <span className="tabular-nums">{value.toFixed(2)}</span>
    </span>
  );
}

const DECIDED_HUMAN: Record<string, string> = {
  rule: TEXT.MINIAPPS_DECIDED_RULES,
  engine: TEXT.MINIAPPS_DECIDED_MODEL,
  cache: TEXT.MINIAPPS_DECIDED_CACHE,
  override: TEXT.MINIAPPS_DECIDED_OVERRIDE,
  fallback: TEXT.MINIAPPS_DECIDED_FALLBACK,
  arm: TEXT.MINIAPPS_DECIDED_ARM,
};

function FactRow({ id, label, children }: { id: string; label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs" data-testid={`drawer-fact-${id}`}>
      <span className="shrink-0 text-[11px] text-[var(--as-muted-foreground)]">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/**
 * The item detail drawer (plan 51 S3.8): anchored inside the report
 * pane, chrome per the popup law — title + close live in a fixed header,
 * the meta + structured evidence card scroll in the body, the decision
 * actions are pinned in a footer below the scroll area. The structured
 * card replaces the raw-JSON block (which stays the fallback for
 * unknown evidence shapes); the one-line row summary is the disclosure's
 * collapsed form, this drawer is its expanded form.
 */
export function PackItemDrawer({
  item,
  labels,
  variant,
  onClose,
  onOverride,
  onReveal,
  onOpen,
  onRestore,
}: {
  item: MiniAppRunItemView;
  labels: Record<string, string>;
  variant: 'side' | 'sheet';
  onClose: () => void;
  onOverride: (relPath: string, action: PackOverrideAction) => Promise<void>;
  onReveal: (relPath: string) => Promise<void>;
  onOpen: (relPath: string) => Promise<void>;
  onRestore: (relPath: string) => Promise<void>;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef(item);

  useLayoutEffect(() => {
    itemRef.current = item;
    const closeButton = panelRef.current?.querySelector<HTMLButtonElement>('[data-testid="drawer-close"]');
    closeButton?.focus();
  }, [item]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((element) => !element.hasAttribute('disabled'));
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const evidence = item.evidence ?? {};
  const meta = (evidence.meta as { size?: unknown; ageDays?: unknown; ext?: unknown } | undefined) ?? undefined;
  const ruleId = typeof evidence.rule === 'string' ? evidence.rule : null;
  const ruleLabel = ruleId !== null ? (labels[`rule.${ruleId}`] ?? ruleId) : null;
  const answers = evidence.answers && typeof evidence.answers === 'object' ? (evidence.answers as Record<string, unknown>) : null;
  const usage = evidence.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
  const category = answers && typeof evidence.answers === 'object'
    ? answerCategory(answers, labels)
    : null;
  const knownShape = ruleId !== null || answers !== null || evidence.userOverride === true || evidence.list === 'host-sensitive';
  const directorySegment = item.relPath.includes('/') ? item.relPath.slice(0, item.relPath.lastIndexOf('/')) : null;
  const baseName = item.relPath.slice(item.relPath.lastIndexOf('/') + 1);
  const decidedKind = item.decidedBy.split(':')[0] ?? item.decidedBy;
  const decidedHuman = labels[`status.${decidedKind}`] ?? DECIDED_HUMAN[decidedKind] ?? decidedKind;

  const positionClass = variant === 'sheet' ? 'inset-x-0 bottom-0 max-h-[75%]' : 'inset-y-0 right-0 w-full max-w-md';
  const panelClasses = `absolute z-20 flex flex-col rounded-[var(--as-radius-lg)] border border-[var(--as-border)] bg-[var(--as-surface-raised)] text-[var(--as-fg)] shadow-[var(--as-shadow-3)] ${positionClass}`;

  return (
    <div ref={panelRef} role="dialog" aria-modal="false" aria-label={interpolate(TEXT.MINIAPPS_ITEM_DETAILS_ARIA, { path: item.relPath })} className={panelClasses} data-testid="item-drawer">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--as-border)] px-3 py-2">
        <h4 className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={item.relPath}>
          {item.relPath}
        </h4>
        <Button size="sm" variant="ghost" data-testid="drawer-close" aria-label={TEXT.CLOSE_BUTTON} onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="space-y-1.5" data-testid="drawer-facts">
          <FactRow id="folder" label={TEXT.MINIAPPS_DRAWER_FOLDER}>
            <span className="block truncate font-mono text-[11px]" title={item.relPath}>
              {directorySegment && <span className="font-medium">{directorySegment}/</span>}
              <span className="text-[var(--as-muted-foreground)]">{baseName}</span>
            </span>
          </FactRow>
          {meta && typeof meta.size === 'number' && (
            <FactRow id="size" label={TEXT.MINIAPPS_REPORT_COL_SIZE}>
              <span className="tabular-nums">{humanBytes(meta.size)}</span>
            </FactRow>
          )}
          {meta && typeof meta.ageDays === 'number' && (
            <FactRow id="age" label={TEXT.MINIAPPS_REPORT_COL_AGE}>
              <span className="tabular-nums">{humanAge(meta.ageDays)}</span>
            </FactRow>
          )}
          {category && (
            <FactRow id="category" label={TEXT.MINIAPPS_REPORT_COL_CATEGORY}>
              {category}
            </FactRow>
          )}
          {item.confidence !== null && (
            <FactRow id="confidence" label={TEXT.MINIAPPS_REPORT_COL_CONFIDENCE}>
              <ConfidenceBar value={item.confidence} />
            </FactRow>
          )}
          <FactRow id="decidedBy" label={TEXT.MINIAPPS_REPORT_COL_DECIDED_BY}>
            <Badge variant="outline" className="text-[10px]" title={item.decidedBy}>
              {decidedHuman}
            </Badge>
          </FactRow>
        </div>
        {ruleLabel !== null && (
          <div className="space-y-1">
            <div className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_DRAWER_EVIDENCE_RULE}</div>
            <Badge variant="outline">{ruleLabel}</Badge>
          </div>
        )}
        {answers !== null && (
          <div className="space-y-1.5">
            <div className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_DRAWER_ANSWERS}</div>
            <ul className="space-y-1.5">
              {answerRows(answers, labels).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`drawer-answer-${row.id}`}>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span>{row.value}</span>
                  {row.confidence !== null && <ConfidenceBar value={row.confidence} />}
                </li>
              ))}
            </ul>
          </div>
        )}
        {usage && typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number' && (
          <p className="text-[11px] text-[var(--as-muted-foreground)]">
            {interpolate(TEXT.MINIAPPS_RUN_TOKENS, { in: String(usage.inputTokens), out: String(usage.outputTokens) })}
          </p>
        )}
        {!knownShape && Object.keys(evidence).length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_DRAWER_UNKNOWN}</div>
            <pre className="max-h-48 overflow-y-auto rounded-md bg-[var(--as-muted)] p-2 text-[11px] whitespace-pre-wrap">
              {JSON.stringify(evidence, null, 2)}
            </pre>
          </div>
        )}
        {Object.keys(evidence).length === 0 && <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_DRAWER_EMPTY}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--as-border)] px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => void onOverride(item.relPath, 'ask')} data-testid="drawer-ask-again" title={TEXT.MINIAPPS_ASK_AGAIN_HINT}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_REVIEW_ASK_AGAIN}
        </Button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--as-border)]" />
        <Button size="sm" variant="outline" onClick={() => void onReveal(item.relPath)} data-testid="drawer-reveal">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_ITEM_REVEAL}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onOpen(item.relPath)} data-testid="drawer-open">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_ITEM_OPEN}
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => void onOverride(item.relPath, 'keep')}>
            {OVERRIDE_LABELS.keep}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onOverride(item.relPath, 'candidate')}>
            {OVERRIDE_LABELS.candidate}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onOverride(item.relPath, 'exclude')}>
            {OVERRIDE_LABELS.exclude}
          </Button>
          {item.decidedBy === 'quarantined' && (
            <Button size="sm" variant="ghost" onClick={() => void onRestore(item.relPath)}>
              {TEXT.MINIAPPS_RESTORE_ITEM}
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

function answerCategory(answers: Record<string, unknown>, labels: Record<string, string>): string | null {
  const category = answers.category;
  if (category === null || typeof category !== 'object') {
    return null;
  }
  const choice = (category as Record<string, unknown>).choice;
  return typeof choice === 'string' ? (labels[`status.${choice}`] ?? choice) : null;
}
