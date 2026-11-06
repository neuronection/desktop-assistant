import type { AppInstanceStatus } from './schema/vocab';

export type { AppInstanceStatus };

export type AppInstanceCondition = 'needs-config' | 'needs-secret';

export interface AppInstanceStatusView {
  status: AppInstanceStatus;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  conditions: AppInstanceCondition[];
}

export type AppInstanceKind = 'tool' | 'mcp' | 'pack';

export function statusFromMcpState(state: 'disconnected' | 'connecting' | 'connected' | 'error'): AppInstanceStatus {
  switch (state) {
    case 'connected':
      return 'ok';
    case 'connecting':
      return 'degraded';
    case 'error':
      return 'failing';
    default:
      return 'stale';
  }
}

export function deriveInstanceConditions(input: {
  configError?: string | null;
  statusError?: string | null;
}): AppInstanceCondition[] {
  const conditions: AppInstanceCondition[] = [];
  if (input.configError) {
    conditions.push('needs-config');
  }
  if (input.statusError && /secret|key|token|auth|unauthor|credential/i.test(input.statusError)) {
    conditions.push('needs-secret');
  }
  return conditions;
}

export function emptyInstanceStatus(status: AppInstanceStatus = 'ok'): AppInstanceStatusView {
  return {
    status,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastError: null,
    conditions: [],
  };
}
