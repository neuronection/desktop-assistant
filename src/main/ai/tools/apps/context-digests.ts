import type { McpServerConfig } from '@shared/mcp';
import { renderAppDigest, type DigestRow } from '@shared/ai/app-context';
import { aiDebugEnabled } from '../../debug';

export type { DigestRow };

/**
 * Context-digest service (plan 23 S3): capability-keyed providers turn
 * one read-only tool call into a compact "what exists" digest that is
 * TTL-cached per server, refreshed single-flight, and served stale (with
 * an age note) when a refresh fails — discovery disappears from turns
 * (D4/D13). Infrastructure calls, never audited as model tool calls.
 */

export const DIGEST_TTL_MS = 15 * 60 * 1000;

export interface DigestProvider {
  /** Tool names to look for on the server (matched as exact or suffix). */
  toolCandidates: string[];
  /** Normalize a tool payload into rows; null/empty = nothing to say. */
  render(payload: unknown): DigestRow[] | null;
}

export interface DigestDeps {
  listTools(server: McpServerConfig): Promise<{ name: string }[]>;
  invokeTool(server: McpServerConfig, toolName: string): Promise<unknown>;
  now?(): number;
}

interface CacheEntry {
  text: string;
  fetchedAt: number;
}

export interface DigestRequest {
  capability?: string;
  appName: string;
  server: McpServerConfig;
  /** Entity-scope filter (D10) — rows failing it never reach the prompt. */
  entityAllowed?: (entityId: string) => boolean;
}

export class ContextDigestService {
  private readonly providers = new Map<string, DigestProvider>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly deps: DigestDeps,
    private readonly ttlMs = DIGEST_TTL_MS
  ) {}

  register(capability: string, provider: DigestProvider): void {
    this.providers.set(capability, provider);
  }

  hasProvider(capability?: string): boolean {
    return capability === undefined ? false : this.providers.has(capability);
  }

  /**
   * Cache-only readout for settings surfaces (plan 23 S6): never
   * triggers a fetch; counts raw (pre-scope-filter) rows.
   */
  peek(serverId: string): { entities: number; ageMinutes: number } | null {
    const entry = this.cache.get(serverId);
    if (!entry) {
      return null;
    }
    const now = this.deps.now?.() ?? Date.now();
    return {
      entities: entry.text.split('\n').filter(Boolean).length,
      ageMinutes: Math.max(0, Math.round((now - entry.fetchedAt) / 60000)),
    };
  }

  invalidate(serverId: string): void {
    this.cache.delete(serverId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  async digestFor(request: DigestRequest): Promise<string | null> {
    if (!request.capability) {
      this.debug(`no capability for '${request.appName}' — skipped`);
      return null;
    }
    const provider = this.providers.get(request.capability);
    if (!provider) {
      this.debug(`no provider for capability '${request.capability}' ('${request.appName}') — skipped`);
      return null;
    }
    const now = this.deps.now?.() ?? Date.now();
    const cached = this.cache.get(request.server.id);
    const fresh = cached && now - cached.fetchedAt < this.ttlMs;
    if (cached && fresh) {
      this.debug(`cache hit for '${request.appName}' (${this.rowCount(cached.text)} rows, ${Math.max(0, Math.round((now - cached.fetchedAt) / 1000))} s old)`);
      return renderAppDigest(request.appName, this.filtered(cached.text, request), undefined) ?? null;
    }
    const text = await this.refreshSingleFlight(request, provider);
    if (text) {
      this.debug(`refreshed for '${request.appName}' (${this.rowCount(text)} rows)`);
      return renderAppDigest(request.appName, this.filtered(text, request), undefined) ?? null;
    }
    if (cached) {
      const ageMinutes = Math.max(1, Math.round((now - cached.fetchedAt) / 60000));
      this.debug(`refresh failed — serving stale for '${request.appName}' (${ageMinutes} min old)`);
      return renderAppDigest(request.appName, this.filtered(cached.text, request), ageMinutes) ?? null;
    }
    this.debug(`fetch failed with no cache for '${request.appName}' — digest-less (D13)`);
    return null;
  }

  private debug(message: string): void {
    if (aiDebugEnabled()) {
      console.log(`[digest] ${message}`);
    }
  }

  private rowCount(text: string): number {
    return text.split('\n').filter(Boolean).length;
  }

  /**
   * The cache holds the RAW rendered rows (pre-scope-filter, newline
   * separated `id — label`) so a scope-rule edit re-filters without a
   * provider call; the filtered render happens per request (D10).
   */
  private filtered(rawText: string, request: DigestRequest): DigestRow[] {
    const rows: DigestRow[] = [];
    for (const line of rawText.split('\n')) {
      const separator = line.indexOf(' — ');
      const id = separator === -1 ? line : line.slice(0, separator);
      const label = separator === -1 ? id : line.slice(separator + 3);
      if (request.entityAllowed && !request.entityAllowed(id)) {
        continue;
      }
      rows.push({ id, label });
    }
    return rows;
  }

  private async refreshSingleFlight(request: DigestRequest, provider: DigestProvider): Promise<string | null> {
    const existing = this.inflight.get(request.server.id);
    if (existing) {
      return existing;
    }
    const task = this.refresh(request, provider).finally(() => {
      this.inflight.delete(request.server.id);
    });
    this.inflight.set(request.server.id, task);
    return task;
  }

  private async refresh(request: DigestRequest, provider: DigestProvider): Promise<string | null> {
    let payload: unknown;
    try {
      const tools = await this.deps.listTools(request.server);
      const toolName = findCandidateTool(tools.map((tool) => tool.name), provider.toolCandidates);
      if (!toolName) {
        this.debug(`no context tool found for '${request.appName}' (server has ${tools.length} tools, ${provider.toolCandidates.length} candidates)`);
        return null;
      }
      payload = await this.deps.invokeTool(request.server, toolName);
    } catch (error) {
      this.debug(`invoke failed for '${request.appName}': ${String((error as Error)?.message ?? error).slice(0, 200)}`);
      return null;
    }
    const rows = provider.render(payload);
    if (!rows || rows.length === 0) {
      this.debug(`payload parsed empty for '${request.appName}'`);
      return null;
    }
    // Output caps live solely in renderAppDigest; the cache holds every
    // raw row so scope edits (D10) re-filter without a provider call.
    const text = rows.map((row) => `${row.id} — ${row.label}`).join('\n');
    this.cache.set(request.server.id, { text, fetchedAt: this.deps.now?.() ?? Date.now() });
    return text;
  }
}

export function findCandidateTool(toolNames: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const exact = toolNames.find((name) => name === candidate);
    if (exact) {
      return exact;
    }
    const suffix = toolNames.find((name) => name.endsWith(`_${candidate}`) || name.endsWith(candidate));
    if (suffix) {
      return suffix;
    }
  }
  return null;
}
