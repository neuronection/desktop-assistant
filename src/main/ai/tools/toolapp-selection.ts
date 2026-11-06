import type { ToolAppSpec, ToolAppToolState } from '@shared/apps';
import type { SelectionApp, SelectionTool } from './app-selection';

/**
 * Plan 15 D6 bridge: maps enabled app specs + the assembled agent toolset
 * into the per-turn selection vocabulary. MCP-backed tools are attributed
 * by their namespaced prefix (`mcp__<server>__<tool>` — one server per
 * app, D11); native-group apps attribute registry tools by name
 * (grouping-only). Tools the registry reports with an `appId` (plan 15
 * attribution field) keep that attribution authoritative.
 */
export function buildSelectionApps(
  specs: ToolAppSpec[],
  agentTools: { name: string; description?: string }[],
  nativeAppIds: Map<string, string> = new Map()
): SelectionApp[] {
  const byNativeAppId = new Map<string, string[]>();
  for (const tool of agentTools) {
    const appId = nativeAppIds.get(tool.name);
    if (appId) {
      const list = byNativeAppId.get(appId) ?? [];
      list.push(tool.name);
      byNativeAppId.set(appId, list);
    }
  }
  return specs.map((spec, order) => {
    const tools: SelectionTool[] = [];
    const seen = new Set<string>();
    for (const source of spec.sources) {
      if (source.kind === 'mcp') {
        const prefix = `mcp__${source.server.name}__`;
        for (const tool of agentTools) {
          if (!tool.name.startsWith(prefix) || seen.has(tool.name)) {
            continue;
          }
          seen.add(tool.name);
          tools.push(selectionToolOf(tool.name, tool.description, spec.toolState));
        }
      } else {
        for (const name of source.tools) {
          if (seen.has(name) || !agentTools.some((tool) => tool.name === name)) {
            continue;
          }
          seen.add(name);
          tools.push(
            selectionToolOf(name, agentTools.find((tool) => tool.name === name)?.description, spec.toolState)
          );
        }
      }
    }
    for (const name of byNativeAppId.get(spec.id) ?? []) {
      if (!seen.has(name)) {
        seen.add(name);
        tools.push(
          selectionToolOf(name, agentTools.find((tool) => tool.name === name)?.description, spec.toolState)
        );
      }
    }
    return {
      id: spec.id,
      name: spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      exposure: spec.exposure,
      order,
      tools,
      ...(spec.skill ? { skill: spec.skill } : {}),
    };
  });
}

function selectionToolOf(
  name: string,
  description: string | undefined,
  toolState: Record<string, ToolAppToolState>
): SelectionTool {
  const raw = rawToolNameOf(name);
  const state = toolState[raw];
  return {
    name,
    description: description ?? '',
    enabled: state?.enabled !== false,
    keywordTags: state?.keywordTags ?? [],
    ...(state?.entityRole ? { entityRole: state.entityRole } : {}),
    ...(state?.entityArg ? { entityArg: state.entityArg } : {}),
  };
}

/** Namespaced (`mcp__<server>__<tool>`) → raw server-side tool name. */
export function rawToolNameOf(namespacedToolName: string): string {
  const first = namespacedToolName.indexOf('__');
  if (first === -1) {
    return namespacedToolName;
  }
  const second = namespacedToolName.indexOf('__', first + 2);
  return second === -1 ? namespacedToolName : namespacedToolName.slice(second + 2);
}

/** True when no enabled app attributes the tool (non-app tools are never filtered). */
export function isAppAttributed(toolName: string, apps: SelectionApp[]): boolean {
  return apps.some((app) => app.tools.some((tool) => tool.name === toolName));
}
