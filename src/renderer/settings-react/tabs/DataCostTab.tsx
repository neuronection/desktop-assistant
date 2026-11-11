import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import type { AppConfig } from '@shared/config/AppConfig';
import type { ModelPricing, UsageBudget, UsageReport, UsageTotals } from '@shared/usage';
import type { EgressClass, EgressEntry, EgressMode } from '@shared/egress';
import { SelectField } from './fields';
import { isLocalApiBase } from '@shared/usage';
import { resolvePrice, type PriceResolution } from '@shared/modelPricing';
import { presetKeyForProvider } from '@shared/ai/providerPresets';
import { TEXT, interpolate } from '@shared/constants/text';

export interface DataCostTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
  /** Open Prices with a model highlighted (assignment cost deep link). */
  focusModel?: string | null;
  onFocusConsumed?: () => void;
}

type DataSection = 'overview' | 'prices' | 'calls' | 'network';

function formatTokens(value: number): string {
  return value.toLocaleString();
}

function formatCost(value: number | null, partial = false): string {
  if (value === null) {
    return TEXT.DATA_COST_COST_UNKNOWN;
  }
  const usd = value / 1_000_000;
  const body =
    usd > 0 && usd < 0.0001
      ? TEXT.DATA_COST_COST_BELOW
      : interpolate(TEXT.DATA_COST_COST, { value: usd.toFixed(4) });
  return partial ? interpolate(TEXT.DATA_COST_COST_AT_LEAST, { value: body }) : body;
}

function classLabel(value: EgressClass): string {
  return {
    loopback: TEXT.EGRESS_CLASS_LOOPBACK,
    'local-network': TEXT.EGRESS_CLASS_LOCAL,
    update: TEXT.EGRESS_CLASS_UPDATE,
    public: TEXT.EGRESS_CLASS_PUBLIC,
  }[value];
}

function microsToUsdInput(value: number | null): string {
  return value === null ? '' : String(value / 1_000_000);
}

