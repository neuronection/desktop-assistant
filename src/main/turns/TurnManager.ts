import { randomUUID } from 'crypto';
import { AppConfig } from '@shared/config/AppConfig';
import { AiTask, LLMProvider, LLMProviderType, Model } from '@shared/types';
import { hasCap, modelTuning, resolveTaskModel } from '@shared/ai/tasks';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import { TIMING } from '@shared/constants/timing';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolution,
  DirectToolRequest,
  TurnEvent,
  TurnInterruptPayload,
  TurnMetadata,
  TurnStartRequest,
  ToolRiskClass,
} from '@shared/turns';
import type { AiGateway } from '@main/ai/gateway';
import type { AssistantRunner, AssistantTurnInput } from '@main/ai/graphs/assistant';
import { AGENT_LIMITS } from '@main/ai/graphs/assistant';
import type { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { ToolApprovalSource } from '@main/ai/audit';
import { hashToolArgs, truncateText } from '@main/ai/tools/registry';
import { recordToolCall } from '@main/ai/audit';
import { TurnEventLog } from './turnEvents';
import { extractStoredResult } from './tool-results';
import { getToolResultService } from '@main/services/ToolResultService';
import { toAiMessages } from './history';
import { TEXT, pluralize } from '@shared/constants/text';

const TRACE_STEP_CAP = 12;
const APPROVAL_TIMEOUT_MS = TIMING.APPROVAL_TIMEOUT_MS;
const DIRECT_RESULT_PERSIST_CAP = 4_000;

/** Native-tool host for slash-command direct invocation (no model call). */
export interface TurnManagerTools {
  riskFor(name: string): ToolRiskClass | undefined;
  summarizeFor(name: string, args: unknown): string;
  editableArgs(name: string): boolean;
  /** Roots (outside the granted set) this call would need — drives HITL access requests. */
  requestedRoots?(name: string, args: unknown): string[];
  executeDirect(
    name: string,
    args: unknown,
    ctx: { grantedRoots?: string[] }
  ): Promise<{ ok: boolean; text: string; images?: string[]; durationMs: number }>;
}

export function capTraceSteps(steps: TurnMetadata['steps']): TurnMetadata['steps'] {
  if (!steps) {
    return steps;
  }
  return steps
    .map((step) =>
      step.summary && step.summary.length > 160 ? { ...step, summary: `${step.summary.slice(0, 159)}…` } : step
    )
    .slice(0, TRACE_STEP_CAP);
}

export interface TurnManagerMessages {
  createMessage(
    content: string,
    role: MessageRole,
    conversationId: string,
    attachments?: unknown,
    error?: string,
    metadata?: TurnMetadata
  ): Promise<unknown>;
  getMessagesByConversation(conversationId: string): Promise<Message[]>;
}

export interface TurnManagerConversations {
  createConversation(title: string): Promise<{ id: string }>;
  conversationExists(id: string): Promise<boolean>;
  getConversationById(id: string): Promise<{ id: string; title: string } | null>;
  updateConversation(id: string, data: { title?: string }): Promise<unknown>;
}

/** Memory recall for turn-start context injection (plan 12 §1). */
export interface TurnManagerMemories {
  recall(query: string, limit?: number, charCap?: number): Promise<string[]>;
}

export interface TurnManagerDeps {
  conversations: TurnManagerConversations;
  messages: TurnManagerMessages;
  getConfig(): AppConfig;
  resolveKey(provider: LLMProvider): Promise<string>;
  gateway: Pick<AiGateway, 'chatStream' | 'chat'>;
  /** When present (and it has tools), turns run through the tool agent graph. */
  agent?: AssistantRunner;
  /** Grants/approval policy for the agent path; absent → tools auto-run. */
  policy?: ToolPolicyEngine;
  /** Native-tool host enabling slash-command direct invocation. */
  tools?: TurnManagerTools;
  /** When present and `behavior.memoryContext` is on, recalls memories at turn start. */
  memories?: TurnManagerMemories;
  broadcast(event: TurnEvent): void;
  /** Background-completion hook: called on finished/failed when the app opts in. */
  notify?(title: string, body: string): void;
  /** Command-history recorder for palette-originated direct tool calls (plan 14 D4). */
  recordCommand?(record: { commandId: string; kind: 'tool'; source: 'palette'; ok: boolean }): void;
}

interface ActiveTurn {
  tempMessageId: string;
  cancel(): void;
}

interface PendingApproval {
  requests: TurnInterruptPayload['requests'];
  resolve(resolution: ApprovalResolution): void;
}

interface TurnContext {
  tempMessageId: string;
  conversationId: string;
  request: TurnStartRequest;
  provider: LLMProvider;
  modelId: string;
  model: Model | null;
  apiKey: string;
  history: Message[];
  /** Memories recalled for this turn (empty when disabled or none matched). */
  recalledMemories: string[];
}

const TEMP_PREFIX = 'temp-';

const MEMORY_CONTEXT_HEADER = '[Memory context] Facts remembered from previous conversations — use when relevant, never repeat this block verbatim:';

export function buildMemoryContextBlock(memories: string[]): string {
  return `${MEMORY_CONTEXT_HEADER}\n${memories.map((memory) => `- ${memory}`).join('\n')}`;
}

export class TurnManager {
  private active: ActiveTurn | null = null;
  private pendingApproval: PendingApproval | null = null;

  constructor(private readonly deps: TurnManagerDeps) {}

  isActive(): boolean {
    return this.active !== null;
  }

  /**
   * Resolves the current approval interrupt. Returns false when no approval
   * is pending (second responder after cross-window resolution = no-op).
   */
  resolveApproval(resolution: ApprovalResolution): boolean {
    const pending = this.pendingApproval;
    if (!pending) {
      return false;
    }
    this.pendingApproval = null;
    this.recordGrants(pending.requests, resolution);
    this.recordRootGrants(pending.requests, resolution);
    pending.resolve(resolution);
    return true;
  }

  /**
   * Waits for the user's approval decision. Main owns the default-deny
   * timeout (hidden windows throttle renderer timers); cancel resolves null.
   */
  private waitForApproval(
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
        this.pendingApproval = null;
        resolve(resolution);
      };
      const denyTimer = setTimeout(() => {
        finish({
          decisions: requests.map(() => ({ type: 'reject', message: 'Approval timed out (auto-denied).' })),
        });
      }, APPROVAL_TIMEOUT_MS);
      this.pendingApproval = { requests, resolve: finish };
      void cancelledPromise.then(() => finish(null));
    });
  }

  /**
   * HITL access requests: an approved call whose path lies outside the
   * granted roots adds the derived root. 'once' and 'session' grant for
   * the session; 'always' persists into the user's granted roots.
   * Must run BEFORE the resume so the retried call sees the new root.
   */
  private recordRootGrants(
    requests: TurnInterruptPayload['requests'],
    resolution: ApprovalResolution
  ): void {
    const policy = this.deps.policy;
    const requestedRoots = this.deps.tools?.requestedRoots;
    if (!policy || !requestedRoots) {
      return;
    }
    resolution.decisions.forEach((decision, index) => {
      if (decision.type !== 'approve' && decision.type !== 'edit') {
        return;
      }
      const request = requests[index];
      if (!request) {
        return;
      }
      const toolName = decision.type === 'edit' ? decision.name : request.toolName;
      const args = decision.type === 'edit' ? decision.args : request.args;
      for (const root of requestedRoots(toolName, args)) {
        if (resolution.grant === 'always') {
          void policy.grantRootAlways(root).catch((error) => {
            console.error(`Failed to persist root grant for '${root}':`, error);
          });
        } else {
          policy.grantRootSession(root);
        }
      }
    });
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

  async start(request: TurnStartRequest): Promise<string> {
    if (this.active) {
      throw new Error('A turn is already in progress.');
    }
    let provider: LLMProvider | null = null;
    let model: Model | null = null;
    let apiKey = '';
    if (!request.directTool) {
      const resolution = resolveTaskModel(this.deps.getConfig(), AiTask.CHAT, request.modelId ?? null);
      if (!resolution) {
        throw new Error('No model is assigned to the chat task. Pick one in Settings → Models.');
      }
      provider = resolution.provider;
      model = resolution.model;
      apiKey = await this.deps.resolveKey(provider);
      if (!apiKey && provider.type !== LLMProviderType.OLLAMA) {
        throw new Error(`API key for provider '${provider.name}' is not set.`);
      }
    }

    const conversationId = await this.ensureConversation(request);
    await this.deps.messages.createMessage(request.content, MessageRole.USER, conversationId, request.attachments);

    const tempMessageId = `turn_${randomUUID()}`;
    const history = await this.deps.messages.getMessagesByConversation(conversationId);

    if (request.directTool) {
      void this.runToolOnlyTurn(
        {
          tempMessageId,
          conversationId,
          request,
          provider: provider as LLMProvider,
          modelId: request.modelId ?? '',
          model,
          apiKey,
          history,
          recalledMemories: [],
        },
        request.directTool
      );
      return tempMessageId;
    }

    const recalledMemories = await this.recallMemories(request.content);
    void this.runTurn({
      tempMessageId,
      conversationId,
      request,
      provider: provider as LLMProvider,
      modelId: model?.id ?? request.modelId ?? '',
      model,
      apiKey,
      history,
      recalledMemories,
    });
    return tempMessageId;
  }

  cancel(): boolean {
    if (!this.active) {
      return false;
    }
    this.active.cancel();
    return true;
  }

  private async ensureConversation(request: TurnStartRequest): Promise<string> {
    const id = request.conversationId;
    if (!id.startsWith(TEMP_PREFIX) && (await this.deps.conversations.conversationExists(id))) {
      return id;
    }
    const title = request.content.substring(0, 40) + (request.content.length > 40 ? '...' : '');
    const created = await this.deps.conversations.createConversation(title);
    return created.id;
  }

  /** Fail-soft: a memory hiccup must never kill the turn. */
  private async recallMemories(query: string): Promise<string[]> {
    if (!this.deps.memories || this.deps.getConfig().behavior?.memoryContext === false) {
      return [];
    }
    try {
      return await this.deps.memories.recall(query);
    } catch (error) {
      console.error('Memory recall failed:', error);
      return [];
    }
  }

  private historyWithMemory(ctx: TurnContext): Message[] {
    if (ctx.recalledMemories.length === 0) {
      return ctx.history;
    }
    const synthetic: Message = {
      id: `memory_${ctx.tempMessageId}`,
      content: buildMemoryContextBlock(ctx.recalledMemories),
      role: MessageRole.SYSTEM,
      conversationId: ctx.conversationId,
      createdAt: new Date(),
      attachments: [],
    };
    return [synthetic, ...ctx.history];
  }

  /** Recallable-screenshot index for the agent system prompt (newest first). */
  private async buildRecallIndex(ctx: TurnContext): Promise<string[]> {
    try {
      const recent = await getToolResultService().listForConversation(ctx.conversationId);
      return recent.map((entry) => {
        const time = entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${entry.tool} — ${entry.id} — ${time}`;
      });
    } catch {
      return [];
    }
  }

  private logMemoryMarker(log: TurnEventLog, ctx: TurnContext): void {
    if (ctx.recalledMemories.length === 0) {
      return;
    }
    const count = ctx.recalledMemories.length;
    const step = log.beginStep({
      id: `memory_marker_${ctx.tempMessageId}`,
      phase: 'thinking',
      label: TEXT.MEMORY_RECALL_LABEL,
      summary: `${count} ${pluralize(count, TEXT.MEMORY_ONE, TEXT.MEMORY_MANY)} ${TEXT.MEMORY_RECALLED}`,
    });
    log.endStep(step.id);
  }

  private async runTurn(ctx: TurnContext): Promise<void> {
    const agent = this.deps.agent;
    if (agent && (!ctx.model || hasCap(ctx.model, 'tools')) && (await agent.getToolCount()) > 0) {
      return this.runAgentTurn(ctx, agent);
    }
    return this.runStreamTurn(ctx);
  }

  private async runAgentTurn(ctx: TurnContext, agent: AssistantRunner): Promise<void> {
    const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event));
    let cancelled = false;
    let timedOut = false;
    let releaseCancel: () => void = () => {};
    const cancelledPromise = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const controller = new AbortController();
    this.active = {
      tempMessageId: ctx.tempMessageId,
      cancel: () => {
        cancelled = true;
        releaseCancel();
        controller.abort();
      },
    };

    const startedAt = Date.now();
    log.phase('queued');
    this.logMemoryMarker(log, ctx);
    const wallClock = setTimeout(() => {
      timedOut = true;
      releaseCancel();
      controller.abort();
    }, AGENT_LIMITS.wallClockMs);

    let fullContent = '';
    let failed: Error | null = null;
    const toolStepIds = new Map<string, string>();
    const openToolSteps = new Set<string>();
    const nodeStepIds = new Map<string, string>();
    const nodeCounts = new Map<string, number>();
    const approvalMeta = new Map<
      string,
      { name: string; argsHash: string; source: ToolApprovalSource; server?: string }
    >();
    let toolCallCount = 0;
    let toolsWindowNode: string | null = null;

    let recallIndex: string[] = [];
    if (this.deps.tools?.riskFor('recall_screenshot') !== undefined) {
      recallIndex = await this.buildRecallIndex(ctx);
    }

    const agentInput: AssistantTurnInput = {
      provider: ctx.provider,
      modelId: ctx.modelId,
      apiKey: ctx.apiKey,
      overrides: ctx.model ? modelTuning(ctx.provider, ctx.model) : undefined,
      history: toAiMessages(this.historyWithMemory(ctx)),
      threadId: `${ctx.conversationId}:${ctx.tempMessageId}`,
      signal: controller.signal,
      recallIndex,
    };

    let iterator = agent.run(agentInput)[Symbol.asyncIterator]();

    const auditDecisionDenials = (
      requests: TurnInterruptPayload['requests'],
      decisions: ApprovalResolution['decisions'],
      source: ToolApprovalSource
    ): void => {
      decisions.forEach((decision, index) => {
        if (decision.type !== 'reject') {
          return;
        }
        const request = requests[index];
        if (!request) {
          return;
        }
        void recordToolCall({
          tool: request.toolName,
          argsHash: hashToolArgs(request.args),
          outcome: 'denied',
          durationMs: 0,
          approvedBy: source,
          conversationId: ctx.conversationId,
          messageId: ctx.tempMessageId,
        }).catch(() => undefined);
      });
    };

    try {
      while (true) {
        const next = await Promise.race([iterator.next(), cancelledPromise.then(() => 'cancelled' as const)]);
        if (next === 'cancelled' || next.done) {
          break;
        }
        const event = next.value;
        if (event.type === 'delta') {
          log.phase('streaming', { delta: event.text });
          fullContent += event.text;
        } else if (event.type === 'node_started') {
          if (openToolSteps.size > 0) {
            toolsWindowNode = event.node;
          } else {
            const count = (nodeCounts.get(event.node) ?? 0) + 1;
            nodeCounts.set(event.node, count);
            const step = log.beginStep(
              {
                id: `node_${event.node}_${count}`,
                phase: 'thinking',
                label: event.label,
                node: event.node,
                ...(event.resumed ? { resumed: true } : {}),
              },
              Date.now(),
              { node: { node: event.node, label: event.label, resumed: event.resumed } }
            );
            nodeStepIds.set(event.node, step.id);
          }
        } else if (event.type === 'node_finished') {
          if (toolsWindowNode === event.node) {
            toolsWindowNode = null;
          } else {
            const stepId = nodeStepIds.get(event.node);
            nodeStepIds.delete(event.node);
            const snapshot = stepId ? log.endStep(stepId) : null;
            log.phase('thinking', {
              node: {
                node: event.node,
                label: event.label,
                outcome: event.outcome,
                durationMs: event.durationMs,
                resumed: event.resumed,
              },
              step: snapshot ?? undefined,
            });
          }
        } else if (event.type === 'tool_calls') {
          for (const call of event.calls) {
            toolCallCount += 1;
            const source =
              this.deps.policy && call.risk !== 'read-only'
                ? this.deps.policy.grantSource(call.name, call.risk, call.args)
                : 'auto';
            approvalMeta.set(call.id, {
              name: call.name,
              argsHash: hashToolArgs(call.args),
              source,
              server: call.server,
            });
            const step = log.beginStep({
              id: `tool_${call.id}`,
              phase: 'tool_call',
              label: call.name,
              toolName: call.name,
              summary: call.summary,
              detail: call.args,
            });
            toolStepIds.set(call.id, step.id);
            openToolSteps.add(call.id);
          }
        } else if (event.type === 'tool_results') {
          for (const result of event.results) {
            const stepId = toolStepIds.get(result.id);
            const meta = approvalMeta.get(result.id);
            let durationMs = 0;
            const stored = extractStoredResult(result.content);
            if (stepId) {
              void getToolResultService()
                .store({
                  callId: stepId,
                  conversationId: ctx.conversationId,
                  messageId: ctx.tempMessageId,
                  tool: meta?.name ?? 'unknown',
                  status: result.isError ? 'error' : 'ok',
                  text: stored.text,
                  images: stored.images,
                })
                .catch(() => undefined);
              const snapshot = log.endStep(stepId, Date.now(), {
                summary: result.isError ? `Failed: ${result.summary}` : result.summary,
                status: result.isError ? 'error' : 'ok',
                response: result.summary,
                hasImages: stored.images.length > 0,
                ...(toolsWindowNode ? { node: toolsWindowNode } : {}),
              });
              openToolSteps.delete(result.id);
              if (snapshot) {
                log.phase('tool_result', { step: snapshot });
                durationMs = Math.max(0, (snapshot.endedAt ?? 0) - snapshot.startedAt);
              }
            }
            void recordToolCall({
              tool: meta?.name ?? 'unknown',
              argsHash: meta?.argsHash ?? hashToolArgs(undefined),
              outcome: result.isError ? 'error' : 'ok',
              durationMs,
              approvedBy: meta?.source ?? 'auto',
              conversationId: ctx.conversationId,
              messageId: ctx.tempMessageId,
              mcpServer: meta?.server ?? null,
            }).catch(() => undefined);
          }
        } else if (event.type === 'interrupt') {
          const payload: TurnInterruptPayload = {
            requests: event.requests,
            deadline: Date.now() + APPROVAL_TIMEOUT_MS,
          };
          log.phase('interrupt', { interrupt: payload });
          this.notify(
            'Approval needed',
            `The assistant wants to run '${event.requests[0]?.toolName ?? 'a tool'}'.`
          );
          const resolution = await this.waitForApproval(event.requests, cancelledPromise);
          if (resolution === null) {
            auditDecisionDenials(
              event.requests,
              event.requests.map(() => ({ type: 'reject' as const })),
              'denied'
            );
            break;
          }
          const timedOutDenial = resolution.decisions.every((decision) => decision.type === 'reject');
          auditDecisionDenials(event.requests, resolution.decisions, timedOutDenial ? 'timeout' : 'denied');
          iterator = agent
            .run({ ...agentInput, resume: resolution.decisions })
            [Symbol.asyncIterator]();
        } else if (event.type === 'final') {
          if (event.text) {
            fullContent = event.text;
          }
        }
      }
    } catch (error) {
      failed = error as Error;
    } finally {
      clearTimeout(wallClock);
      this.active = null;
      this.pendingApproval = null;
      if (cancelled) {
        void iterator.return?.(undefined);
      } else {
        await iterator.return?.(undefined);
      }
    }

    const durationMs = Date.now() - startedAt;
    const steps = capTraceSteps(log.allSteps());
    const failure = timedOut
      ? new Error(`Turn exceeded the ${Math.round(AGENT_LIMITS.wallClockMs / 1000)}s time budget.`)
      : failed;

    if (failure) {
      await this.persist(ctx, {
        content: fullContent || 'An error occurred.',
        error: failure.message,
        metadata: { outcome: 'failed', model: ctx.modelId, durationMs, steps, toolCount: toolCallCount },
      });
      log.phase('failed', { error: failure.message });
      this.notify('Turn failed', failure.message);
      return;
    }

    if (cancelled) {
      await this.persist(ctx, {
        content: fullContent,
        metadata: { outcome: 'cancelled', model: ctx.modelId, durationMs, steps, toolCount: toolCallCount },
      });
      log.phase('cancelled', { steps, durationMs });
      return;
    }

    await this.persist(ctx, {
      content: fullContent,
      metadata: { outcome: 'ok', model: ctx.modelId, durationMs, steps, toolCount: toolCallCount },
    });
    log.phase('finished', { steps, model: ctx.modelId, durationMs });
    this.notify('Turn complete', fullContent.slice(0, 120) || 'Your response is ready.');
    void this.generateTitleIfNeeded(ctx, fullContent);
  }

  /**
   * Slash-command direct tool invocation: same policy path and approval
   * machinery as the agent, no model call. Rides the turn envelope so
   * both windows see it.
   */
  private async runToolOnlyTurn(ctx: TurnContext, requested: DirectToolRequest): Promise<void> {
    const tools = this.deps.tools;
    const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event));
    let cancelled = false;
    let releaseCancel: () => void = () => {};
    const cancelledPromise = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    this.active = {
      tempMessageId: ctx.tempMessageId,
      cancel: () => {
        cancelled = true;
        releaseCancel();
      },
    };
    const startedAt = Date.now();
    log.phase('queued');

    const finalizeFailed = async (message: string): Promise<void> => {
      await this.persist(ctx, {
        content: 'An error occurred.',
        error: message,
        metadata: { outcome: 'failed', durationMs: Date.now() - startedAt, steps: capTraceSteps(log.allSteps()), toolCount: 1 },
      });
      log.phase('failed', { error: message });
      this.notify('Turn failed', message);
    };
    const finalizeCancelled = async (): Promise<void> => {
      await this.persist(ctx, {
        content: '',
        metadata: { outcome: 'cancelled', durationMs: Date.now() - startedAt, steps: capTraceSteps(log.allSteps()), toolCount: 1 },
      });
      log.phase('cancelled', { steps: capTraceSteps(log.allSteps()), durationMs: Date.now() - startedAt });
    };

    try {
      const risk = tools?.riskFor(requested.name);
      if (!tools || risk === undefined) {
        await finalizeFailed(`Unknown tool '${requested.name}'.`);
        return;
      }
      if (this.deps.policy?.isDisabled(requested.name)) {
        await finalizeFailed(`'${requested.name}' is disabled. Re-enable it in Settings → Tools.`);
        return;
      }

      const summary = tools.summarizeFor(requested.name, requested.args);
      const step = log.beginStep({
        id: `tool_direct_${ctx.tempMessageId}`,
        phase: 'tool_call',
        label: requested.name,
        toolName: requested.name,
        summary,
        detail: requested.args,
      });

      let effective: DirectToolRequest = requested;
      let denied = false;
      let denialSource: ToolApprovalSource = 'denied';
      const needsAccess = (tools.requestedRoots?.(requested.name, requested.args) ?? []).length > 0;
      const needsApproval =
        (this.deps.policy?.decision(requested.name, risk, requested.args) ?? 'run') === 'approve';
      if (needsApproval || needsAccess) {
        const requests: ApprovalRequest[] = [
          {
            id: 'appr_0',
            toolName: requested.name,
            args: requested.args,
            summary,
            risk,
            allowedDecisions: tools.editableArgs(requested.name)
              ? ['approve', 'edit', 'reject']
              : ['approve', 'reject'],
          },
        ];
        const payload: TurnInterruptPayload = { requests, deadline: Date.now() + APPROVAL_TIMEOUT_MS };
        log.phase('interrupt', { interrupt: payload });
        this.notify('Approval needed', `Approval needed to run '${requested.name}'.`);
        const resolution = await this.waitForApproval(requests, cancelledPromise);
        if (resolution === null) {
          await this.auditDenied(requests, requested.args, 'denied', ctx);
          this.active = null;
          await finalizeCancelled();
          return;
        }
        const rejects = resolution.decisions.filter(
          (decision): decision is Extract<ApprovalDecision, { type: 'reject' }> => decision.type === 'reject'
        );
        denied = rejects.length > 0;
        denialSource = rejects.some((reject) => reject.message?.includes('timed out')) ? 'timeout' : 'denied';
        if (!denied) {
          for (const decision of resolution.decisions) {
            if (decision.type === 'edit') {
              effective = { name: decision.name, args: decision.args as Record<string, unknown> };
            }
          }
        }
      }

      const outcome = denied
        ? { ok: false, text: 'The request was denied.', durationMs: 0 }
        : await tools.executeDirect(effective.name, effective.args, {
            grantedRoots: this.deps.policy?.grantedRoots() ?? [],
          });

      const source: ToolApprovalSource = denied
        ? denialSource
        : this.deps.policy && risk !== 'read-only'
          ? this.deps.policy.grantSource(requested.name, risk, requested.args)
          : 'auto';
      void recordToolCall({
        tool: requested.name,
        argsHash: hashToolArgs(requested.args),
        outcome: denied ? 'denied' : outcome.ok ? 'ok' : 'error',
        durationMs: outcome.durationMs,
        approvedBy: source,
        conversationId: ctx.conversationId,
        messageId: ctx.tempMessageId,
      }).catch(() => undefined);
      if (requested.commandId && !denied) {
        this.deps.recordCommand?.({
          commandId: requested.commandId,
          kind: 'tool',
          source: 'palette',
          ok: outcome.ok,
        });
      }

      const closed = log.endStep(step.id, Date.now(), {
        summary: outcome.ok ? truncateText(outcome.text, 160) : `Failed: ${truncateText(outcome.text, 150)}`,
        status: outcome.ok ? 'ok' : 'error',
        response: outcome.text,
        hasImages: (outcome.images?.length ?? 0) > 0,
      });
      if (!denied) {
        void getToolResultService()
          .store({
            callId: step.id,
            conversationId: ctx.conversationId,
            messageId: ctx.tempMessageId,
            tool: requested.name,
            status: outcome.ok ? 'ok' : 'error',
            text: outcome.text,
            images: outcome.images ?? [],
          })
          .catch(() => undefined);
      }
      if (closed) {
        log.phase('tool_result', { step: closed });
      }

      if (cancelled) {
        this.active = null;
        await finalizeCancelled();
        return;
      }

      const durationMs = Date.now() - startedAt;
      const steps = capTraceSteps(log.allSteps());
      if (denied) {
        await this.persist(ctx, {
          content: 'The request was denied.',
          metadata: { outcome: 'ok', durationMs, steps, toolCount: 1 },
        });
        log.phase('finished', { steps, durationMs });
        return;
      }
      if (!outcome.ok) {
        await this.persist(ctx, {
          content: 'An error occurred.',
          error: outcome.text,
          metadata: { outcome: 'failed', durationMs, steps, toolCount: 1 },
        });
        log.phase('failed', { error: outcome.text });
        this.notify('Turn failed', truncateText(outcome.text, 120));
        return;
      }
      await this.persist(ctx, {
        content: truncateText(outcome.text, DIRECT_RESULT_PERSIST_CAP),
        metadata: { outcome: 'ok', durationMs, steps, toolCount: 1 },
      });
      log.phase('finished', { steps, durationMs });
      this.notify('Done', truncateText(outcome.text, 120) || 'Done.');
    } finally {
      this.active = null;
      this.pendingApproval = null;
    }
  }

  private async auditDenied(
    requests: TurnInterruptPayload['requests'],
    fallbackArgs: unknown,
    source: ToolApprovalSource,
    ctx: TurnContext
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

  private async runStreamTurn(ctx: TurnContext): Promise<void> {
    const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event));
    let cancelled = false;
    let releaseCancel: () => void = () => {};
    const cancelledPromise = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    this.active = {
      tempMessageId: ctx.tempMessageId,
      cancel: () => {
        cancelled = true;
        releaseCancel();
      },
    };

    const startedAt = Date.now();
    log.phase('queued');
    this.logMemoryMarker(log, ctx);
    const thinking = log.beginStep({ id: `think_${ctx.tempMessageId}`, phase: 'thinking', label: 'Thinking' });

    let fullContent = '';
    let firstDelta = true;
    let failed: Error | null = null;

    const stream = this.deps.gateway.chatStream({
      provider: ctx.provider,
      modelId: ctx.modelId,
      apiKey: ctx.apiKey,
      messages: toAiMessages(this.historyWithMemory(ctx)),
      task: 'chat',
      overrides: ctx.model ? modelTuning(ctx.provider, ctx.model) : undefined,
    })[Symbol.asyncIterator]();

    try {
      while (true) {
        const next = await Promise.race([stream.next(), cancelledPromise.then(() => 'cancelled' as const)]);
        if (next === 'cancelled' || next.done) {
          break;
        }
        if (firstDelta) {
          firstDelta = false;
          const closed = log.endStep(thinking.id);
          log.phase('streaming', { delta: next.value, step: closed ?? undefined });
        } else {
          log.phase('streaming', { delta: next.value });
        }
        fullContent += next.value;
      }
    } catch (error) {
      failed = error as Error;
    } finally {
      this.active = null;
      if (cancelled) {
        void stream.return?.(undefined);
      } else {
        await stream.return?.(undefined);
      }
    }

    const durationMs = Date.now() - startedAt;
    const steps = log.allSteps();

    if (failed) {
      await this.persist(ctx, {
        content: fullContent || 'An error occurred.',
        error: failed.message,
        metadata: { outcome: 'failed', model: ctx.modelId, durationMs, steps },
      });
      log.phase('failed', { error: failed.message });
      this.notify('Turn failed', failed.message);
      return;
    }

    if (cancelled) {
      await this.persist(ctx, {
        content: fullContent,
        metadata: { outcome: 'cancelled', model: ctx.modelId, durationMs, steps },
      });
      log.phase('cancelled', { steps, durationMs });
      return;
    }

    await this.persist(ctx, {
      content: fullContent,
      metadata: { outcome: 'ok', model: ctx.modelId, durationMs, steps },
    });
    log.phase('finished', { steps, model: ctx.modelId, durationMs });
    this.notify('Turn complete', fullContent.slice(0, 120) || 'Your response is ready.');
    void this.generateTitleIfNeeded(ctx, fullContent);
  }

  private async generateTitleIfNeeded(ctx: TurnContext, assistantContent: string): Promise<void> {
    try {
      const config = this.deps.getConfig();
      const resolution = resolveTaskModel(config, AiTask.TITLES, null);
      if (!resolution) {
        return;
      }
      const conversation = await this.deps.conversations.getConversationById(ctx.conversationId);
      if (!conversation) {
        return;
      }
      const autoTitle = ctx.request.content.substring(0, 40) + (ctx.request.content.length > 40 ? '...' : '');
      if (conversation.title !== autoTitle) {
        return;
      }
      const apiKey = await this.deps.resolveKey(resolution.provider);
      if (!apiKey && resolution.provider.type !== LLMProviderType.OLLAMA) {
        return;
      }
      const raw = await this.deps.gateway.chat({
        provider: resolution.provider,
        modelId: resolution.modelId,
        apiKey,
        task: AiTask.TITLES,
        overrides: modelTuning(resolution.provider, resolution.model),
        messages: [
          {
            role: 'system',
            content: 'Generate a concise conversation title (3-6 words) for the exchange. Reply with the title only, no quotes, no punctuation at the end.',
          },
          {
            role: 'user',
            content: `User: ${ctx.request.content.slice(0, 500)}\n\nAssistant: ${assistantContent.slice(0, 500)}`,
          },
        ],
      });
      const clean = raw
        .split('\n')[0]
        .replace(/^["'\s]+/, '')
        .replace(/["'\s.]+$/, '')
        .slice(0, 80)
        .trim();
      if (clean) {
        await this.deps.conversations.updateConversation(ctx.conversationId, { title: clean });
      }
    } catch (error) {
      console.error('Title generation failed:', error);
    }
  }

  private notify(title: string, body: string): void {
    try {
      if (this.deps.notify) {
        this.deps.notify(title, body);
      }
    } catch (error) {
      console.error('Turn notification failed:', error);
    }
  }

  private async persist(
    ctx: { conversationId: string },
    data: { content: string; error?: string; metadata: TurnMetadata }
  ): Promise<void> {
    if (!data.content && !data.error) {
      return;
    }
    const metadata: TurnMetadata = { ...data.metadata, steps: capTraceSteps(data.metadata.steps) };
    try {
      await this.deps.messages.createMessage(
        data.content,
        MessageRole.ASSISTANT,
        ctx.conversationId,
        undefined,
        data.error,
        metadata
      );
    } catch (error) {
      console.error('Failed to persist assistant message:', error);
    }
  }
}
