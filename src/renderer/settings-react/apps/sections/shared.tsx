import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ToolAppView } from '@shared/apps';
import type { ToolRiskClass } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

export type StatusFilter = 'all' | 'healthy' | 'unavailable' | 'error' | 'disabled';

export interface ScopePreview {
  entities: { id: string; allowed: boolean }[];
}

export interface ConnectionPatch {
  endpoint?: string;
  command?: string;
  args?: string[];
  token?: string;
  allowlist?: string[];
  defaultAction?: 'allow' | 'deny';
  timeoutMs?: number;
  maxConcurrent?: number;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  directives?: string;
}

export type SaveConnectionResult = { ok: true } | { ok: false; error: string };

export const RISK_ORDER: Record<ToolRiskClass, number> = {
  'read-only': 0,
  'state-changing': 1,
  destructive: 2,
};

export function healthOf(view: ToolAppView): 'healthy' | 'unavailable' | 'error' {
  if (view.status?.state === 'error') {
    return 'error';
  }
  if (view.status?.state === 'connected') {
    return 'healthy';
  }
  return 'unavailable';
}

export function riskRank(risk: ToolRiskClass): number {
  return RISK_ORDER[risk];
}

export function matchesToolNeedle(
  tool: ToolAppView['knownTools'][number],
  needle: string
): boolean {
  const needleLower = needle.trim().toLowerCase();
  if (!needleLower) {
    return true;
  }
  const haystack = `${tool.name} ${tool.description ?? ''} ${(tool.state?.keywordTags ?? []).join(' ')}`.toLowerCase();
  return haystack.includes(needleLower);
}

export function parseJsonStringMap(text: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === 'string')
    ) {
      return { ok: true, value: parsed as Record<string, string> };
    }
    return { ok: false, error: 'must be a JSON object with string values' };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

export function parsePositiveInt(text: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, error: 'must be a positive whole number' };
  }
  return { ok: true, value };
}

export function ToolTagsEditor({
  appId,
  toolName,
  tags,
  onSave,
}: {
  appId: string;
  toolName: string;
  tags: string[];
  onSave: (appId: string, toolName: string, tags: string[]) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(tags.join(', '));
  useEffect(() => {
    setDraft(tags.join(', '));
  }, [tags.join(', ')]);
  return (
    <input
      aria-label={interpolate(TEXT.APPS_TOOL_TAGS_LABEL, { name: toolName })}
      value={draft}
      placeholder="keywords, comma separated"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = draft.split(',').map((tag) => tag.trim()).filter(Boolean);
        if (JSON.stringify(parsed) !== JSON.stringify(tags)) {
          void onSave(appId, toolName, parsed);
        }
      }}
      className="w-28 rounded border border-[var(--as-border)] bg-transparent px-1 py-0.5 text-xs"
    />
  );
}