function usdInputToMicros(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : null;
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function microsToUsd(value: number): number {
  return value / 1_000_000;
}

function usdToMicros(value: string): number {
  return Math.round(numeric(value) * 1_000_000);
}

function priceLabel(resolution: PriceResolution): string {
  const input = microsToUsd(resolution.inputMicrosPerMillion);
  const output = microsToUsd(resolution.outputMicrosPerMillion);
  return interpolate(TEXT.DATA_COST_RATE, {
    input: input.toFixed(4),
    output: output.toFixed(4),
  });
}

function TotalsCard({ label, totals }: { label: string; totals: UsageTotals }): JSX.Element {
  return (
    <div className="rounded-md border border-[var(--as-border)] px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-lg font-semibold">{formatCost(totals.costMicros, totals.unpricedCalls > 0)}</p>
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

export function DataCostTab({
  config,
  onChange,
  focusModel,
  onFocusConsumed,
}: DataCostTabProps): JSX.Element {
  const [section, setSection] = useState<DataSection>('overview');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [egress, setEgress] = useState<EgressEntry[] | null>(null);
  const pricing = config.usage?.pricing ?? [];
  const budget: UsageBudget = config.usage?.budget ?? { dailyMicros: null, monthlyMicros: null };
  const builtInRows = useMemo(() => {
    const rows: Array<{ key: string; provider: string; model: string; resolution: PriceResolution }> = [];
    for (const provider of config.providers ?? []) {
      const providerKey = presetKeyForProvider(provider);
      for (const model of provider.availableModels ?? []) {
        const resolution = resolvePrice({
          providerKey,
          model: model.id,
          isLocalEndpoint: isLocalApiBase(provider.apiBase),
          userRows: pricing,
        });
        if (resolution?.source === 'builtin') {
          rows.push({
            key: `${provider.id}:${model.id}`,
            provider: provider.name || providerKey || provider.type,
            model: model.id,
            resolution,
          });
        }
      }
    }
    return rows;
  }, [config.providers, pricing]);

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

  const loadEgress = useCallback(async (): Promise<void> => {
    try {
      setEgress(await window.electronAPI.getEgressLog());
    } catch {
      setEgress([]);
    }
  }, []);

  useEffect(() => {
    if (section === 'network') {
      void loadEgress();
    }
  }, [section, loadEgress]);

  useEffect(() => {
    if (focusModel) {
      setHighlight(focusModel);
      setSection('prices');
      onFocusConsumed?.();
    }
  }, [focusModel, onFocusConsumed]);

  const savePricing = (next: ModelPricing[]): void => {
    onChange({ usage: { ...(config.usage ?? { pricing: [] }), pricing: next } });
  };

  const patch = (index: number, update: Partial<ModelPricing>): void => {
    savePricing(pricing.map((row, rowIndex) => (rowIndex === index ? { ...row, ...update } : row)));
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.DATA_COST_TITLE}</h3>
          <p className="text-sm opacity-60">{TEXT.DATA_COST_HINT}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          {TEXT.DATA_COST_REFRESH}
        </Button>
      </section>

      <SegmentedTabs
        ariaLabel={TEXT.DATA_COST_SECTIONS_ARIA}
        items={[
          { value: 'overview', label: TEXT.DATA_COST_SECTION_OVERVIEW },
          { value: 'prices', label: TEXT.DATA_COST_SECTION_PRICES },
          { value: 'calls', label: TEXT.DATA_COST_SECTION_CALLS },
          { value: 'network', label: TEXT.DATA_COST_SECTION_NETWORK },
        ]}
        value={section}
        onValueChange={(next) => setSection(next as DataSection)}
      />

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--as-danger)' }}>
          {error}
        </p>
      )}

      {section === 'overview' && (
        <div className="space-y-4" role="tabpanel" aria-label={TEXT.DATA_COST_SECTION_OVERVIEW}>
          {report && (
            <section className="grid gap-2 sm:grid-cols-2" aria-label={TEXT.DATA_COST_TITLE}>
              <TotalsCard label={TEXT.DATA_COST_TODAY} totals={report.today} />
              <TotalsCard label={TEXT.DATA_COST_MONTH} totals={report.month} />
            </section>
          )}
          {report && (
            <section className="space-y-2" aria-label={TEXT.DATA_COST_BUDGET_TITLE}>
              <h4 className="text-sm font-semibold">{TEXT.DATA_COST_BUDGET_TITLE}</h4>
              <p className="text-xs opacity-60">{TEXT.DATA_COST_BUDGET_HINT}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs">
                  <span className="opacity-70">{TEXT.DATA_COST_BUDGET_DAILY}</span>
                  <input
                    className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                    type="number"
                    min={0}
                    step="0.01"
                    value={microsToUsdInput(budget.dailyMicros)}
                    onChange={(event) =>
                      onChange({
                        usage: {
                          ...(config.usage ?? { pricing: [] }),
                          budget: { ...budget, dailyMicros: usdInputToMicros(event.target.value) },
                        },
                      })
                    }
                  />
                  {budget.dailyMicros !== null && (
                    <span className="block opacity-60">
                      {interpolate(TEXT.DATA_COST_BUDGET_SPEND, {
                        spend: formatCost(report.today.costMicros),
                        cap: formatCost(budget.dailyMicros),
                      })}
                    </span>
                  )}
                </label>
                <label className="space-y-1 text-xs">
                  <span className="opacity-70">{TEXT.DATA_COST_BUDGET_MONTHLY}</span>
                  <input
                    className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                    type="number"
                    min={0}
                    step="0.01"
                    value={microsToUsdInput(budget.monthlyMicros)}
                    onChange={(event) =>
                      onChange({
                        usage: {
                          ...(config.usage ?? { pricing: [] }),
                          budget: { ...budget, monthlyMicros: usdInputToMicros(event.target.value) },
                        },
                      })
                    }
                  />
                  {budget.monthlyMicros !== null && (
                    <span className="block opacity-60">
                      {interpolate(TEXT.DATA_COST_BUDGET_SPEND, {
                        spend: formatCost(report.month.costMicros),
                        cap: formatCost(budget.monthlyMicros),
                      })}
                    </span>
                  )}
                </label>
              </div>
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
                          {formatCost(row.costMicros, row.unpricedCalls > 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {section === 'prices' && (
        <section className="space-y-2" role="tabpanel" aria-label={TEXT.DATA_COST_SECTION_PRICES}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{TEXT.DATA_COST_PRICING_TITLE}</h4>
            <p className="text-[11px] opacity-60">{TEXT.DATA_COST_SAVE_NOTE}</p>
          </div>
          <p className="text-xs opacity-60">{TEXT.DATA_COST_PRICING_HINT}</p>
          <p className="text-[11px] opacity-60">{TEXT.DATA_COST_DISCLAIMER}</p>

          <div className="space-y-2 rounded-md border border-[var(--as-border)] p-3">
            <h5 className="text-xs font-semibold">{TEXT.DATA_COST_BUILTIN_TITLE}</h5>
            {builtInRows.length === 0 ? (
              <p className="text-xs opacity-60">{TEXT.DATA_COST_BUILTIN_EMPTY}</p>
            ) : (
              builtInRows.map((row) => (
                <div key={row.key} className="grid gap-2 text-xs sm:grid-cols-[1fr_1fr_auto]">
                  <span className="truncate">
                    <span className="opacity-60">{row.provider}</span> · <span className="font-mono">{row.model}</span>
                  </span>
                  <span>{priceLabel(row.resolution)}</span>
                  <span className="opacity-60">
                    {interpolate(TEXT.DATA_COST_CHECKED, { date: row.resolution.reviewedAt ?? TEXT.DATA_COST_NONE })}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            <h5 className="text-xs font-semibold">{TEXT.DATA_COST_CUSTOM_TITLE}</h5>
            {pricing.length === 0 && <p className="text-xs opacity-60">{TEXT.DATA_COST_CUSTOM_EMPTY}</p>}
            {pricing.map((row, index) => (
              <div
                key={`${row.provider ?? 'any'}:${row.model}:${index}`}
                className={`grid gap-2 rounded-md sm:grid-cols-[1fr_1fr_100px_110px_110px_auto] ${
                  highlight === row.model ? 'bg-[var(--as-muted)] p-1' : ''
                }`}
              >
                <input
                  className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  aria-label={`${TEXT.DATA_COST_PROVIDER} ${index + 1}`}
                  placeholder={TEXT.DATA_COST_PROVIDER_PLACEHOLDER}
                  value={row.provider ?? ''}
                  onChange={(event) => patch(index, { provider: event.target.value.trim() || undefined })}
                />
                <input
                  className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  aria-label={`${TEXT.DATA_COST_MODEL} ${index + 1}`}
                  placeholder={TEXT.DATA_COST_MODEL_PLACEHOLDER}
                  value={row.model}
                  onChange={(event) => patch(index, { model: event.target.value })}
                />
                <select
                  className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  aria-label={`${TEXT.DATA_COST_MATCH} ${index + 1}`}
                  value={row.match ?? 'exact'}
                  onChange={(event) => patch(index, { match: event.target.value === 'prefix' ? 'prefix' : 'exact' })}
                >
                  <option value="exact">{TEXT.DATA_COST_MATCH_EXACT}</option>
                  <option value="prefix">{TEXT.DATA_COST_MATCH_PREFIX}</option>
                </select>
                <input
                  className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  aria-label={`${TEXT.DATA_COST_INPUT_PRICE} ${index + 1}`}
                  type="number"
                  min={0}
                  step="0.000001"
                  value={microsToUsd(row.inputMicrosPerMillion)}
                  onChange={(event) => patch(index, { inputMicrosPerMillion: usdToMicros(event.target.value) })}
                />
                <input
                  className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  aria-label={`${TEXT.DATA_COST_OUTPUT_PRICE} ${index + 1}`}
                  type="number"
                  min={0}
                  step="0.000001"
                  value={microsToUsd(row.outputMicrosPerMillion)}
                  onChange={(event) => patch(index, { outputMicrosPerMillion: usdToMicros(event.target.value) })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`${TEXT.DATA_COST_RESET} ${row.model || index + 1}`}
                  onClick={() => savePricing(pricing.filter((_, rowIndex) => rowIndex !== index))}
                >
                  {TEXT.DATA_COST_RESET}
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pricing.length >= 200}
            onClick={() =>
              savePricing([
                ...pricing,
                { model: '', inputMicrosPerMillion: 0, outputMicrosPerMillion: 0, match: 'exact' },
              ])
            }
          >
            {TEXT.DATA_COST_ADD_PRICE}
          </Button>
        </section>
      )}

      {section === 'calls' && (
        <section className="space-y-2" role="tabpanel" aria-label={TEXT.DATA_COST_SECTION_CALLS}>
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
                      <td className="whitespace-nowrap px-2 py-1 text-right">{formatCost(row.costMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {section === 'network' && (
        <section className="space-y-4" role="tabpanel" aria-label={TEXT.DATA_COST_SECTION_NETWORK}>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{TEXT.EGRESS_TITLE}</h4>
            <SelectField
              id="egress-mode"
              label={TEXT.EGRESS_MODE_LABEL}
              value={config.egress?.mode ?? 'off'}
              onChange={(value) => onChange({ egress: { mode: value as EgressMode } })}
              options={[
                { value: 'off', label: TEXT.EGRESS_MODE_OFF },
                { value: 'local-network', label: TEXT.EGRESS_MODE_LOCAL },
                { value: 'strict-local', label: TEXT.EGRESS_MODE_STRICT },
              ]}
              hint={TEXT.EGRESS_HINT}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{TEXT.EGRESS_LOG_TITLE}</h4>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void loadEgress()}>
                {TEXT.DATA_COST_REFRESH}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void window.electronAPI.clearEgressLog().finally(() => void loadEgress());
                }}
              >
                {TEXT.EGRESS_CLEAR}
              </Button>
            </div>
          </div>
          {egress !== null && egress.length === 0 && <p className="text-sm opacity-60">{TEXT.EGRESS_LOG_EMPTY}</p>}
          {egress !== null && egress.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-[var(--as-border)]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--as-border)] opacity-70">
                  <tr>
                    <th className="px-2 py-1 font-medium">{TEXT.EGRESS_WHEN}</th>
                    <th className="px-2 py-1 font-medium">{TEXT.EGRESS_HOST}</th>
                    <th className="px-2 py-1 font-medium">{TEXT.EGRESS_CLASS}</th>
                    <th className="px-2 py-1 text-right font-medium">{TEXT.EGRESS_RESULT}</th>
                  </tr>
                </thead>
                <tbody>
                  {egress.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--as-border)] last:border-0">
                      <td className="whitespace-nowrap px-2 py-1 opacity-70">{new Date(row.at).toLocaleTimeString()}</td>
                      <td className="px-2 py-1 font-mono">{row.host}</td>
                      <td className="px-2 py-1 opacity-70">{classLabel(row.classification)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right" style={{ color: row.allowed ? undefined : 'var(--as-danger)' }}>
                        {row.allowed ? TEXT.EGRESS_ALLOWED : TEXT.EGRESS_BLOCKED}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
