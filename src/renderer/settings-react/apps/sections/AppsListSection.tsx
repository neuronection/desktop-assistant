import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { IntegrationInstancesList } from '@neuronection/assistant-ui/integration-instances-list';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { AppUsageCard } from '../AppUsageCard';
import type { IntegrationExtensionGroupView } from '@neuronection/assistant-ui/integration-contracts';
import { Switch } from '../../tools/shared';
import type { ToolAppView } from '@shared/apps';
import { TEXT, interpolate } from '@shared/constants/text';
import type { StatusFilter } from './shared';

interface AppsListSectionProps {
  needle: string;
  onNeedleChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  loading: boolean;
  error: string | null;
  groups: IntegrationExtensionGroupView[];
  views: ToolAppView[];
  cardTests: Record<string, string>;
  toolBudget: number;
  totalToolCount: number;
  onToolBudgetChange: (value: number) => void;
  onSaveBudget: (value: number) => Promise<void>;
  onToggleApp: (target: ToolAppView, enabled: boolean) => Promise<void>;
  onMasterToggle: (enabled: boolean) => Promise<void>;
  onConfigure: (id: string) => void;
  onRemove: (target: ToolAppView) => void;
  onTest: (target: ToolAppView) => Promise<void>;
  onAdd: () => void;
}

