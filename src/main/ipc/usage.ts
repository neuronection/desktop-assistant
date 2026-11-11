import type { MainConfigService } from '@main/services/ConfigService';
import type { DatabaseService } from '@main/services/DatabaseService';
import { getUsageReport } from '@main/services/UsageService';
import { getEgressLog } from '@main/security/egress';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface UsageIpcDeps {
  configService: MainConfigService;
  databaseService: DatabaseService;
}

export function registerUsageIpc({ databaseService }: UsageIpcDeps): void {
  register(IPC['usage:turn'], async (_event, messageId: string) => {
    const client = databaseService.isReady() ? databaseService.getClient() : null;
    const destinations = getEgressLog().filter((entry) => entry.turnId === messageId);
    if (!client) {
      return { messageId, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: null, unpricedCalls: 0, models: [], tools: [], destinations };
    }
    const [calls, tools] = await Promise.all([
      client.aiCall.findMany({
        where: { messageId },
        select: { model: true, resolvedModel: true, providerId: true, inputTokens: true, outputTokens: true, costMicros: true },
      }),
      client.toolCall.findMany({
        where: { messageId },
        select: { tool: true, outcome: true, approvedBy: true, durationMs: true },
      }),
    ]);
    const models = new Map<string, { model: string; providerId: string | null; calls: number; inputTokens: number; outputTokens: number; costMicros: number | null }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let costMicros = 0;
    let unpricedCalls = 0;
    for (const call of calls) {
      const model = call.resolvedModel ?? call.model;
      const key = `${call.providerId ?? ''}:${model}`;
      const entry = models.get(key) ?? { model, providerId: call.providerId, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: null };
      entry.calls += 1;
      entry.inputTokens += call.inputTokens ?? 0;
      entry.outputTokens += call.outputTokens ?? 0;
      inputTokens += call.inputTokens ?? 0;
      outputTokens += call.outputTokens ?? 0;
      if (call.costMicros === null) {
        unpricedCalls += 1;
      } else {
        costMicros += call.costMicros;
        entry.costMicros = (entry.costMicros ?? 0) + call.costMicros;
      }
      models.set(key, entry);
    }
    return {
      messageId,
      calls: calls.length,
      inputTokens,
      outputTokens,
      costMicros: costMicros > 0 || unpricedCalls < calls.length ? costMicros : null,
      unpricedCalls,
      models: [...models.values()],
      tools,
      destinations,
    };
  });

  register(IPC['usage:report'], async () => {
    const client = databaseService.isReady() ? databaseService.getClient() : null;
    return getUsageReport(client);
  });
}
