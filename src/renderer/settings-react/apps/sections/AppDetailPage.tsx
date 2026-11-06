import type { ReactElement, RefObject } from "react";
import { Badge } from "@neuronection/assistant-ui/badge";
import { Button } from "@neuronection/assistant-ui/button";
import { Combobox } from "@neuronection/assistant-ui/combobox";
import { IntegrationCard } from "@neuronection/assistant-ui/integration-card";
import { SearchInput } from "@neuronection/assistant-ui/search-input";
import { SegmentedTabs } from "@neuronection/assistant-ui/segmented-tabs";
import { IconPicker } from "../app-icons";
import { PackPageShell } from "../PackPageShell";
import { toolAppCardView } from "../integration-views";
import { RISK_BADGE_CLASS, Switch } from "../../tools/shared";
import type {
  EntityScopeRule,
  ToolAppSpec,
  ToolAppToolState,
  ToolAppView,
} from "@shared/apps";
import type { McpPromptInfo, McpResourceInfo } from "@shared/mcp";
import type { ToolRiskClass } from "@shared/turns";
import { TEXT, interpolate } from "@shared/constants/text";
import type {
  ConnectionPatch,
  SaveConnectionResult,
  ScopePreview,
} from "./shared";
import {
  ConnectionEditor,
  DirectivesEditor,
  RISK_ORDER,
  ToolTagsEditor,
  matchesToolNeedle,
  riskRank,
} from "./shared";
import { AppPermissionsSection } from "./AppPermissionsSection";

interface AppDetailProps {
  detail: ToolAppView;
  onClose: () => void;
  detailTab: "connection" | "tools" | "resources" | "prompts" | "scope";
  onDetailTabChange: (
    tab: "connection" | "tools" | "resources" | "prompts" | "scope",
  ) => void;
  deferredSupported: boolean;
  digestStats: Record<string, { entities: number; ageMinutes: number }>;
  testResult: string | null;
  onTest: (target: ToolAppView) => Promise<void>;
  onSaveIcon: (target: ToolAppView, icon: string | undefined) => Promise<void>;
  onSetExposure: (
    target: ToolAppView,
    exposure: ToolAppSpec["exposure"],
  ) => Promise<void>;
  onToggleExposeResources: (
    target: ToolAppView,
    expose: boolean,
  ) => Promise<void>;
  onSaveConnection: (
    target: ToolAppView,
    patch: ConnectionPatch,
  ) => Promise<SaveConnectionResult>;
  onSaveDirectives: (target: ToolAppView, directives: string) => Promise<void>;
  connectionSaveRef: RefObject<
    ((directives: string) => Promise<boolean | void>) | null
  >;
  directivesDraftRef: RefObject<(() => string) | null>;
  toolNeedle: string;
  onToolNeedleChange: (value: string) => void;
  undo: {
    appId: string;
    toolName: string;
    previous: ToolAppToolState | null;
    timer: number;
  } | null;
  onToggleTool: (
    target: ToolAppView,
    toolName: string,
    enabled: boolean,
  ) => Promise<void>;
  onUndoToolToggle: () => Promise<void>;
  onSetRiskOverride: (
    target: ToolAppView,
    toolName: string,
    risk: ToolRiskClass | null,
  ) => Promise<void>;
  onSaveToolTags: (
    appId: string,
    toolName: string,
    tags: string[],
  ) => Promise<void>;
  content: {
    resources: McpResourceInfo[];
    prompts: McpPromptInfo[];
    error?: string;
  } | null;
  contentLoading: boolean;
  scopeRules: EntityScopeRule[];
  onScopeRulesChange: (
    update: (prev: EntityScopeRule[]) => EntityScopeRule[],
  ) => void;
  scopePreview: ScopePreview | null;
  onSaveScope: (target: ToolAppView) => Promise<void>;
  onPreviewScope: (appId: string) => Promise<void>;
  detailSaving: boolean;
  onDetailSavingChange: (saving: boolean) => void;
}