export function DirectivesEditor({
  view,
  registerSave,
}: {
  view: ToolAppView;
  registerSave?: (fn: (() => string) | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState(view.app.directives ?? '');
  useEffect(() => {
    setDraft(view.app.directives ?? '');
  }, [view.app.directives]);
  useEffect(() => {
    registerSave?.(() => draft);
  });
  return (
    <div className="space-y-1">
      <label className="sr-only" htmlFor="app-directives">
        {TEXT.APPS_DIRECTIVES_LABEL}
      </label>
      <textarea
        id="app-directives"
        rows={3}
        maxLength={500}
        className="w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="e.g. For all smart-home tasks use the app tools — never shell commands."
      />
    </div>
  );
}

export function ConnectionEditor({
  view,
  onSave,
  registerSave,
}: {
  view: ToolAppView;
  onSave: (view: ToolAppView, patch: ConnectionPatch) => Promise<SaveConnectionResult>;
  registerSave?: (fn: ((directives: string) => Promise<boolean | void>) | null) => void;
}): ReactElement {
  const mcp = view.app.sources[0]?.kind === 'mcp' ? view.app.sources[0].server : null;
  const stdio = mcp?.transport.type === 'stdio';
  const [endpoint, setEndpoint] = useState(mcp && mcp.transport.type !== 'stdio' ? mcp.transport.url : '');
  const [command, setCommand] = useState(mcp?.transport.type === 'stdio' ? mcp.transport.command : '');
  const [args, setArgs] = useState(mcp?.transport.type === 'stdio' ? (mcp.transport.args ?? []).join(' ') : '');
  const [token, setToken] = useState('');
  const [allowlist, setAllowlist] = useState((mcp?.allowlist ?? []).join(', '));
  const [timeoutMs, setTimeoutMs] = useState(mcp?.timeoutMs ? String(mcp.timeoutMs) : '');
  const [maxConcurrent, setMaxConcurrent] = useState(mcp?.maxConcurrent ? String(mcp.maxConcurrent) : '');
  const [envText, setEnvText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (directives: string): Promise<boolean> => {
    setError(null);
    if (stdio && !command.trim()) {
      setError(TEXT.APPS_CUSTOM_COMMAND_REQUIRED);
      return false;
    }
    let env: Record<string, string> | undefined;
    let headers: Record<string, string> | undefined;
    if (envText.trim()) {
      const parsed = parseJsonStringMap(envText);
      if (!parsed.ok) {
        setError(interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, { field: TEXT.APPS_CUSTOM_ENV, error: parsed.error }));
        return false;
      }
      env = parsed.value;
    }
    if (!stdio && headersText.trim()) {
      const parsed = parseJsonStringMap(headersText);
      if (!parsed.ok) {
        setError(interpolate(TEXT.APPS_CUSTOM_JSON_ERROR, { field: TEXT.APPS_CUSTOM_HEADERS, error: parsed.error }));
        return false;
      }
      headers = parsed.value;
    }
    const timeout = parsePositiveInt(timeoutMs);
    if (!timeout.ok) {
      setError(interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, { field: TEXT.APPS_CUSTOM_TIMEOUT }));
      return false;
    }
    const concurrency = parsePositiveInt(maxConcurrent);
    if (!concurrency.ok) {
      setError(interpolate(TEXT.APPS_CUSTOM_NUMBER_ERROR, { field: TEXT.APPS_CUSTOM_MAXCONC }));
      return false;
    }
    const allowlistTools = allowlist.split(',').map((entry) => entry.trim()).filter(Boolean);
    const result = await onSave(view, {
      ...(stdio
        ? { command: command.trim(), ...(args.trim() ? { args: args.trim().split(/\s+/) } : {}) }
        : { endpoint }),
      ...(token ? { token } : {}),
      allowlist: allowlistTools,
      defaultAction: allowlistTools.length > 0 ? 'deny' : 'allow',
      ...(timeout.value !== undefined ? { timeoutMs: timeout.value } : {}),
      ...(concurrency.value !== undefined ? { maxConcurrent: concurrency.value } : {}),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {}),
      directives: directives.trim(),
    });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    return true;
  };
  useEffect(() => {
    registerSave?.(mcp ? (directives: string) => save(directives) : null);
  });
  if (!mcp) {
    return <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SOURCE_NATIVE}</p>;
  }
  return (
    <div className="space-y-2">
      {stdio ? (
        <>
          <label className="block text-xs" htmlFor="app-command">
            {TEXT.APPS_CUSTOM_COMMAND}
            <input
              id="app-command"
              className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="/usr/bin/npx"
            />
          </label>
          <label className="block text-xs" htmlFor="app-args">
            {TEXT.APPS_CUSTOM_ARGS}
            <input
              id="app-args"
              className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
          </label>
        </>
      ) : (
        <label className="block text-xs" htmlFor="app-endpoint">
          {TEXT.APPS_ENDPOINT_LABEL}
          <input
            id="app-endpoint"
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </label>
      )}
      {!stdio && (
        <>
          <label className="block text-xs" htmlFor="app-token">
            {TEXT.APPS_TOKEN_LABEL}
            <input
              id="app-token"
              type="password"
              className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          {view.headerKeys.includes('Authorization') && (
            <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_TOKEN_SET}</p>
          )}
        </>
      )}
      <label className="block text-xs" htmlFor="app-allowlist">
        {TEXT.APPS_CUSTOM_ALLOWLIST}
        <input
          id="app-allowlist"
          className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-xs" htmlFor="app-timeout">
          {TEXT.APPS_CUSTOM_TIMEOUT}
          <input
            id="app-timeout"
            type="number"
            min={1000}
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
          />
        </label>
        <label className="block flex-1 text-xs" htmlFor="app-maxconc">
          {TEXT.APPS_CUSTOM_MAXCONC}
          <input
            id="app-maxconc"
            type="number"
            min={1}
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
            value={maxConcurrent}
            onChange={(event) => setMaxConcurrent(event.target.value)}
          />
        </label>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--as-muted-foreground)]">{TEXT.APPS_ADVANCED_TITLE}</p>
        <label className="block text-xs" htmlFor="app-env">
          {TEXT.APPS_CUSTOM_ENV}
          <textarea
            id="app-env"
            rows={3}
            placeholder='{{ "KEY": "value" }}'
            className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
            value={envText}
            onChange={(event) => setEnvText(event.target.value)}
          />
        </label>
        {!stdio && (
          <label className="block text-xs" htmlFor="app-headers">
            {TEXT.APPS_CUSTOM_HEADERS}
            <textarea
              id="app-headers"
              rows={3}
              placeholder='{{ "X-Custom": "value" }}'
              className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
              value={headersText}
              onChange={(event) => setHeadersText(event.target.value)}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
