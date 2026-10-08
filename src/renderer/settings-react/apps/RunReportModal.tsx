import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { FolderOpen, FileText } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunItemView, MiniAppRunReportView } from '@shared/app-pack';
import { runStatusLabel } from './runStatus';

type ReportNode = Record<string, unknown> & { id: string; type: string };

const VERDICTS = ['keep', 'ask', 'candidate'] as const;

function confidenceLabel(item: MiniAppRunItemView): string {
  return item.confidence !== null ? item.confidence.toFixed(2) : '—';
}

function verdictBadge(verdict: string): ReactElement {
  return <Badge variant={verdict === 'candidate' ? 'secondary' : 'outline'} className="text-[10px]">{verdict}</Badge>;
}

function evidenceSummary(item: MiniAppRunItemView, labels: Record<string, string>): string | null {
  const evidence = item.evidence;
  if (!evidence) {
    return null;
  }
  const rule = typeof evidence.rule === 'string' ? labels[`rule.${evidence.rule}`] ?? evidence.rule : null;
  const answers = evidence.answers && typeof evidence.answers === 'object' ? Object.keys(evidence.answers as Record<string, unknown>) : null;
  const parts: string[] = [];
  if (rule) {
    parts.push(rule);
  }
  if (answers?.length) {
    parts.push(answers.join(', '));
  }
  if (typeof evidence.userOverride === 'boolean' && evidence.userOverride) {
    parts.push('user');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function EvidenceDisclosure({ item, labels }: { item: MiniAppRunItemView; labels: Record<string, string> }): ReactElement | null {
  if (!item.evidence) {
    return null;
  }
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] text-[var(--as-muted-foreground)]">
        {TEXT.MINIAPPS_REPORT_EVIDENCE}
        {evidenceSummary(item, labels) ? ` — ${evidenceSummary(item, labels)}` : ''}
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-[var(--as-muted)] p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(item.evidence, null, 2)}</pre>
    </details>
  );
}

function ReviewQueue({
  report,
  onOverride,
}: {
  report: MiniAppRunReportView;
  onOverride: (relPath: string, action: 'keep' | 'candidate' | 'exclude') => Promise<void>;
}): ReactElement | null {
  const [done, setDone] = useState<Set<string>>(new Set());
  const askItems = useMemo(() => report.items.filter((item) => item.verdict === 'ask' && !done.has(item.relPath)), [report, done]);
  if (askItems.length === 0) {
    return null;
  }
  return (
    <section aria-label={interpolate(TEXT.MINIAPPS_REVIEW_TITLE, { count: String(askItems.length) })} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <h4 className="text-sm font-medium">{interpolate(TEXT.MINIAPPS_REVIEW_TITLE, { count: String(askItems.length) })}</h4>
      <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_REVIEW_HINT}</p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {askItems.map((item) => (
          <li key={item.relPath} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="truncate">{item.relPath}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDone((current) => new Set(current).add(item.relPath));
                  void onOverride(item.relPath, 'keep');
                }}
              >
                {TEXT.MINIAPPS_REVIEW_KEEP}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDone((current) => new Set(current).add(item.relPath));
                  void onOverride(item.relPath, 'candidate');
                }}
              >
                {TEXT.MINIAPPS_REVIEW_CANDIDATE}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDone((current) => new Set(current).add(item.relPath));
                  void onOverride(item.relPath, 'exclude');
                }}
              >
                {TEXT.MINIAPPS_REVIEW_EXCLUDE}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The declarative report renderer (plan 26 S5): host-rendered closed
 * component vocabulary driven by the pack's report schema — never raw
 * pack markup. Evidence drilldown is mandatory wherever recommendations
 * render (validator-enforced); the ask-review queue captures overrides
 * that persist for later runs of the same folder.
 */
