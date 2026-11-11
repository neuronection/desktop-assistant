import { useCallback, useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import type { AppConfig } from '@shared/config/AppConfig';
import type { ModelPricing, UsageReport, UsageTotals } from '@shared/usage';
import { TEXT, interpolate } from '@shared/constants/text';

export interface DataCostTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
}

function formatTokens(value: number): string {
  return value.toLocaleString();
}

function formatCost(value: number | null, partial = false): string {
  if (value === null) {
    return TEXT.DATA_COST_COST_UNKNOWN;
  }
  const body =
    value > 0 && value < 0.0001
      ? TEXT.DATA_COST_COST_BELOW
      : interpolate(TEXT.DATA_COST_COST, { value: value.toFixed(4) });
  return partial ? interpolate(TEXT.DATA_COST_COST_AT_LEAST, { value: body }) : body;
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function TotalsCard({ label, totals }: { label: string; totals: UsageTotals }): JSX.Element {
  return (
    <div className="rounded-md border border-[var(--as-border)] px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-lg font-semibold">{formatCost(totals.costUsd, totals.unpricedCalls > 0)}</p>
      <p className="text-xs opacity-70">
        {interpolate(TEXT.DATA_COST_CALLS, { count: String(totals.calls) })} ·{' '}
        {interpolate(TEXT.DATA_COST_TOKEN_PAIR, {
          input: formatTokens(totals.inputTokens),
          output: formatTokens(totals.outputTokens),
        })}
      </p>
      {totals.partialTokenCalls > 0 && (
        <p className="text-[11px] opacity-60">
          {interpolate(TEXT.DATA_COST_PARTIAL_TOKENS, { count: String(totals.partialTokenCalls) })}
        </p>
      )}
      {totals.unpricedCalls > 0 && (
        <p className="text-[11px] opacity-60">{interpolate(TEXT.DATA_COST_UNPRICED, { count: String(totals.unpricedCalls) })}</p>
      )}
    </div>
  );
}

export function DataCostTab({ config, onChange }: DataCostTabProps): JSX.Element {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pricing = config.usage?.pricing ?? [];

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setReport(await window.electronAPI.getUsageReport());
    } catch (cause) {
      setError(interpolate(TEXT.DATA_COST_ERROR, { error: (cause as Error).message }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePricing = (next: ModelPricing[]): void => {
    onChange({ usage: { ...(config.usage ?? { pricing: [] }), pricing: next } });
  };

  const patch = (index: number, update: Partial<ModelPricing>): void => {
    savePricing(pricing.map((row, rowIndex) => (rowIndex === index ? { ...row, ...update } : row)));
  };

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-base font-semibold">{TEXT.DATA_COST_TITLE}</h3>
        <p className="text-sm opacity-60">{TEXT.DATA_COST_HINT}</p>
      </section>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--as-danger)' }}>
          {error}
        </p>
      )}

      {report && (
        <section className="grid gap-2 sm:grid-cols-2" aria-label={TEXT.DATA_COST_TITLE}>
          <TotalsCard label={TEXT.DATA_COST_TODAY} totals={report.today} />
          <TotalsCard label={TEXT.DATA_COST_MONTH} totals={report.month} />
        </section>
      )}

      {report && report.byModel.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">{TEXT.DATA_COST_BY_MODEL_TITLE}</h4>
          <div className="overflow-x-auto rounded-md border border-[var(--as-border)]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--as-border)] opacity-70">
                <tr>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_PROVIDER}</th>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_MODEL_COLUMN}</th>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_CALLS_COLUMN}</th>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_TOKENS_COLUMN}</th>
                  <th className="px-2 py-1 text-right font-medium">{TEXT.DATA_COST_COST_COLUMN}</th>
                </tr>
              </thead>
              <tbody>
                {report.byModel.map((row) => (
                  <tr key={`${row.providerId ?? ''}:${row.model}`} className="border-b border-[var(--as-border)] last:border-0">
                    <td className="px-2 py-1 opacity-70">{row.providerId ?? TEXT.DATA_COST_NONE}</td>
                    <td className="px-2 py-1 font-mono">{row.model}</td>
                    <td className="px-2 py-1">{row.calls}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {interpolate(TEXT.DATA_COST_TOKEN_PAIR, {
                        input: formatTokens(row.inputTokens),
                        output: formatTokens(row.outputTokens),
                      })}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {formatCost(row.costUsd, row.unpricedCalls > 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{TEXT.DATA_COST_PRICING_TITLE}</h4>
          <p className="text-[11px] opacity-60">{TEXT.DATA_COST_SAVE_NOTE}</p>
        </div>
        <p className="text-xs opacity-60">{TEXT.DATA_COST_PRICING_HINT}</p>
        <div className="space-y-2">
          {pricing.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
              <input
                className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                aria-label={`${TEXT.DATA_COST_MODEL} ${index + 1}`}
                placeholder={TEXT.DATA_COST_MODEL_PLACEHOLDER}
                value={row.model}
                onChange={(event) => patch(index, { model: event.target.value })}
              />
              <input
                className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                aria-label={`${TEXT.DATA_COST_INPUT_PRICE} ${index + 1}`}
                type="number"
                min={0}
                step="0.01"
                value={row.inputPerMillion}
                onChange={(event) => patch(index, { inputPerMillion: numeric(event.target.value) })}
              />
              <input
                className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                aria-label={`${TEXT.DATA_COST_OUTPUT_PRICE} ${index + 1}`}
                type="number"
                min={0}
                step="0.01"
                value={row.outputPerMillion}
                onChange={(event) => patch(index, { outputPerMillion: numeric(event.target.value) })}
              />
              <Button
                variant="outline"
                size="sm"
                aria-label={`${TEXT.DATA_COST_REMOVE} ${row.model || index + 1}`}
                onClick={() => savePricing(pricing.filter((_, rowIndex) => rowIndex !== index))}
              >
                {TEXT.DATA_COST_REMOVE}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pricing.length >= 200}
            onClick={() => savePricing([...pricing, { model: '', inputPerMillion: 0, outputPerMillion: 0 }])}
          >
            {TEXT.DATA_COST_ADD_PRICE}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            {TEXT.DATA_COST_REFRESH}
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{TEXT.DATA_COST_RECENT_TITLE}</h4>
        {report && report.recent.length === 0 && <p className="text-sm opacity-60">{TEXT.DATA_COST_RECENT_EMPTY}</p>}
        {report && report.recent.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-[var(--as-border)]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--as-border)] opacity-70">
                <tr>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_WHEN}</th>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_TASK}</th>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_MODEL_COLUMN}</th>
                  <th className="px-2 py-1 font-medium">{TEXT.DATA_COST_TOKENS_COLUMN}</th>
                  <th className="px-2 py-1 text-right font-medium">{TEXT.DATA_COST_COST_COLUMN}</th>
                </tr>
              </thead>
              <tbody>
                {report.recent.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--as-border)] last:border-0">
                    <td className="whitespace-nowrap px-2 py-1 opacity-70">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1">{row.task}</td>
                    <td className="px-2 py-1 font-mono">{row.resolvedModel ?? row.model}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {row.inputTokens === null || row.outputTokens === null
                        ? TEXT.DATA_COST_NONE
                        : interpolate(TEXT.DATA_COST_TOKEN_PAIR, {
                            input: formatTokens(row.inputTokens),
                            output: formatTokens(row.outputTokens),
                          })}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatCost(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
