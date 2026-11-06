import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { ListChecks, Settings2 } from "lucide-react";
import { Button } from "@neuronection/assistant-ui/button";
import { ConfirmationModal } from "@neuronection/assistant-ui/confirmation-modal";
import { EmptyState } from "@neuronection/assistant-ui/empty-state";
import { IntegrationCard } from "@neuronection/assistant-ui/integration-card";
import { Switch } from "../tools/shared";
import { PackConfigPage } from "./PackConfigPage";
import { PackRunsPage } from "./PackRunsPage";
import { SourcesPage } from "./SourcesPage";
import { packCardView } from "./integration-views";
import type { SettingsDetailRoute } from "./route";
import { TEXT, interpolate } from "@shared/constants/text";
import type { MiniAppView, MiniAppsState } from "@shared/app-pack";

function PackCard({
  view,
  onEnabledChange,
  onRemove,
  onConfigure,
  onRuns,
}: {
  view: MiniAppView;
  onEnabledChange: (enabled: boolean) => void;
  onRemove: () => void;
  onConfigure: () => void;
  onRuns: (() => void) | null;
}): ReactElement {
  const cardView = useMemo(() => packCardView(view), [view]);

  return (
    <IntegrationCard
      extension={cardView}
      labels={{
        capabilitiesLabel: TEXT.MINIAPPS_CAPABILITIES,
        enableLabel: TEXT.MINIAPPS_ENABLE,
        disableLabel: TEXT.MINIAPPS_DISABLE,
        removeLabel: TEXT.MINIAPPS_REMOVE,
        enabledAriaLabel: interpolate(TEXT.MINIAPPS_ENABLE_ARIA, {
          title: view.title,
        }),
      }}
      enabled={view.enabled}
      onEnable={(_extension, enabled) => onEnabledChange(enabled)}
      onRemove={() => onRemove()}
    >
      {view.error && (
        <p className="text-xs text-[var(--as-danger)]">
          {interpolate(TEXT.MINIAPPS_DISABLED_REASON, { reason: view.error })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          data-pack-configure={view.id}
          data-testid={`pack-configure-${view.id}`}
          aria-label={interpolate(TEXT.MINIAPPS_CONFIGURE_ARIA, {
            title: view.title,
          })}
          onClick={onConfigure}
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          {TEXT.MINIAPPS_CONFIGURE}
        </Button>
        {onRuns && (
          <Button
            size="sm"
            variant="outline"
            data-testid={`pack-runs-${view.id}`}
            aria-label={interpolate(TEXT.MINIAPPS_RUNS_ARIA, {
              title: view.title,
            })}
            onClick={onRuns}
          >
            <ListChecks className="h-4 w-4" aria-hidden />
            {TEXT.MINIAPPS_RUNS_TITLE}
          </Button>
        )}
      </div>
    </IntegrationCard>
  );
}

export function MiniAppsSection({
  miniAppRunFocus,
  route: routeProp,
  onRouteChange,
}: {
  miniAppRunFocus?: { packId: string; runId: string; at: number } | null;
  route?: SettingsDetailRoute | null;
  onRouteChange?: (route: SettingsDetailRoute | null) => void;
} = {}): ReactElement {
  const [state, setState] = useState<MiniAppsState | null>(null);
  const [t2Isolation, setT2Isolation] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MiniAppView | null>(null);
  const [focusPackId, setFocusPackId] = useState<string | null>(null);
  const [focusSources, setFocusSources] = useState(false);
  const [internalRoute, setInternalRoute] = useState<SettingsDetailRoute | null>(null);
  const route = routeProp ?? internalRoute;
  const changeRoute = onRouteChange ?? setInternalRoute;

  const refresh = useCallback(async () => {
    setState(await window.electronAPI.getMiniApps());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const loadProfile = window.electronAPI.getMiniAppHostProfile;
    if (typeof loadProfile !== "function") {
      return;
    }
    let live = true;
    void loadProfile()
      .then((view) => {
        if (live && typeof view.t2Isolation === "string") {
          setT2Isolation(view.t2Isolation);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const routedView = useMemo(
    () =>
      route && (route.kind === 'pack-config' || route.kind === 'pack-runs')
        ? (state?.packs.find((candidate) => candidate.id === route.packId) ??
          null)
        : null,
    [route, state],
  );

  useEffect(() => {
    if (route?.kind !== "pack-config" && route?.kind !== "pack-runs") {
      return;
    }
    if (state === null) {
      return;
    }
    if (!state.packs.some((candidate) => candidate.id === route.packId)) {
      changeRoute(null);
      setNotice(TEXT.MINIAPPS_PAGE_GONE);
    }
  }, [route, state, onRouteChange]);

  useEffect(() => {
    if (route || !focusPackId) {
      return;
    }
    const button = document.querySelector<HTMLButtonElement>(
      `button[data-pack-configure="${CSS.escape(focusPackId)}"]`,
    );
    button?.focus();
    setFocusPackId(null);
  }, [route, focusPackId]);

  const backToHub = useCallback(
    (packId: string) => {
      setFocusPackId(packId);
      changeRoute(null);
    },
    [changeRoute],
  );

  const backFromSources = useCallback(() => {
    setFocusSources(true);
    changeRoute(null);
  }, [changeRoute]);

  useEffect(() => {
    if (route?.kind === "sources" || !focusSources) {
      return;
    }
    document.querySelector<HTMLButtonElement>("button[data-sources-open]")?.focus();
    setFocusSources(false);
  }, [route, focusSources]);

  const importPack = useCallback(async () => {
    setNotice(null);
    const picked = await window.electronAPI.openFile({
      title: TEXT.MINIAPPS_IMPORT_PICK_TITLE,
      filters: [{ name: "Pack JSON", extensions: ["json"] }],
    });
    if (!picked?.content) {
      return;
    }
    const result = await window.electronAPI.importMiniApp(
      picked.content,
      picked.filePath,
    );
    if (!result.ok) {
      setNotice(
        interpolate(TEXT.MINIAPPS_IMPORT_FAILED, { error: result.error }),
      );
    }
    await refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (id: string | null, enabled: boolean) => {
      const result = await window.electronAPI.setMiniAppEnabled(id, enabled);
      if (!result.ok) {
        setNotice(
          interpolate(
            id === null
              ? TEXT.MINIAPPS_IMPORT_FAILED
              : TEXT.MINIAPPS_ENABLE_REJECTED,
            { error: result.error },
          ),
        );
      }
      await refresh();
    },
    [refresh],
  );

  const removePack = useCallback(
    async (id: string) => {
      await window.electronAPI.removeMiniApp(id);
      setRemoving(null);
      await refresh();
    },
    [refresh],
  );

  const restoreBundled = useCallback(async () => {
    await window.electronAPI.restoreBundledMiniApps();
    await refresh();
  }, [refresh]);

  const saveConfig = useCallback(
    async (
      view: MiniAppView,
      values: Record<string, unknown>,
    ): Promise<string | null> => {
      const result = await window.electronAPI.saveMiniAppConfig(
        view.id,
        values,
      );
      await refresh();
      return result.ok
        ? null
        : interpolate(TEXT.MINIAPPS_CONFIG_FAILED, { error: result.error });
    },
    [refresh],
  );

  const packs = useMemo(() => state?.packs ?? [], [state]);
  const manageable = useMemo(
    () => packs.filter((view) => view.kind === "assessment"),
    [packs],
  );
  const surfaces = useMemo(
    () => packs.filter((view) => view.kind === "surface"),
    [packs],
  );

  if (route?.kind === "sources") {
    return <SourcesPage onBack={backFromSources} />;
  }

  if (route?.kind === "pack-config" && routedView) {
    return (
      <PackConfigPage
        view={routedView}
        onBack={() => backToHub(routedView.id)}
        onEnabledChange={(next) => void setEnabled(routedView.id, next)}
        onConfigSave={(values) => saveConfig(routedView, values)}
      />
    );
  }

  if (route?.kind === "pack-runs" && routedView) {
    return (
      <PackRunsPage
        view={routedView}
        onBack={() => backToHub(routedView.id)}
        focusReportRunId={miniAppRunFocus ?? null}
      />
    );
  }

  return (
    <div role="tabpanel" aria-label={TEXT.MINIAPPS_VIEW} className="space-y-5">
      <p className="text-xs text-[var(--as-muted-foreground)]">
        {TEXT.MINIAPPS_LIST_HINT}
      </p>
      {t2Isolation && (
        <p
          data-testid="miniapps-isolation-disclosure"
          className="text-xs text-[var(--as-muted-foreground)]"
        >
          {interpolate(TEXT.MINIAPPS_ISOLATION_DISCLOSURE, {
            grade: t2Isolation,
          })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm">{TEXT.MINIAPPS_MASTER}</span>
          <Switch
            checked={state?.masterEnabled ?? true}
            onCheckedChange={(next) => void setEnabled(null, next)}
            label={TEXT.MINIAPPS_MASTER}
            hideLabel
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="miniapps-sources-open"
            data-sources-open
            onClick={() => changeRoute({ kind: "sources" })}
          >
            {TEXT.MINIAPPS_SOURCES}
          </Button>
          <Button size="sm" onClick={() => void importPack()}>
            {TEXT.MINIAPPS_IMPORT}
          </Button>
        </div>
      </div>
      {notice && (
        <p
          role="alert"
          className="rounded-md border border-[var(--as-destructive)]/40 bg-[var(--as-destructive)]/10 px-3 py-2 text-xs text-[var(--as-destructive)]"
        >
          {notice}
        </p>
      )}
      {manageable.length === 0 && surfaces.length === 0 ? (
        <EmptyState
          title={TEXT.MINIAPPS_EMPTY}
          description={TEXT.MINIAPPS_EMPTY_HINT}
        />
      ) : (
        <>
          {manageable.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {manageable.map((view) => (
                <li key={view.id} className="min-w-0">
                  <PackCard
                    view={view}
                    onEnabledChange={(next) => void setEnabled(view.id, next)}
                    onRemove={() => setRemoving(view)}
                    onConfigure={() =>
                      changeRoute({ kind: "pack-config", packId: view.id })
                    }
                    onRuns={
                      view.kind === "assessment" &&
                      view.capabilities.includes("run")
                        ? () =>
                            changeRoute({
                              kind: "pack-runs",
                              packId: view.id,
                            })
                        : null
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {surfaces.length > 0 && (
            <section
              aria-label={TEXT.MINIAPPS_SURFACES_TITLE}
              className="space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">
                    {TEXT.MINIAPPS_SURFACES_TITLE}
                  </h3>
                  <p className="text-xs text-[var(--as-muted-foreground)]">
                    {TEXT.MINIAPPS_SURFACES_HINT}
                  </p>
                </div>
                {(state?.removedBundled?.length ?? 0) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void restoreBundled()}
                  >
                    {TEXT.MINIAPPS_RESTORE_BUNDLED}
                  </Button>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {surfaces.map((view) => (
                  <li key={view.id} className="min-w-0">
                    <PackCard
                      view={view}
                      onEnabledChange={(next) => void setEnabled(view.id, next)}
                      onRemove={() => setRemoving(view)}
                      onConfigure={() =>
                        changeRoute({
                          kind: "pack-config",
                          packId: view.id,
                        })
                      }
                      onRuns={null}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {removing && (
        <ConfirmationModal
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={TEXT.MINIAPPS_REMOVE_CONFIRM_TITLE}
          description={
            removing.originKind === "bundled"
              ? interpolate(TEXT.MINIAPPS_REMOVE_BUNDLED_BODY, {
                  title: removing.title,
                })
              : interpolate(TEXT.MINIAPPS_REMOVE_CONFIRM_BODY, {
                  title: removing.title,
                })
          }
          confirmLabel={TEXT.MINIAPPS_REMOVE}
          destructive
          onConfirm={() => void removePack(removing.id)}
        />
      )}
    </div>
  );
}