export function PackReportRenderer({
  report,
  onOverride,
  onReveal,
  onOpen,
}: {
  report: MiniAppRunReportView;
  onOverride: (relPath: string, action: 'keep' | 'candidate' | 'exclude') => Promise<void>;
  onReveal: (relPath: string) => Promise<void>;
  onOpen: (relPath: string) => Promise<void>;
}): ReactElement {
  const [verdictFilter, setVerdictFilter] = useState<string>('all');
  const [needle, setNeedle] = useState('');
  const nodes = useMemo(
    () => (Array.isArray(report.reportNodes) ? (report.reportNodes as ReportNode[]) : []),
    [report.reportNodes]
  );
  const hasTable = nodes.some((node) => node.type === 'table' || node.type === 'cards');
  const items = useMemo(
    () =>
      report.items.filter(
        (item) =>
          (verdictFilter === 'all' || item.verdict === verdictFilter) &&
          (needle.trim().length === 0 || item.relPath.toLowerCase().includes(needle.trim().toLowerCase()))
      ),
    [report.items, verdictFilter, needle]
  );
  const label = (node: ReportNode): string => report.labels[`report.${node.id}`] ?? node.id;
  const totals = report.run.totals;

  return (
    <div className="space-y-4">
      {nodes
        .filter((node) => node.type === 'badge' || node.type === 'stat' || node.type === 'progress')
        .map((node) => {
          if (node.type === 'badge') {
            return (
              <div key={node.id} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--as-muted-foreground)]">{label(node)}</span>
                {verdictBadge(runStatusLabel(report.run.status))}
              </div>
            );
          }
          if (node.type === 'progress' && totals) {
            const decided = totals.keep + totals.ask + totals.candidate;
            return (
              <div key={node.id} className="space-y-1">
                <span className="text-xs text-[var(--as-muted-foreground)]">{label(node)}</span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--as-muted)]">
                  <div className="h-full rounded-full bg-[var(--as-primary)]" style={{ width: `${Math.round((decided / Math.max(1, totals.scanned)) * 100)}%` }} />
                </div>
              </div>
            );
          }
          const bind = typeof node.bind === 'string' ? node.bind : 'totals.scanned';
          const value = bind.startsWith('totals.') && totals ? (totals as unknown as Record<string, number>)[bind.slice(7)] : undefined;
          return (
            <div key={node.id} className="rounded-xl border border-[var(--as-border)] px-3 py-2">
              <div className="text-lg font-medium">{value !== undefined ? value : '—'}</div>
              <div className="text-[11px] text-[var(--as-muted-foreground)]">{label(node)}</div>
            </div>
          );
        })}

      {totals && (
        <p className="text-xs text-[var(--as-muted-foreground)]">
          {interpolate(TEXT.MINIAPPS_REPORT_TOTALS, {
            scanned: String(totals.scanned),
            keep: String(totals.keep),
            ask: String(totals.ask),
            candidate: String(totals.candidate),
          })}
        </p>
      )}

      <ReviewQueue report={report} onOverride={onOverride} />

      {nodes.some((node) => node.type === 'filter-bar') && (
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...VERDICTS] as const).map((verdict) => (
            <button
              key={verdict}
              type="button"
              aria-pressed={verdictFilter === verdict}
              onClick={() => setVerdictFilter(verdict)}
              className={`rounded-full border px-3 py-1 text-xs ${verdictFilter === verdict ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'}`}
            >
              {verdict === 'all' ? TEXT.MINIAPPS_REPORT_FILTER_ALL : verdict}
            </button>
          ))}
          <SearchInput value={needle} onChange={setNeedle} placeholder={TEXT.MINIAPPS_REPORT_SEARCH} ariaLabel={TEXT.MINIAPPS_REPORT_SEARCH_LABEL} clearLabel={TEXT.MINIAPPS_REPORT_SEARCH} />
        </div>
      )}

      {nodes
        .filter((node) => node.type === 'table')
        .map((node) => {
          const columns = Array.isArray(node.columns) ? (node.columns as string[]) : ['path', 'verdict'];
          const header = (column: string): string =>
            column === 'path' ? TEXT.MINIAPPS_REPORT_COL_PATH : column === 'verdict' ? TEXT.MINIAPPS_REPORT_COL_VERDICT : column === 'confidence' ? TEXT.MINIAPPS_REPORT_COL_CONFIDENCE : column === 'decidedBy' ? TEXT.MINIAPPS_REPORT_COL_DECIDED_BY : column;
          return (
            <table key={node.id} className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--as-border)] text-left text-[var(--as-muted-foreground)]">
                  {columns.map((column) => (
                    <th key={column} scope="col" className="py-1.5 pr-3 font-medium">
                      {header(column)}
                    </th>
                  ))}
                  <th scope="col" className="py-1.5 font-medium">{TEXT.MINIAPPS_ITEM_REVEAL}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.relPath} className="border-b border-[var(--as-border)]/50 align-top">
                    {columns.map((column) => (
                      <td key={column} className="py-1.5 pr-3">
                        {column === 'path' ? (
                          <div className="max-w-md">
                            <span className="block truncate" title={item.relPath}>{item.relPath}</span>
                            {hasTable && <EvidenceDisclosure item={item} labels={report.labels} />}
                          </div>
                        ) : column === 'verdict' ? (
                          verdictBadge(item.verdict)
                        ) : column === 'confidence' ? (
                          confidenceLabel(item)
                        ) : column === 'decidedBy' ? (
                          item.decidedBy
                        ) : (
                          String((item as unknown as Record<string, unknown>)[column] ?? '')
                        )}
                      </td>
                    ))}
                    <td className="py-1.5">
                      <span className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => void onReveal(item.relPath)} aria-label={TEXT.MINIAPPS_ITEM_REVEAL}>
                          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void onOpen(item.relPath)} aria-label={TEXT.MINIAPPS_ITEM_OPEN}>
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}

      {nodes
        .filter((node) => node.type === 'cards')
        .map((node) => (
          <ul key={node.id} className="space-y-1.5">
            {items.map((item) => (
              <li key={item.relPath} className="rounded-md border border-[var(--as-border)] px-2.5 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate">{item.relPath}</span>
                  {verdictBadge(item.verdict)}
                  <span className="text-[var(--as-muted-foreground)]">{confidenceLabel(item)}</span>
                </div>
                <EvidenceDisclosure item={item} labels={report.labels} />
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

export function RunReportModal({ runId, onClose }: { runId: string; onClose: () => void }): ReactElement {
  const [report, setReport] = useState<MiniAppRunReportView | null>(null);

  const load = useCallback(async () => {
    setReport(await window.electronAPI.miniAppRunReport(runId));
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onOverride = useCallback(
    async (relPath: string, action: 'keep' | 'candidate' | 'exclude') => {
      if (action === 'exclude') {
        await window.electronAPI.excludeMiniAppItem(runId, relPath);
      } else {
        await window.electronAPI.overrideMiniAppItem(runId, relPath, action);
      }
      await load();
    },
    [runId, load]
  );

  const onReveal = useCallback(async (relPath: string) => {
    await window.electronAPI.revealMiniAppItem(runId, relPath);
  }, [runId]);

  const onOpen = useCallback(async (relPath: string) => {
    await window.electronAPI.openMiniAppItem(runId, relPath);
  }, [runId]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>{report ? `${report.packTitle} — ${TEXT.MINIAPPS_REPORT_OPEN.replace('View ', '')}` : TEXT.MINIAPPS_REPORT_OPEN}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {report ? (
            <PackReportRenderer report={report} onOverride={onOverride} onReveal={onReveal} onOpen={onOpen} />
          ) : (
            <p className="text-sm text-[var(--as-muted-foreground)]">…</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {TEXT.CLOSE_BUTTON}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
