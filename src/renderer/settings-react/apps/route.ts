/**
 * In-window detail routes for the Integrations tab (plan 49 phase 1).
 * The union is the extensible seam: phase 2 adds MCP-app and sources
 * pages, later tabs adopt the same shape at the SettingsApp level.
 */
export type SettingsDetailRoute =
  | { kind: 'pack-config'; packId: string }
  | { kind: 'pack-runs'; packId: string }
  | { kind: 'app-detail'; appId: string }
  | { kind: 'sources' };
