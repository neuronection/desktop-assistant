import type { ApprovalResolution, TurnInterruptPayload } from '@shared/turns';
import type { ToolApprovalSource } from '@main/ai/audit';
import { hashToolArgs } from '@main/ai/tools/registry';
import { recordToolCall } from '@main/ai/audit';
import { TIMING } from '@shared/constants/timing';
import type { TurnContext, TurnManagerDeps } from './TurnManager';

export const APPROVAL_TIMEOUT_MS = TIMING.APPROVAL_TIMEOUT_MS;

interface PendingApproval {
  requests: TurnInterruptPayload['requests'];
  resolve(resolution: ApprovalResolution): void;
}

export class ApprovalGate {
  private pending: PendingApproval | null = null;

  constructor(private readonly deps: Pick<TurnManagerDeps, 'policy' | 'tools'>) {}

  resolve(resolution: ApprovalResolution): boolean {
    const pending = this.pending;
    if (!pending) {
      return false;
    }
    this.pending = null;
    this.recordGrants(pending.requests, resolution);
    void this.recordRootGrants(pending.requests, resolution);
    pending.resolve(resolution);
    return true;
  }

  clear(): void {
    this.pending = null;
  }

  wait(
    requests: TurnInterruptPayload['requests'],
    cancelledPromise: Promise<void>
  ): Promise<ApprovalResolution | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (resolution: ApprovalResolution | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(denyTimer);
        this.pending = null;
        resolve(resolution);
      };
      const denyTimer = setTimeout(() => {
        finish({
          decisions: requests.map(() => ({ type: 'reject', message: 'Approval timed out (auto-denied).' })),
        });
      }, APPROVAL_TIMEOUT_MS);
      this.pending = { requests, resolve: finish };
      void cancelledPromise.then(() => finish(null));
    });
  }

  private async recordRootGrants(
    requests: TurnInterruptPayload['requests'],
    resolution: ApprovalResolution
  ): Promise<void> {
    const policy = this.deps.policy;
    const requestedRoots = this.deps.tools?.requestedRoots;
    if (!policy || !requestedRoots) {
      return;
    }
    for (const [index, decision] of resolution.decisions.entries()) {
      if (decision.type !== 'approve' && decision.type !== 'edit') {
        continue;
      }
      const request = requests[index];
      if (!request) {
        continue;
      }
      const toolName = decision.type === 'edit' ? decision.name : request.toolName;
      const args = decision.type === 'edit' ? decision.args : request.args;
      for (const root of (await requestedRoots(toolName, args)) ?? []) {
        if (resolution.grant === 'always') {
          void policy.grantRootAlways(root).catch((error) => {
            console.error(`Failed to persist root grant for '${root}':`, error);
          });
        } else {
          policy.grantRootSession(root);
        }
      }
    }
  }

  private recordGrants(
    requests: TurnInterruptPayload['requests'],
    resolution: ApprovalResolution
  ): void {
    if (!resolution.grant || !this.deps.policy) {
      return;
    }
    const approved = new Set(
      resolution.decisions
        .map((decision, index) => (decision.type === 'approve' || decision.type === 'edit' ? requests[index]?.toolName : undefined))
        .filter((name): name is string => Boolean(name))
    );
    for (const toolName of approved) {
      if (resolution.grant === 'session') {
        this.deps.policy.grantSession(toolName);
      } else if (resolution.grant === 'always') {
        void this.deps.policy.grantAlways(toolName).catch((error) => {
          console.error(`Failed to persist 'always' grant for '${toolName}':`, error);
        });
      }
    }
  }
}

export async function auditDenied(
  requests: TurnInterruptPayload['requests'],
  fallbackArgs: unknown,
  source: ToolApprovalSource,
  ctx: Pick<TurnContext, 'conversationId' | 'tempMessageId'>
): Promise<void> {
  for (const request of requests) {
    void recordToolCall({
      tool: request.toolName,
      argsHash: hashToolArgs(request.args ?? fallbackArgs),
      outcome: 'denied',
      durationMs: 0,
      approvedBy: source,
      conversationId: ctx.conversationId,
      messageId: ctx.tempMessageId,
    }).catch(() => undefined);
  }
}
