import type {
  MiniAppExportFormat,
  MiniAppRunDiffEntry,
  MiniAppRunItemView,
  MiniAppRunReportView,
  MiniAppRunView,
} from '@shared/app-pack';

/** Run exports (plan 26 S4): markdown / JSON / CSV over the report view. */

function verdictLabel(verdict: string): string {
  return verdict;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

export function exportRunMarkdown(report: MiniAppRunReportView): string {
  const { run, packTitle, items } = report;
  const lines: string[] = [
    `# ${packTitle} — run report`,
    '',
    `- Root: \`${run.rootPath}\``,
    `- Status: ${run.status}`,
    `- Started: ${formatTimestamp(run.startedAt)}`,
    ...(run.finishedAt ? [`- Finished: ${formatTimestamp(run.finishedAt)}`] : []),
    `- Pack version: ${run.packVersion}`,
    `- Model calls: ${run.actualCalls}${run.estimateCalls > 0 ? ` (estimate ${run.estimateCalls})` : ''}`,
    ...(run.inputTokens || run.outputTokens ? [`- Tokens: ${run.inputTokens} in / ${run.outputTokens} out`] : []),
  ];
  if (run.error) {
    lines.push(`- Error: ${run.error}`);
  }
  if (run.totals) {
    const t = run.totals;
    lines.push(
      '',
      '## Totals',
      '',
      `| | |`,
      `|---|---|`,
      `| Scanned | ${t.scanned} |`,
      `| Keep | ${t.keep} |`,
      `| Ask | ${t.ask} |`,
      `| Candidate | ${t.candidate} |`,
      `| Rule-decided | ${t.ruleDecided} |`,
      `| Model-decided | ${t.modelDecided} |`,
      `| Cache hits | ${t.cacheHits} |`,
      `| Pending | ${t.pending} |`
    );
  }
  lines.push('', '## Items', '', '| Path | Verdict | Confidence | Decided by |', '|---|---|---|---|');
  for (const item of items) {
    lines.push(`| ${escapeCell(item.relPath)} | ${verdictLabel(item.verdict)} | ${item.confidence !== null ? item.confidence.toFixed(2) : '—'} | ${item.decidedBy} |`);
  }
  lines.push('', '## Evidence', '');
  for (const item of items) {
    lines.push(`### ${item.relPath}`, '', '```json', JSON.stringify(item.evidence ?? {}, null, 2), '```', '');
  }
  return lines.join('\n');
}

export function exportRunJson(report: MiniAppRunReportView): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function csvCell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportRunCsv(report: MiniAppRunReportView): string {
  const rows = [['path', 'verdict', 'confidence', 'decidedBy'].join(',')];
  for (const item of report.items) {
    rows.push(
      [csvCell(item.relPath), item.verdict, item.confidence !== null ? item.confidence.toFixed(3) : '', item.decidedBy].join(',')
    );
  }
  return `${rows.join('\n')}\n`;
}

export function exportRunReport(report: MiniAppRunReportView, format: MiniAppExportFormat): string {
  if (format === 'json') {
    return exportRunJson(report);
  }
  if (format === 'csv') {
    return exportRunCsv(report);
  }
  return exportRunMarkdown(report);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

export interface DiffableRun {
  runId: string;
  finishedAt: number | null;
  updatedAt: number;
  items: { relPath: string; fingerprint: string; verdict: string }[];
}

/**
 * "Changed since last run" (plan 26 S4): compares the latest run of a
 * pack+root against the most recent earlier completed run — new files,
 * removed files, changed fingerprints, verdict flips.
 */
export function diffRuns(latest: DiffableRun, baseline: DiffableRun | null): { baselineRunId: string | null; entries: MiniAppRunDiffEntry[] } {
  if (!baseline) {
    return { baselineRunId: null, entries: [] };
  }
  const before = new Map(baseline.items.map((item) => [item.relPath, item]));
  const after = new Map(latest.items.map((item) => [item.relPath, item]));
  const entries: MiniAppRunDiffEntry[] = [];
  for (const item of latest.items) {
    const prior = before.get(item.relPath);
    if (!prior) {
      entries.push({ relPath: item.relPath, kind: 'new', after: item.verdict });
    } else if (prior.fingerprint !== item.fingerprint && prior.verdict !== item.verdict) {
      entries.push({ relPath: item.relPath, kind: 'verdict-change', before: prior.verdict, after: item.verdict });
    } else if (prior.fingerprint !== item.fingerprint) {
      entries.push({ relPath: item.relPath, kind: 'changed', after: item.verdict });
    } else if (prior.verdict !== item.verdict) {
      entries.push({ relPath: item.relPath, kind: 'verdict-change', before: prior.verdict, after: item.verdict });
    }
  }
  for (const item of baseline.items) {
    if (!after.has(item.relPath)) {
      entries.push({ relPath: item.relPath, kind: 'removed', before: item.verdict });
    }
  }
  return { baselineRunId: baseline.runId, entries };
}