export function AppsListSection({
  needle,
  onNeedleChange,
  statusFilter,
  onStatusFilterChange,
  loading,
  error,
  groups,
  views,
  cardTests,
  toolBudget,
  totalToolCount,
  onToolBudgetChange,
  onSaveBudget,
  onToggleApp,
  onMasterToggle,
  onConfigure,
  onRemove,
  onTest,
  onAdd,
}: AppsListSectionProps): ReactElement {
  return (
    <div role="tabpanel" aria-label={TEXT.APPS_VIEW_APPS} className="space-y-5">
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_NAV_MATCHING_HELP}</p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={needle} onChange={onNeedleChange} placeholder={TEXT.APPS_SEARCH_PLACEHOLDER} ariaLabel={TEXT.APPS_SEARCH_PLACEHOLDER} clearLabel={TEXT.APPS_UNDO} />
        {(['all', 'healthy', 'unavailable', 'error', 'disabled'] as StatusFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            aria-pressed={statusFilter === filter}
            onClick={() => onStatusFilterChange(filter)}
            className={`rounded-full border px-3 py-1 text-xs ${
              statusFilter === filter ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'
            }`}
          >
            {filter === 'all'
              ? TEXT.APPS_FILTER_ALL
              : filter === 'healthy'
                ? TEXT.APPS_HEALTH_HEALTHY
                : filter === 'unavailable'
                  ? TEXT.APPS_HEALTH_UNAVAILABLE
                  : filter === 'error'
                    ? TEXT.APPS_HEALTH_ERROR
                    : TEXT.APPS_HEALTH_DISABLED}
          </button>
        ))}
        <Button size="sm" onClick={onAdd}>
          {TEXT.APPS_ADD_APP}
        </Button>
      </div>

      <IntegrationInstancesList
        groups={groups}
        loading={loading}
        error={error}
        labels={{
          loadingLabel: TEXT.APPS_LOADING,
          emptyLabel: TEXT.APPS_EMPTY,
          enableLabel: TEXT.APPS_ENABLE,
          disableLabel: TEXT.APPS_DISABLE,
          configureLabel: TEXT.APPS_DETAILS,
          removeLabel: TEXT.APPS_REMOVE,
          tombstoneLabel: TEXT.APPS_REMOVE,
          statusLabels: {
            ok: TEXT.APPS_HEALTH_HEALTHY,
            degraded: TEXT.APPS_INSTANCE_DEGRADED,
            failing: TEXT.APPS_HEALTH_ERROR,
            stale: TEXT.APPS_INSTANCE_STALE,
          },
          conditionLabels: {
            'needs-config': TEXT.APPS_INSTANCE_NEEDS_CONFIG,
            'needs-secret': TEXT.APPS_INSTANCE_NEEDS_SECRET,
          },
          lastSuccessLabel: TEXT.APPS_INSTANCE_LAST_SUCCESS,
          failuresLabel: TEXT.APPS_INSTANCE_FAILURES,
        }}
        onToggleEnabled={(instance, enabled) => {
          const target = views.find((candidate) => candidate.app.id === instance.id);
          if (target) {
            void onToggleApp(target, enabled);
          }
        }}
        onConfigure={(instance) => onConfigure(instance.id)}
        onTombstone={(instance) => {
          const target = views.find((candidate) => candidate.app.id === instance.id);
          if (target) {
            onRemove(target);
          }
        }}
        renderInstanceActions={(instance) => {
          const target = views.find((candidate) => candidate.app.id === instance.id);
          if (!target) {
            return null;
          }
          return (
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="ghost" onClick={() => void onTest(target)}>
                {TEXT.APPS_TEST_ACTION}
              </Button>
              {cardTests[target.app.id] && (
                <p role="status" className="text-xs">
                  {cardTests[target.app.id]}
                </p>
              )}
              {target.app.error && (
                <p role="alert" className="text-xs text-[var(--as-danger)]">
                  {target.app.error}
                </p>
              )}
            </div>
          );
        }}
      />
      <section aria-label={TEXT.APPS_SETTINGS_SECTION} className="space-y-5 pt-2">
      <section aria-label={TEXT.APPS_BUDGET_TITLE} className="space-y-2 rounded-xl border border-[var(--as-border)] p-4">
        <h3 className="text-sm font-semibold">{TEXT.APPS_BUDGET_TITLE}</h3>
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_BUDGET_DESCRIPTION}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--as-muted)]">
          <div
            className={`h-full rounded-full ${totalToolCount > toolBudget ? 'bg-[var(--as-danger)]' : 'bg-[var(--as-primary)]'}`}
            style={{ width: `${Math.min(100, Math.round((totalToolCount / Math.max(1, toolBudget)) * 100))}%` }}
          />
        </div>
        <p role="status" className="text-xs">
          {interpolate(TEXT.APPS_BUDGET_BOUND, { count: totalToolCount })} · {TEXT.APPS_BUDGET_LABEL}: {toolBudget}
        </p>
        {totalToolCount > toolBudget && (
          <p role="alert" className="text-xs text-[var(--as-danger)]">
            {TEXT.APPS_BUDGET_OVER}
          </p>
        )}
        <label className="block text-xs" htmlFor="apps-budget-input">
          {TEXT.APPS_BUDGET_LABEL}
          <input
            id="apps-budget-input"
            type="number"
            min={1}
            max={200}
            className="mt-1 w-24 rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
            value={toolBudget}
            onChange={(event) => onToolBudgetChange(Number(event.target.value))}
            onBlur={() => void onSaveBudget(toolBudget)}
          />
        </label>
      </section>

      <section aria-label={TEXT.APPS_MASTER_SWITCH_TITLE} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--as-border)] p-4">
        <div>
          <h3 className="text-sm font-semibold">{TEXT.APPS_MASTER_SWITCH_TITLE}</h3>
          <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_MASTER_SWITCH_HINT}</p>
        </div>
        <Switch
          checked={views.some((candidate) => candidate.app.enabled) || views.length === 0}
          onCheckedChange={(enabled) => void onMasterToggle(enabled)}
          label={TEXT.APPS_MASTER_SWITCH_TITLE}
        />
      </section>

      <section aria-label={TEXT.APPS_NAV_MATCHING_HELP} className="rounded-xl border border-[var(--as-border)] p-4">
        <h3 className="text-sm font-semibold">{TEXT.APPS_MATCHING_HELP_TITLE}</h3>
        <p className="mt-1 text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_NAV_MATCHING_HELP}</p>
      </section>

      <AppUsageCard />
      </section>
    </div>
  );
}