export function AppDetailPage(props: AppDetailProps): ReactElement {
  const {
    detail: detailView,
    onClose,
    detailSaving,
    onDetailSavingChange: setDetailSaving,
  } = props;
  return (
    <PackPageShell
      title={detailView.app.name}
      pageLabel={TEXT.APPS_DETAIL_PAGE_ARIA}
      onBack={onClose}
    >
      <AppDetailBody {...props} />
      <div className="flex items-center justify-end gap-2 border-t border-[var(--as-border)] pt-4">
        <Button
          size="sm"
          disabled={detailSaving}
          onClick={() => {
            setDetailSaving(true);
            void (async () => {
              try {
                const directives = props.directivesDraftRef.current?.() ?? "";
                const connection = props.connectionSaveRef.current;
                if (connection) {
                  await connection(directives);
                } else {
                  await props.onSaveDirectives(detailView, directives);
                }
              } finally {
                setDetailSaving(false);
              }
            })();
          }}
        >
          {detailSaving ? TEXT.APPS_DETAIL_SAVING : TEXT.APPS_DETAIL_SAVE}
        </Button>
      </div>
    </PackPageShell>
  );
}

function AppDetailBody({
  detail: detailView,
  detailTab,
  onDetailTabChange: setDetailTab,
  deferredSupported,
  digestStats,
  testResult,
  onTest,
  onSaveIcon,
  onSetExposure: setExposure,
  onToggleExposeResources: toggleExposeResources,
  onSaveConnection,
  connectionSaveRef,
  directivesDraftRef,
  toolNeedle,
  onToolNeedleChange: setToolNeedle,
  undo,
  onToggleTool,
  onUndoToolToggle,
  onSetRiskOverride,
  onSaveToolTags,
  content,
  contentLoading,
  scopeRules,
  onScopeRulesChange: setScopeRules,
  scopePreview,
  onSaveScope,
  onPreviewScope,
}: AppDetailProps): ReactElement {
  return (
    <div className="space-y-5">
      <IntegrationCard
        extension={toolAppCardView(detailView)}
        instanceCount={1}
        labels={{ capabilitiesLabel: TEXT.APPS_CARD_TOOLS }}
      />
      <SegmentedTabs
        ariaLabel={interpolate(TEXT.APPS_DETAIL_TITLE, {
          name: detailView.app.name,
        })}
        items={[
          { value: "connection", label: TEXT.APPS_CONNECTION_TITLE },
          { value: "tools", label: TEXT.APPS_TOOLS_TITLE },
          ...(detailView.app.sources[0]?.kind === "mcp"
            ? [
                { value: "resources", label: TEXT.APPS_RESOURCES_TITLE },
                { value: "prompts", label: TEXT.APPS_PROMPTS_TITLE },
              ]
            : []),
          { value: "scope", label: TEXT.APPS_SCOPE_TAB },
        ]}
        value={detailTab}
        onValueChange={(next) =>
          setDetailTab(
            next as "connection" | "tools" | "resources" | "prompts" | "scope",
          )
        }
      />

      {detailTab === "connection" && (
        <section aria-label={TEXT.APPS_CONNECTION_TITLE} className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">
              {TEXT.APPS_ICON_PICKER_LABEL}
            </h3>
            <IconPicker
              current={detailView.app.icon}
              onPick={(icon) => void onSaveIcon(detailView, icon)}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">
              {TEXT.APPS_CONNECTION_TITLE}
            </h3>
            <ConnectionEditor
              view={detailView}
              onSave={onSaveConnection}
              registerSave={(fn) => {
                connectionSaveRef.current = fn;
              }}
            />
            {detailView.app.sources[0]?.kind === "mcp" && (
              <div className="space-y-1 text-xs text-[var(--as-muted-foreground)]">
                <p>
                  {interpolate(TEXT.APPS_SECRETS_KEYS, {
                    keys:
                      [...detailView.envKeys, ...detailView.headerKeys].join(
                        ", ",
                      ) || "—",
                  })}
                </p>
                {testResult && <p role="status">{testResult}</p>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onTest(detailView)}
                >
                  {TEXT.APPS_TEST_ACTION}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">
              {TEXT.APPS_EXPOSURE_TITLE}
            </h3>
            <fieldset className="space-y-1">
              <legend className="sr-only">{TEXT.APPS_EXPOSURE_TITLE}</legend>
              {(["always", "relevance", "deferred"] as const).map(
                (exposure) => {
                  if (exposure === "deferred" && !deferredSupported) {
                    return null;
                  }
                  return (
                    <label
                      key={exposure}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name={`exposure-${detailView.app.id}`}
                        checked={detailView.app.exposure === exposure}
                        onChange={() => void setExposure(detailView, exposure)}
                      />
                      {exposure === "always"
                        ? TEXT.APPS_EXPOSURE_ALWAYS
                        : exposure === "relevance"
                          ? TEXT.APPS_EXPOSURE_RELEVANCE
                          : TEXT.APPS_EXPOSURE_DEFERRED}
                    </label>
                  );
                },
              )}
            </fieldset>
            {!deferredSupported && (
              <p className="text-xs text-[var(--as-muted-foreground)]">
                {TEXT.APPS_EXPOSURE_DEFERRED_REASON}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">
              {TEXT.APPS_DIRECTIVES_TITLE}
            </h3>
            <p className="text-xs text-[var(--as-muted-foreground)]">
              {TEXT.APPS_DIRECTIVES_HINT}
            </p>
            {(() => {
              const detailStat = detailView
                ? digestStats[detailView.app.id]
                : undefined;
              return (
                <p
                  data-testid="app-digest-readout"
                  className="text-xs text-[var(--as-muted-foreground)]"
                >
                  {detailStat
                    ? interpolate(
                        detailStat.ageMinutes === 0
                          ? TEXT.APPS_DIGEST_STATS_FRESH
                          : TEXT.APPS_DIGEST_STATS_ROW,
                        {
                          entities: detailStat.entities,
                          age: String(detailStat.ageMinutes),
                        },
                      )
                    : TEXT.APPS_DIGEST_NONE}
                </p>
              );
            })()}
            <DirectivesEditor
              view={detailView}
              registerSave={(fn) => {
                directivesDraftRef.current = fn;
              }}
            />
          </div>
        </section>
      )}

      {detailTab === "tools" && (
        <section aria-label={TEXT.APPS_TOOLS_TITLE} className="space-y-2">
          <p className="text-xs text-[var(--as-muted-foreground)]">
            {TEXT.APPS_TOOLS_AUTOSAVE}
          </p>
          <SearchInput
            value={toolNeedle}
            onChange={setToolNeedle}
            placeholder={TEXT.APPS_TOOLS_SEARCH_PLACEHOLDER}
            ariaLabel={TEXT.APPS_TOOLS_SEARCH_PLACEHOLDER}
            clearLabel={TEXT.APPS_UNDO}
          />
          {detailView.knownTools.length === 0 ? (
            <p className="text-xs text-[var(--as-muted-foreground)]">
              {TEXT.APPS_TOOLS_EMPTY}
            </p>
          ) : (
            (
              ["read-only", "state-changing", "destructive"] as ToolRiskClass[]
            ).map((risk) => {
              const group = detailView.knownTools.filter((tool) => {
                const effective =
                  tool.state?.riskOverride ??
                  tool.state?.baseRisk ??
                  "state-changing";
                return (
                  effective === risk && matchesToolNeedle(tool, toolNeedle)
                );
              });
              if (group.length === 0) {
                return null;
              }
              return (
                <div key={risk} className="space-y-2">
                  <h3 className="text-xs font-medium text-[var(--as-muted-foreground)]">
                    {interpolate(TEXT.APPS_TOOLS_GROUP_LABEL, {
                      group:
                        risk === "read-only"
                          ? TEXT.TOOLS_FILTER_READ_ONLY
                          : risk === "state-changing"
                            ? TEXT.TOOLS_FILTER_STATE_CHANGING
                            : TEXT.TOOLS_FILTER_DESTRUCTIVE,
                      count: group.length,
                    })}
                  </h3>
                  <ul className="space-y-2">
                    {group.map((tool) => {
                      const base = tool.state?.baseRisk ?? "state-changing";
                      const effective = tool.state?.riskOverride ?? base;
                      return (
                        <li
                          key={tool.name}
                          className="space-y-2 rounded-xl border border-[var(--as-border)] p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={tool.state?.enabled !== false}
                              onCheckedChange={(enabled) =>
                                void onToggleTool(
                                  detailView,
                                  tool.name,
                                  enabled,
                                )
                              }
                              label={interpolate(TEXT.APPS_TOOL_ENABLED_LABEL, {
                                name: tool.name,
                              })}
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-sm font-medium"
                              title={tool.name}
                            >
                              {tool.name}
                            </span>
                            {tool.state === null && (
                              <Badge variant="outline" className="text-[10px]">
                                {TEXT.APPS_TOOL_NEW_BADGE}
                              </Badge>
                            )}
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${RISK_BADGE_CLASS[effective]}`}
                            >
                              {effective}
                            </span>
                          </div>
                          {tool.description && (
                            <p className="line-clamp-2 text-xs leading-4 text-[var(--as-muted-foreground)]">
                              {tool.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <ToolTagsEditor
                              appId={detailView.app.id}
                              toolName={tool.name}
                              tags={tool.state?.keywordTags ?? []}
                              onSave={onSaveToolTags}
                            />
                            <Combobox
                              hideLabel
                              label={interpolate(TEXT.APPS_TOOL_RISK_LABEL, {
                                name: tool.name,
                              })}
                              className="ml-auto w-40"
                              value={tool.state?.riskOverride ?? ""}
                              onChange={(value) =>
                                void onSetRiskOverride(
                                  detailView,
                                  tool.name,
                                  (value || null) as ToolRiskClass | null,
                                )
                              }
                              options={[
                                { value: "", label: base },
                                ...(Object.keys(RISK_ORDER) as ToolRiskClass[])
                                  .filter(
                                    (risk) => riskRank(risk) > riskRank(base),
                                  )
                                  .map((risk) => ({
                                    value: risk,
                                    label: risk,
                                  })),
                              ]}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
          {detailView.knownTools.length > 0 &&
            toolNeedle.trim() &&
            detailView.knownTools.every(
              (tool) => !matchesToolNeedle(tool, toolNeedle),
            ) && (
              <p className="text-xs text-[var(--as-muted-foreground)]">
                {TEXT.APPS_TOOLS_FILTER_EMPTY}
              </p>
            )}
          {undo && (
            <div role="status" className="flex items-center gap-2 text-xs">
              <span>
                {interpolate(TEXT.APPS_TOOL_UNDO, { name: undo.toolName })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void onUndoToolToggle()}
              >
                {TEXT.APPS_UNDO}
              </Button>
            </div>
          )}
        </section>
      )}

      {detailTab === "resources" &&
        detailView.app.sources[0]?.kind === "mcp" && (
          <section aria-label={TEXT.APPS_RESOURCES_TITLE} className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-[var(--as-border)] p-3">
              <Switch
                checked={detailView.app.exposeResources === true}
                onCheckedChange={(expose) =>
                  void toggleExposeResources(detailView, expose)
                }
                label={TEXT.APPS_RESOURCES_EXPOSE_LABEL}
              />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {TEXT.APPS_RESOURCES_EXPOSE_LABEL}
                </p>
                <p className="text-xs text-[var(--as-muted-foreground)]">
                  {TEXT.APPS_RESOURCES_EXPOSE_HINT}
                </p>
              </div>
            </div>
            <p className="text-xs text-[var(--as-muted-foreground)]">
              {TEXT.APPS_RESOURCES_HINT}
            </p>
            <p
              role="note"
              className="rounded-lg border border-[var(--as-border)] p-2 text-xs text-[var(--as-muted-foreground)]"
            >
              {TEXT.APPS_CONTENT_UNTRUSTED_NOTICE}
            </p>
            {contentLoading ? (
              <p className="text-xs text-[var(--as-muted-foreground)]">
                {TEXT.APPS_CONTENT_LOADING}
              </p>
            ) : content?.error ? (
              <p
                role="alert"
                className="text-xs text-[var(--as-muted-foreground)]"
              >
                {interpolate(TEXT.APPS_CONTENT_ERROR, { error: content.error })}
              </p>
            ) : (content?.resources.length ?? 0) === 0 ? (
              <p className="text-xs text-[var(--as-muted-foreground)]">
                {TEXT.APPS_RESOURCES_EMPTY}
              </p>
            ) : (
              <ul className="space-y-2">
                {content!.resources.map((resource) => (
                  <li
                    key={resource.uri}
                    className="space-y-1 rounded-xl border border-[var(--as-border)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium"
                        title={resource.name}
                      >
                        {resource.name}
                      </span>
                      {resource.mimeType && (
                        <Badge variant="outline" className="text-[10px]">
                          {resource.mimeType}
                        </Badge>
                      )}
                    </div>
                    <p
                      className="truncate text-xs text-[var(--as-muted-foreground)]"
                      title={resource.uri}
                    >
                      {resource.uri}
                    </p>
                    {resource.description && (
                      <p className="text-xs leading-4 text-[var(--as-muted-foreground)]">
                        {resource.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

      {detailTab === "prompts" && detailView.app.sources[0]?.kind === "mcp" && (
        <section aria-label={TEXT.APPS_PROMPTS_TITLE} className="space-y-3">
          <p className="text-xs text-[var(--as-muted-foreground)]">
            {TEXT.APPS_PROMPTS_HINT}
          </p>
          <p
            role="note"
            className="rounded-lg border border-[var(--as-border)] p-2 text-xs text-[var(--as-muted-foreground)]"
          >
            {TEXT.APPS_CONTENT_UNTRUSTED_NOTICE}
          </p>
          {contentLoading ? (
            <p className="text-xs text-[var(--as-muted-foreground)]">
              {TEXT.APPS_CONTENT_LOADING}
            </p>
          ) : content?.error ? (
            <p
              role="alert"
              className="text-xs text-[var(--as-muted-foreground)]"
            >
              {interpolate(TEXT.APPS_CONTENT_ERROR, { error: content.error })}
            </p>
          ) : (content?.prompts.length ?? 0) === 0 ? (
            <p className="text-xs text-[var(--as-muted-foreground)]">
              {TEXT.APPS_PROMPTS_EMPTY}
            </p>
          ) : (
            <ul className="space-y-2">
              {content!.prompts.map((prompt) => (
                <li
                  key={prompt.name}
                  className="space-y-1 rounded-xl border border-[var(--as-border)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium"
                      title={prompt.name}
                    >
                      {prompt.title ?? prompt.name}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {prompt.name}
                    </Badge>
                  </div>
                  {prompt.description && (
                    <p className="text-xs leading-4 text-[var(--as-muted-foreground)]">
                      {prompt.description}
                    </p>
                  )}
                  {prompt.arguments.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--as-muted-foreground)]">
                        {TEXT.APPS_PROMPTS_ARGUMENTS_LABEL}
                      </p>
                      <ul className="space-y-0.5">
                        {prompt.arguments.map((argument) => (
                          <li
                            key={argument.name}
                            className="text-xs text-[var(--as-muted-foreground)]"
                          >
                            <span className="font-medium text-[var(--as-fg)]">
                              {argument.name}
                            </span>
                            {argument.required
                              ? ` (${TEXT.APPS_PROMPTS_REQUIRED})`
                              : ""}
                            {argument.description
                              ? ` — ${argument.description}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {detailTab === "scope" && detailView.app.sources[0]?.kind === "mcp" && (
        <AppPermissionsSection
          view={detailView}
          rules={scopeRules}
          onRulesChange={setScopeRules}
          preview={scopePreview}
          onSave={onSaveScope}
          onPreview={onPreviewScope}
        />
      )}
    </div>
  );
}
