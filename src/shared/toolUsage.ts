/** Tool-usage stats types (plan 12 §7) — read-only aggregates over the tool_calls audit. */
export interface ToolUsageRow {
  tool: string;
  total: number;
  ok: number;
  errors: number;
  denied: number;
  approvals: Record<string, number>;
  avgDurationMs: number;
  lastUsedAt: string;
}

export interface ToolUsageStats {
  windowDays: number | null;
  total: number;
  rows: ToolUsageRow[];
  recentFailures: { tool: string; outcome: string; approvedBy: string; at: string }[];
}

/** Per-app aggregates over the same audit — attribution via AppService (plan-15 polish). */
export interface AppUsageRow {
  app: string;
  total: number;
  ok: number;
  errors: number;
  denied: number;
  avgDurationMs: number;
  lastUsedAt: string;
}

export interface AppUsageStats {
  windowDays: number | null;
  total: number;
  rows: AppUsageRow[];
}
