import { randomUUID } from 'crypto';
import { AppConfig } from '@shared/config/AppConfig';
import { AiTask, LLMProvider, LLMProviderType, Model, ConversationMetadata } from '@shared/types';
import { hasCap, modelTuning, resolveTaskModel, findModel } from '@shared/ai/tasks';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolution,
  DirectToolRequest,
  TurnEvent,
  TurnInterruptPayload,
  TurnLimitKind,
  TurnMetadata,
  TurnNodeRunSummary,
  TurnStartRequest,
  TurnStartResult,
  TurnTraceStep,
  ToolRiskClass,
} from '@shared/turns';
import type { AiGateway } from '@main/ai/gateway';
import type { AssistantRunner, AssistantTurnInput } from '@main/ai/graphs/assistant';
import { AGENT_LIMITS, limitKindOf, staticLimitText } from '@main/ai/graphs/assistant';
import type { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { ToolApprovalSource } from '@main/ai/audit';
import { hashToolArgs, truncateText } from '@main/ai/tools/registry';
import { recordToolCall, recordGraphNodeRun } from '@main/ai/audit';
import { downloads } from '@main/ai/tools/downloads';
import { DOWNLOAD_TOOL_NAME } from '@main/ai/tools/native/download-file';
import { TurnEventLog } from './turnEvents';
import { extractStoredResult } from './tool-results';
import { extractArtifactMarker, type FileArtifact } from '@shared/artifacts';
import { getToolResultService } from '@main/services/ToolResultService';
import type { AIMessage } from '@shared/types';
import type { DecisionQuestion, DecisionRuleFire, DecisionToolSchema } from '@shared/ai/decisions';
import type { DecisionStatus } from '@main/ai/decide';
import { runDecisionBatch } from '@shared/ai/decision-points';
import {
  runToolDispatchPoint,
  TOOL_DISPATCH_POINT,
  type ToolDispatchVerdict,
  type DispatchSpeak,
} from '@main/ai/decide/points/tool-dispatch';
import { runSpeakIntentPoint } from '@main/ai/decide/points/speak-intent';
import { SPEAK_OVERRIDE_BLOCK } from '@shared/ai/speak-intent';
import { TEXT, interpolate } from '@shared/constants/text';
import { APPROVAL_TIMEOUT_MS, ApprovalGate, auditDenied } from './approvalGate';
import { generateTitleIfNeeded } from './titles';
import {
  buildMemoryContextBlock,
  buildRecallIndex,
  fittedHistory as shapeFittedHistory,
  logMemoryMarker as markRecalledMemory,
  recallMemories as recallForTurn,
  withMemoryContext as addMemoryContext,
} from './recall';
import { capTraceSteps, persistTurn } from './persist';
import { applyDecisionRule as applyTurnDecisionRule, notifyTurn } from './notify';
import { branchThreadKey, regenerateThreadKey } from './branchThreads';

const DIRECT_RESULT_PERSIST_CAP = 4_000;
/** Grace window for the one wall-clock salvage attempt (plan 17 D3). */
const SALVAGE_GRACE_MS = 15_000;

/** Native-tool host for slash-command direct invocation (no model call). */
export interface TurnManagerTools {
  riskFor(name: string): ToolRiskClass | undefined | Promise<ToolRiskClass | undefined>;
  summarizeFor(name: string, args: unknown): string | Promise<string>;
  editableArgs(name: string): boolean | Promise<boolean>;
  /** Roots (outside the granted set) this call would need — drives HITL access requests. */
  requestedRoots?(name: string, args: unknown): string[] | Promise<string[]>;
  executeDirect(
    name: string,
    args: unknown,
    ctx: { grantedRoots?: string[] }
  ): Promise<{ ok: boolean; text: string; images?: string[]; durationMs: number }>;
}

export { capTraceSteps } from './persist';
export { buildMemoryContextBlock } from './recall';

export interface TurnManagerMessages {
  createMessage(
    content: string,
    role: MessageRole,
    conversationId: string,
    attachments?: unknown,
    error?: string,
    metadata?: TurnMetadata,
    options?: { parentId?: string | null; activate?: boolean | 'if-tip' | 'always' }
  ): Promise<unknown>;
  getMessagesByConversation(conversationId: string): Promise<Message[]>;
  getMessageTree?(conversationId: string): Promise<{ activeRootId: string | null; nodes: Message[] }>;
}

export interface TurnManagerConversations {
  createConversation(title: string): Promise<{ id: string }>;
  conversationExists(id: string): Promise<boolean>;
  getConversationById?(id: string): Promise<{ id: string; title: string; metadata?: ConversationMetadata } | null>;
  updateConversation(id: string, data: { title?: string }): Promise<unknown>;
  /** Persist a decision-rule tag on the conversation (plan 24 S7). */
  setConversationMetadata?(id: string, metadata: ConversationMetadata): Promise<unknown>;
}

/** Memory recall for turn-start context injection (plan 12 §1). */
export interface TurnManagerMemories {
  recall(query: string, limit?: number, charCap?: number): Promise<string[]>;
}

/** Decision-engine seam (plan 20 S3): tool surface + audited funnel call. */
export interface TurnManagerDecision {
  tools(): DecisionToolSchema[] | Promise<DecisionToolSchema[]>;
  run(input: string, tools: DecisionToolSchema[]): Promise<DecisionStatus>;
}

/** Typed-question engine seam (plan 24 S5): no tool dispatch, just answers. */
export interface TurnManagerDecisionQuestions {
  run(input: string, questions: DecisionQuestion[]): Promise<DecisionStatus>;
}

export type DecisionProvenance = NonNullable<TurnMetadata['decision']> & { reasoning?: string };

interface TurnDecisionDispatch {
  direct: DirectToolRequest;
  decision: DecisionProvenance;
  rule?: DecisionRuleFire;
}

/** A decision attempt that ran but handed the turn back to chat (D4). */
interface TurnDecisionFallThrough {
  fallThrough: {
    decision: DecisionProvenance;
    reason: string;
    calls?: number;
  };
}

/** A route-tool pick (plan 20 S7 D12): hand off to a normal turn pinned to a model. */
interface TurnDecisionRoute {
  route: {
    modelId: string;
    decision: DecisionProvenance;
  };
}

export interface TurnManagerDeps {
  conversations: TurnManagerConversations;
  messages: TurnManagerMessages;
  getConfig(): AppConfig;
  resolveKey(provider: LLMProvider): Promise<string>;
  gateway: Pick<AiGateway, 'chatStream' | 'chat'>;
  /** When present (and it has tools), turns run through the tool agent graph. */
  agent?: AssistantRunner;
  /** Runner for named flows (`flow: 'research'`); absent → the turn fails with a clear error. */
  researchRunner?: AssistantRunner;
  /** Grants/approval policy for the agent path; absent → tools auto-run. */
  policy?: ToolPolicyEngine;
  /** Native-tool host enabling slash-command direct invocation. */
  tools?: TurnManagerTools;
  /** When present (and a config engine is enabled), eligible turns try local dispatch first (plan 20 S3). */
  decision?: TurnManagerDecision;
  /** Prompt-armed speak gate (plan 24 S5); absent → no speak decision. */
  decisionSpeak?: TurnManagerDecisionQuestions;
  /** When present and `behavior.memoryContext` is on, recalls memories at turn start. */
  memories?: TurnManagerMemories;
  broadcast(event: TurnEvent): void;
  /** Background-completion hook: called on finished/failed when the app opts in. */
  notify?(title: string, body: string): void;
  /** Command-history recorder for palette-originated direct tool calls (plan 14 D4). */
  recordCommand?(record: { commandId: string; kind: 'tool'; source: 'palette'; ok: boolean }): void;
  /** Defaults to AGENT_LIMITS.wallClockMs (seam for limit tests). */
  wallClockMs?: number;
  /** Defaults to HISTORY_TOKEN_BUDGET (seam for history-fit tests). */
  historyTokenBudget?: number;
  /** Fresh turns supersede an abandoned pause on the same branch thread. */
  checkpointer?: { deleteThread(threadId: string): Promise<void> };
}

interface ActiveTurn {
  tempMessageId: string;
  conversationId: string;
  cancel(): void;
}

interface QueuedTurn {
  conversationId: string;
  tempMessageId: string;
  request: TurnStartRequest;
}

interface LaunchedTurn {
  conversationId: string;
  tempMessageId: string;
  run(): Promise<void>;
}

export interface TurnContext {
  tempMessageId: string;
  conversationId: string;
  request: TurnStartRequest;
  /** The message this turn's assistant reply parents under. */
  userMessageId: string;
  /** Checkpoint thread for this branch (health H2 ruling). */
  threadId: string;
  /** Branch provenance persisted on the reply (plan 40). */
  branchedFrom?: string;
  provider: LLMProvider;
  modelId: string;
  model: Model | null;
  apiKey: string;
  history: Message[];
  /** Memories recalled for this turn (empty when disabled or none matched). */
  recalledMemories: string[];
  /** Decision-engine dispatch provenance (plan 20 S3 fast path). */
  decision?: DecisionProvenance;
  /** A decision attempt ran but handed the turn to chat (D4 fall-through). */
  decisionFallThrough?: TurnDecisionFallThrough['fallThrough'];
  /** Prompt-armed speak (plan 24 S5): the user's own prompt asked for it. */
  speakOverride?: boolean;
  /** A speak rule asked for a fixed line instead of the reply (plan 24 S7). */
  speakText?: string;
  /** Standing voice mode request to persist/clear (plan 24 S5 follow-up). */
  speakMode?: 'on' | 'off';
}

const TEMP_PREFIX = 'temp-';

/**
 * Mirrors live download progress onto the matching open `download_file`
 * trace step: the first event for a transfer binds it to the newest open
 * download step that has no transfer yet (FIFO when several run at once).
 */
function subscribeDownloadProgress(
  log: TurnEventLog,
  openDownloadSteps: string[]
): () => void {
  const bindings = new Map<string, string>();
  const boundSteps = new Set<string>();
  return downloads.subscribe((event) => {
    let stepId = bindings.get(event.downloadId);
    if (!stepId) {
      for (let index = openDownloadSteps.length - 1; index >= 0; index -= 1) {
        if (!boundSteps.has(openDownloadSteps[index])) {
          stepId = openDownloadSteps[index];
          break;
        }
      }
      if (!stepId) {
        return;
      }
      bindings.set(event.downloadId, stepId);
      boundSteps.add(stepId);
    }
    log.updateStep(stepId, {
      progress: {
        downloadId: event.downloadId,
        destination: event.destination,
        loadedBytes: event.loadedBytes,
        totalBytes: event.totalBytes,
        status: event.status,
      },
    });
  });
}

export class TurnManager {
  private active: ActiveTurn | null = null;
  private locked = false;
  private queued: QueuedTurn[] = [];
  private startChain: Promise<void> = Promise.resolve();
  private readonly approval: ApprovalGate;

  constructor(private readonly deps: TurnManagerDeps) {
    this.approval = new ApprovalGate(deps);
  }

  isActive(): boolean {
    return this.locked || this.queued.length > 0;
  }

  /**
   * Resolves the current approval interrupt. Returns false when no approval
   * is pending (second responder after cross-window resolution = no-op).
   */
  resolveApproval(resolution: ApprovalResolution): boolean {
    return this.approval.resolve(resolution);
  }

  private waitForApproval(
    requests: TurnInterruptPayload['requests'],
    cancelledPromise: Promise<void>
  ): Promise<ApprovalResolution | null> {
    return this.approval.wait(requests, cancelledPromise);
  }

  async start(request: TurnStartRequest): Promise<TurnStartResult> {
    let result: TurnStartResult | undefined;
    const task = this.startChain.then(async () => {
      result = await this.startNow(request);
    });
    this.startChain = task.then(
      () => undefined,
      () => undefined
    );
    await task;
    return result as TurnStartResult;
  }

  private async startNow(request: TurnStartRequest, fromQueue = false): Promise<TurnStartResult> {
    const activeConversationId = this.active?.conversationId;
    if (request.conversationId.startsWith(TEMP_PREFIX) && activeConversationId) {
      request = { ...request, conversationId: activeConversationId };
    }
    if (!fromQueue && (this.locked || this.active)) {
      const owner = this.active?.conversationId ?? this.queued[0]?.conversationId;
      if (owner && owner !== request.conversationId) {
        throw new Error('A turn is already in progress in another conversation.');
      }
      const tempMessageId = `turn_${randomUUID()}`;
      this.queued.push({
        conversationId: request.conversationId,
        tempMessageId,
        request,
      });
      return { tempMessageId, queued: true };
    }
    let fastDispatch: TurnDecisionDispatch | TurnDecisionFallThrough | TurnDecisionRoute | null = request.branch
      ? null
      : request.directTool
        ? { direct: request.directTool, decision: undefined as unknown as DecisionProvenance }
        : await this.tryDecisionDispatch(request);
    // Prompt-armed speak (plan 24 S5): a pre-model gate over the user's own
    // prompt — advisory, never blocking, and immune to model output (D13).
    const speakOnRequest = this.deps.getConfig().voice?.speakOnRequest !== false;
    const speakIntent =
      request.directTool || request.flow || !speakOnRequest
        ? undefined
        : await runSpeakIntentPoint(this.deps.decisionSpeak, request.content);
    const ruleSpeak =
      fastDispatch && 'speak' in fastDispatch ? (fastDispatch as { speak?: DispatchSpeak }).speak : undefined;
    const speakOverride = speakIntent?.speak === true || ruleSpeak?.target === 'reply';
    const speakText = ruleSpeak?.target === 'text' ? ruleSpeak.text : undefined;
    // Standing voice mode (plan 24 S5 follow-up): 'on'/'off' persist onto
    // the conversation via the finished event; otherwise unchanged.
    const speakMode: 'on' | 'off' | undefined =
      speakIntent?.mode === 'on' || speakIntent?.mode === 'off' ? speakIntent.mode : undefined;
    let provider: LLMProvider | null = null;
    let model: Model | null = null;
    let apiKey = '';
    let routedDecision: DecisionProvenance | null = null;
    if (!request.directTool && fastDispatch && 'route' in fastDispatch) {
      const routed = findModel(this.deps.getConfig(), fastDispatch.route.modelId);
      const provenance = fastDispatch.route.decision;
      if (!routed) {
        console.warn(
          `[decision] route target '${fastDispatch.route.modelId}' is not configured — falling through to the chat turn`
        );
        fastDispatch = { fallThrough: { decision: provenance, reason: TEXT.DECISION_TRACE_ROUTE_MISS } };
      } else {
        const routedKey = await this.deps.resolveKey(routed.provider);
        if (!routedKey && routed.provider.type !== LLMProviderType.OLLAMA) {
          console.warn(
            `[decision] no API key for routed provider '${routed.provider.name}' — falling through to the chat turn`
          );
          fastDispatch = { fallThrough: { decision: provenance, reason: TEXT.DECISION_TRACE_ROUTE_KEY } };
        } else {
          provider = routed.provider;
          model = routed.model;
          apiKey = routedKey;
          routedDecision = { ...provenance, routedTo: routed.model.id };
        }
      }
    }

    const conversationId = request.branch
      ? request.conversationId
      : await this.ensureConversation(request);
    if (request.branch && !(await this.deps.conversations.conversationExists(conversationId))) {
      throw new Error('Conversation not found');
    }

    const conversation = this.deps.conversations.getConversationById
      ? await this.deps.conversations.getConversationById(conversationId).catch(() => null)
      : null;
    const modelOverride = request.modelId || conversation?.metadata?.modelId || null;
    if (!request.directTool && !routedDecision) {
      const hasVisionInput = (request.attachments ?? []).some(
        (attachment) => attachment && (attachment.type === 'image' || attachment.type === 'screen-capture')
      );
      const resolution =
        (hasVisionInput ? resolveTaskModel(this.deps.getConfig(), AiTask.VISION, modelOverride) : null) ??
        resolveTaskModel(this.deps.getConfig(), AiTask.CHAT, modelOverride);
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

    const tempMessageId = `turn_${randomUUID()}`;
    const userMessageId = request.branch
      ? request.branch.userMessageId
      : (((await this.deps.messages.createMessage(
          request.content,
          MessageRole.USER,
          conversationId,
          request.attachments
        )) as { id?: string }).id ?? tempMessageId);
    const history = request.branch
      ? await this.historyForBranch(conversationId, request.branch)
      : await this.deps.messages.getMessagesByConversation(conversationId);
    const tree = this.deps.messages.getMessageTree
      ? await this.deps.messages.getMessageTree(conversationId)
      : null;
    const anchor = tree?.nodes.find((message) => message.id === userMessageId);
    if (request.branch && !anchor) {
      throw new Error('Branch anchor message not found');
    }
    const threadId =
      tree && anchor
        ? request.branch?.kind === 'regenerate'
          ? regenerateThreadKey(conversationId, tree.nodes, anchor)
          : branchThreadKey(conversationId, tree.nodes, anchor)
        : conversationId;
    const base = {
      tempMessageId,
      conversationId,
      request,
      userMessageId,
      threadId,
      ...(request.branch?.branchedFrom ? { branchedFrom: request.branch.branchedFrom } : {}),
      provider: provider as LLMProvider,
      modelId: model?.id ?? modelOverride ?? '',
      model,
      apiKey,
      history,
      recalledMemories: [],
    };

    if (fastDispatch && 'direct' in fastDispatch) {
      const direct = fastDispatch.direct;
      const decision = fastDispatch.decision;
      return this.dispatch(base, async () => {
        this.applyDecisionRule(fastDispatch && 'direct' in fastDispatch ? fastDispatch.rule : undefined, conversationId);
        await this.runToolOnlyTurn(
          {
            ...base,
            recalledMemories: [],
            ...(decision ? { decision } : {}),
            ...(speakOverride ? { speakOverride: true } : {}),
            ...(speakText ? { speakText } : {}),
            ...(speakMode ? { speakMode } : {}),
          },
          direct
        );
      });
    }

    const recalledMemories = await this.recallMemories(request.content);
    return this.dispatch(
      { ...base, recalledMemories },
      async () => {
        await this.runTurn({
          ...base,
          recalledMemories,
          ...(routedDecision ? { decision: routedDecision } : {}),
          ...(speakOverride ? { speakOverride: true } : {}),
          ...(speakText ? { speakText } : {}),
          ...(speakMode ? { speakMode } : {}),
          ...(fastDispatch && 'fallThrough' in fastDispatch
            ? { decisionFallThrough: fastDispatch.fallThrough }
            : {}),
        });
      }
    );
  }

  private async historyForBranch(
    conversationId: string,
    branch: NonNullable<TurnStartRequest['branch']>
  ): Promise<Message[]> {
    const active = await this.deps.messages.getMessagesByConversation(conversationId);
    if (branch.kind !== 'regenerate') {
      return active;
    }
    const index = active.findIndex((message) => message.id === branch.userMessageId);
    return index === -1 ? active : active.slice(0, index + 1);
  }

  private dispatch(ctx: TurnContext, run: () => Promise<void>): TurnStartResult {
    this.launch({
      conversationId: ctx.conversationId,
      tempMessageId: ctx.tempMessageId,
      run,
    });
    return { tempMessageId: ctx.tempMessageId, queued: false };
  }

  private launch(turn: LaunchedTurn): void {
    this.locked = true;
    this.active = { tempMessageId: turn.tempMessageId, conversationId: turn.conversationId, cancel: () => {} };
    void turn
      .run()
      .catch((error) => console.error('Turn failed before persistence:', error))
      .finally(() => {
        this.locked = false;
        this.active = null;
        this.approval.clear();
        this.drain();
      });
  }

  private drain(): void {
    if (this.locked) {
      return;
    }
    const next = this.queued.shift();
    if (!next) {
      return;
    }
    this.locked = true;
    this.active = { tempMessageId: next.tempMessageId, conversationId: next.conversationId, cancel: () => {} };
    void this.startNow(next.request, true)
      .then((result) => {
        if (result.queued) {
          this.locked = false;
          this.active = null;
          this.drain();
        }
      })
      .catch((error) => {
        console.error('Queued turn failed before starting:', error);
        this.locked = false;
        this.active = null;
        this.drain();
      });
  }

  cancel(): boolean {
    if (!this.active) {
      return false;
    }
    this.active.cancel();
    return true;
  }

  /**
   * Plan 20 S3 fast path, now a thin caller of the tool-dispatch decision
   * point (plan 24 S3): eligibility and classification live in the point;
   * this maps its verdict onto the turn's dispatch shapes. Fail-open — any
   * non-ok point outcome runs the standard turn.
   */
  private async tryDecisionDispatch(
    request: TurnStartRequest
  ): Promise<TurnDecisionDispatch | TurnDecisionFallThrough | TurnDecisionRoute | null> {
    const decision = this.deps.decision;
    if (!decision) {
      return null;
    }
    const batch = await runDecisionBatch<ToolDispatchVerdict | null>([
      {
        descriptor: TOOL_DISPATCH_POINT,
        run: () =>
          runToolDispatchPoint({
            config: this.deps.getConfig(),
            decision,
            content: request.content,
            hasAttachments: (request.attachments?.length ?? 0) > 0,
            hasFlow: Boolean(request.flow),
          }),
      },
    ]);
    const outcome = batch.outcomes[0];
    if (!outcome || outcome.status !== 'ok' || !outcome.verdict) {
      if (outcome && outcome.status !== 'skipped') {
        console.log(`[decision] tool-dispatch point ${outcome.status}: ${outcome.error ?? ''}`);
      }
      return null;
    }
    const verdict = outcome.verdict;
    if (verdict.type === 'direct') {
      return { direct: verdict.request, decision: verdict.provenance };
    }
    if (verdict.type === 'route') {
      return { route: { modelId: verdict.modelId, decision: verdict.provenance } };
    }
    return {
      fallThrough: {
        decision: verdict.provenance,
        reason: verdict.reason,
        ...(verdict.calls ? { calls: verdict.calls } : {}),
      },
    };
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
    return recallForTurn(this.deps, query);
  }

  /** Synthetic system message carrying recalled memories (never persisted). */
  private withMemoryContext(ctx: TurnContext, history: AIMessage[]): AIMessage[] {
    return addMemoryContext(ctx, history);
  }

  private fittedHistory(ctx: TurnContext, log: TurnEventLog): AIMessage[] {
    return shapeFittedHistory(this.deps, ctx, log);
  }

  private async buildRecallIndex(ctx: TurnContext): Promise<string[]> {
    return buildRecallIndex(ctx);
  }

  private logMemoryMarker(log: TurnEventLog, ctx: TurnContext): void {
    markRecalledMemory(log, ctx);
  }

  /** Decision attempt ran but handed the turn to chat (D4) — surface it (plan 20 S6). */
  private logDecisionFallThrough(log: TurnEventLog, ctx: TurnContext): void {
    if (!ctx.decisionFallThrough) {
      return;
    }
    const engineName = ctx.decisionFallThrough.decision.engine;
    const summary = ctx.decisionFallThrough.calls
      ? interpolate(TEXT.DECISION_TRACE_COMPOUND, { count: ctx.decisionFallThrough.calls })
      : ctx.decisionFallThrough.reason;
    const step = log.beginStep({
      id: `decision_${ctx.tempMessageId}`,
      phase: 'thinking',
      label: `${interpolate(TEXT.DECISION_TRACE_LABEL, { engine: engineName })} — ${summary}`,
      summary,
      detail: { ...ctx.decisionFallThrough.decision, reason: ctx.decisionFallThrough.reason },
    });
    log.endStep(step.id);
  }

  /** Route-tool pick (plan 20 S7 D12) — the turn runs on the routed model; show the hand-off. */
  private logDecisionRoute(log: TurnEventLog, ctx: TurnContext): void {
    if (!ctx.decision?.routedTo) {
      return;
    }
    const engineName = ctx.decision.engine;
    const summary = interpolate(TEXT.DECISION_TRACE_ROUTED, {
      model: ctx.model?.name ?? ctx.decision.routedTo,
      confidence: Math.round(ctx.decision.confidence * 100),
    });
    const step = log.beginStep({
      id: `decision_${ctx.tempMessageId}`,
      phase: 'thinking',
      label: interpolate(TEXT.DECISION_TRACE_LABEL, { engine: engineName }),
      summary,
      detail: ctx.decision,
    });
    log.endStep(step.id);
  }

  private async runTurn(ctx: TurnContext, seedSteps: TurnTraceStep[] = []): Promise<void> {
    if (!ctx.modelId) {
      // Defensive: a model-calling turn must never reach a provider
      // without a resolved id (empty model ids surface as cryptic
      // provider errors, e.g. Gemini "Must provide a model name").
      const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event), seedSteps);
      this.active = { tempMessageId: ctx.tempMessageId, conversationId: ctx.conversationId, cancel: () => {} };
      log.phase('queued', seedSteps.length ? { steps: seedSteps.map((step) => ({ ...step })) } : {});
      log.phase('failed', { error: 'No chat model resolved for this turn.' });
      await this.persist(ctx, {
        content: 'An error occurred.',
        error: 'No chat model resolved for this turn.',
        metadata: { outcome: 'failed', durationMs: 0, steps: capTraceSteps(log.allSteps()) },
      });
      this.active = null;
      this.notify('Turn failed', 'No chat model resolved for this turn.');
      return;
    }
    if (ctx.request.flow === 'research') {
      if (!this.deps.researchRunner) {
        return this.runUnavailableFlowTurn(ctx, 'research');
      }
      return this.runAgentTurn(ctx, this.deps.researchRunner, 'research', seedSteps);
    }
    const agent = this.deps.agent;
    if (agent && (!ctx.model || hasCap(ctx.model, 'tools'))) {
      return this.runAgentTurn(ctx, agent, 'assistant', seedSteps);
    }
    return this.runStreamTurn(ctx, seedSteps);
  }

  /** A flow was requested but no runner is wired — fail the turn honestly. */
  private async runUnavailableFlowTurn(ctx: TurnContext, flow: string): Promise<void> {
    const message = `The '${flow}' flow is not available in this build.`;
    const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event));
    const startedAt = Date.now();
    this.active = { tempMessageId: ctx.tempMessageId, conversationId: ctx.conversationId, cancel: () => {} };
    log.phase('queued');
    log.phase('failed', { error: message });
    await this.persist(ctx, {
      content: 'An error occurred.',
      error: message,
      metadata: { outcome: 'failed', model: ctx.modelId, durationMs: Date.now() - startedAt },
    });
    this.active = null;
    this.notify('Turn failed', message);
  }

  private async runAgentTurn(
    ctx: TurnContext,
    agent: AssistantRunner,
    flow: 'assistant' | 'research' = 'assistant',
    seedSteps: TurnTraceStep[] = []
  ): Promise<void> {
    const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event), seedSteps);
    let cancelled = false;
    let timedOut = false;
    let releaseCancel: () => void = () => {};
    const cancelledPromise = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const controller = new AbortController();
    this.active = {
      tempMessageId: ctx.tempMessageId,
      conversationId: ctx.conversationId,
      cancel: () => {
        cancelled = true;
        releaseCancel();
        controller.abort();
        downloads.cancelAll();
      },
    };

    const startedAt = Date.now();
    log.phase('queued', seedSteps.length ? { steps: seedSteps.map((step) => ({ ...step })) } : {});
    this.logDecisionFallThrough(log, ctx);
    this.logDecisionRoute(log, ctx);
    this.logMemoryMarker(log, ctx);
    const wallClockMs = this.deps.wallClockMs ?? AGENT_LIMITS.wallClockMs;
    const wallClock = setTimeout(() => {
      timedOut = true;
      releaseCancel();
      controller.abort();
      downloads.cancelAll();
    }, wallClockMs);

    let fullContent = '';
    let failed: Error | null = null;
    let turnLimitNotice: TurnLimitKind | null = null;
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
    const openDownloadSteps: string[] = [];
    const unsubscribeDownloads = subscribeDownloadProgress(log, openDownloadSteps);
    const turnArtifacts: FileArtifact[] = [];
    const nodeTimelineEntries: TurnNodeRunSummary[] = [];

    let recallIndex: string[] = [];
    if ((await this.deps.tools?.riskFor('recall_screenshot')) !== undefined) {
      recallIndex = await this.buildRecallIndex(ctx);
    }

    const conversation = this.deps.conversations.getConversationById
      ? await this.deps.conversations.getConversationById(ctx.conversationId).catch(() => null)
      : null;
    const persona = conversation?.metadata?.systemPrompt;

    const memoryBlock = ctx.recalledMemories.length ? buildMemoryContextBlock(ctx.recalledMemories) : '';
    const systemPromptOverride = [persona, ctx.speakOverride ? SPEAK_OVERRIDE_BLOCK : '']
      .filter(Boolean)
      .join('\n\n');

    const agentInput: AssistantTurnInput = {
      provider: ctx.provider,
      modelId: ctx.modelId,
      apiKey: ctx.apiKey,
      overrides: ctx.model ? modelTuning(ctx.provider, ctx.model) : undefined,
      history: this.fittedHistory(ctx, log),
      threadId: ctx.threadId,
      signal: controller.signal,
      recallIndex,
      // Memory context rides the system prompt — a second leading system
      // message in front of the agent prompt is rejected by Gemini.
      ...(memoryBlock ? { memoryContext: memoryBlock } : {}),
      ...(systemPromptOverride ? { systemPromptOverride } : {}),
    };

    if (this.deps.checkpointer) {
      // A fresh turn on this branch supersedes an abandoned approval pause.
      await this.deps.checkpointer.deleteThread(agentInput.threadId).catch((error) => {
        console.warn('Checkpoint supersede failed, continuing:', error);
      });
    }
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
        } else if (event.type === 'app_selection') {
          const bound = event.decisions.filter((decision) => decision.reason !== 'no-match' && decision.reason !== 'budget-drop');
          const dropped = event.decisions.length - bound.length;
          const step = log.beginStep({
            id: `app_selection_${ctx.tempMessageId}`,
            phase: 'thinking',
            label: TEXT.APP_SELECTION_LABEL,
            summary:
              bound.length === 0
                ? TEXT.APP_SELECTION_NONE
                : interpolate(TEXT.APP_SELECTION_SUMMARY, {
                    bound: bound.map((decision) => decision.appName).join(', '),
                    droppedSuffix: dropped > 0 ? interpolate(TEXT.APP_SELECTION_DROPPED_SUFFIX, { dropped }) : '',
                  }),
            detail: event.decisions,
          });
          log.endStep(step.id);
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
                ...(event.summary ? { summary: event.summary } : {}),
                ...(event.resumed ? { resumed: true } : {}),
              },
              Date.now(),
              { node: { node: event.node, label: event.label, resumed: event.resumed } }
            );
            nodeStepIds.set(event.node, step.id);
          }
        } else if (event.type === 'node_finished') {
          nodeTimelineEntries.push({
            node: event.node,
            outcome: event.outcome,
            durationMs: event.durationMs,
            resumed: event.resumed,
          });
          void recordGraphNodeRun({
            flow,
            threadId: agentInput.threadId,
            node: event.node,
            outcome: event.outcome,
            durationMs: event.durationMs,
            resumed: event.resumed,
          });
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
            if (call.name === DOWNLOAD_TOOL_NAME) {
              openDownloadSteps.push(step.id);
            }
          }
        } else if (event.type === 'tool_results') {
          for (const result of event.results) {
            const stepId = toolStepIds.get(result.id);
            const meta = approvalMeta.get(result.id);
            let durationMs = 0;
            const stored = extractStoredResult(result.content);
            if (!result.isError) {
              const artifact = extractArtifactMarker(stored.text);
              if (artifact) {
                turnArtifacts.push(artifact);
              }
            }
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
              const downloadIndex = stepId ? openDownloadSteps.indexOf(stepId) : -1;
              if (downloadIndex !== -1) {
                openDownloadSteps.splice(downloadIndex, 1);
              }
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
          if (event.limitNotice) {
            turnLimitNotice = event.limitNotice;
          }
        }
      }
    } catch (error) {
      failed = error as Error;
    } finally {
      clearTimeout(wallClock);
      unsubscribeDownloads();
      this.active = null;
      this.approval.clear();
      if (cancelled) {
        void iterator.return?.(undefined);
      } else {
        await iterator.return?.(undefined);
      }
    }

    const durationMs = Date.now() - startedAt;
    const steps = capTraceSteps(log.allSteps());
    const failure = timedOut
      ? new Error(`Turn exceeded the ${Math.round(wallClockMs / 1000)}s time budget.`)
      : failed;
    const toolCountByNode = new Map<string, number>();
    for (const step of log.allSteps()) {
      if (step.node && (step.phase === 'tool_result' || step.phase === 'tool_call')) {
        toolCountByNode.set(step.node, (toolCountByNode.get(step.node) ?? 0) + 1);
      }
    }
    const nodeTimeline = nodeTimelineEntries.map((entry) => ({
      ...entry,
      toolCount: toolCountByNode.get(entry.node) ?? 0,
    }));

    if (failure) {
      const failureKind = limitKindOf(failure);
      if ((timedOut || failureKind) && !cancelled) {
        const kind: TurnLimitKind = timedOut ? 'time-budget' : (failureKind as TurnLimitKind);
        const finalText = await this.completeWithLimit(
          ctx,
          agent,
          agentInput,
          log,
          fullContent,
          kind,
          timedOut
        );
        await this.persist(ctx, {
          content: finalText,
          metadata: {
            outcome: 'ok',
            model: ctx.modelId,
            durationMs,
            steps,
            toolCount: toolCallCount,
            ...(nodeTimeline.length > 0 ? { nodeTimeline } : {}),
            limitNotice: kind,
          },
        });
        log.phase('finished', {
          steps,
          model: ctx.modelId,
          durationMs,
          limitNotice: kind,
        });
        this.notify('Turn complete', finalText.slice(0, 120) || 'Your response is ready.');
        void this.generateTitleIfNeeded(ctx, finalText);
        return;
      }
      await this.persist(ctx, {
        content: fullContent || 'An error occurred.',
        error: failure.message,
        metadata: {
          outcome: 'failed',
          model: ctx.modelId,
          durationMs,
          steps,
          toolCount: toolCallCount,
          ...(nodeTimeline.length > 0 ? { nodeTimeline } : {}),
        },
      });
      log.phase('failed', { error: failure.message });
      this.notify('Turn failed', failure.message);
      return;
    }

    if (cancelled) {
      await this.persist(ctx, {
        content: fullContent,
        metadata: {
          outcome: 'cancelled',
          model: ctx.modelId,
          durationMs,
          steps,
          toolCount: toolCallCount,
          ...(nodeTimeline.length > 0 ? { nodeTimeline } : {}),
        },
      });
      log.phase('cancelled', { steps, durationMs });
      return;
    }

    await this.persist(ctx, {
      content: fullContent,
      metadata: {
        outcome: 'ok',
        model: ctx.modelId,
        durationMs,
        steps,
        toolCount: toolCallCount,
        ...(nodeTimeline.length > 0 ? { nodeTimeline } : {}),
        ...(turnArtifacts.length > 0 ? { artifacts: turnArtifacts } : {}),
        ...(turnLimitNotice ? { limitNotice: turnLimitNotice } : {}),
      },
    });
    log.phase('finished', {
      steps,
      model: ctx.modelId,
      durationMs,
      ...(ctx.speakOverride === true || ctx.speakText ? { speak: true } : {}),
      ...(ctx.speakText ? { speakText: ctx.speakText } : {}),
      ...(ctx.speakMode ? { speakMode: ctx.speakMode } : {}),
      ...(turnArtifacts.length > 0 ? { artifacts: turnArtifacts } : {}),
      ...(turnLimitNotice ? { limitNotice: turnLimitNotice } : {}),
    });
    this.notify('Turn complete', fullContent.slice(0, 120) || 'Your response is ready.');
    void this.generateTitleIfNeeded(ctx, fullContent);
  }

  /**
   * Best-available answer for a limit-bound turn (plan 17 S1): the
   * wall clock gets one grace-window salvage attempt through the
   * runner (D3); every other limit degrades to the static honest
   * line. Never throws — a failed salvage is the static line (D2).
   */
  private async completeWithLimit(
    ctx: TurnContext,
    agent: AssistantRunner,
    agentInput: AssistantTurnInput,
    log: TurnEventLog,
    streamed: string,
    kind: TurnLimitKind,
    allowModelSalvage: boolean
  ): Promise<string> {
    let salvaged: string | null = null;
    if (allowModelSalvage && agent.salvage) {
      try {
        salvaged = await Promise.race([
          agent.salvage({
            provider: ctx.provider,
            modelId: ctx.modelId,
            apiKey: ctx.apiKey,
            overrides: agentInput.overrides,
            question: truncateText(ctx.request.content, 500),
            notes: this.partialNotes(log, streamed),
            kind,
            timeoutMs: SALVAGE_GRACE_MS,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), SALVAGE_GRACE_MS)),
        ]);
      } catch {
        salvaged = null;
      }
    }
    const partial = salvaged ?? staticLimitText(kind);
    return streamed ? `${streamed}\n\n${partial}` : partial;
  }

  /** Tool summaries + streamed text as bounded salvage notes (D2 digest input). */
  private partialNotes(log: TurnEventLog, streamed: string): string[] {
    const notes: string[] = [];
    if (streamed.trim()) {
      notes.push(truncateText(streamed, 2_000));
    }
    for (const step of log.allSteps().filter((entry) => entry.phase === 'tool_result').slice(-6)) {
      notes.push(truncateText(`${step.label}: ${step.summary ?? ''}${step.response ? ` — ${step.response}` : ''}`, 600));
    }
    return notes;
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
      conversationId: ctx.conversationId,
      cancel: () => {
        cancelled = true;
        releaseCancel();
        downloads.cancelAll();
      },
    };
    const startedAt = Date.now();
    log.phase('queued');
    let repairWithAgent = false;
    let repairFailureText = '';
    const traceModel = ctx.decision ? ctx.decision.engine : ctx.modelId;
    let decisionSummary: string | null = null;
    if (ctx.decision) {
      const engineName = ctx.decision.engine;
      const band =
        ctx.decision.band === 'act'
          ? TEXT.DECISION_TEST_BAND_ACT
          : ctx.decision.band === 'confirm'
            ? TEXT.DECISION_TEST_BAND_CONFIRM
            : TEXT.DECISION_TEST_BAND_REFUSE;
      decisionSummary = interpolate(TEXT.DECISION_TEST_RESULT, {
        confidence: Math.round(ctx.decision.confidence * 100),
        band,
      });
      const decisionStep = log.beginStep({
        id: `decision_${ctx.tempMessageId}`,
        phase: 'thinking',
        label: interpolate(TEXT.DECISION_TRACE_LABEL, { engine: engineName }),
        summary: decisionSummary,
        detail: ctx.decision,
      });
      log.endStep(decisionStep.id);
    }
    const openDownloadSteps: string[] = [];
    const unsubscribeDownloads = subscribeDownloadProgress(log, openDownloadSteps);

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
      const risk = await tools?.riskFor(requested.name);
      if (!tools || risk === undefined) {
        await finalizeFailed(`Unknown tool '${requested.name}'.`);
        return;
      }
      if (this.deps.policy?.isDisabled(requested.name)) {
        await finalizeFailed(`'${requested.name}' is disabled. Re-enable it in Settings → Tools.`);
        return;
      }

      const summary = await tools.summarizeFor(requested.name, requested.args);
      const attributedSummary =
        summary +
        (ctx.decision
          ? ` — ${interpolate(TEXT.TRACE_DISPATCHED_BY, {
              engine: ctx.decision.engine,
              confidence: Math.round(ctx.decision.confidence * 100),
            })}`
          : '');
      const step = log.beginStep({
        id: `tool_direct_${ctx.tempMessageId}`,
        phase: 'tool_call',
        label: requested.name,
        toolName: requested.name,
        summary: attributedSummary,
        detail: requested.args,
      });

      let effective: DirectToolRequest = requested;
      let denied = false;
      let denialSource: ToolApprovalSource = 'denied';
      const needsAccess = ((await tools.requestedRoots?.(requested.name, requested.args)) ?? []).length > 0;
      const needsApproval =
        requested.forceApproval === true ||
        (this.deps.policy?.decision(requested.name, risk, requested.args) ?? 'run') === 'approve';
      if (requested.name === DOWNLOAD_TOOL_NAME) {
        openDownloadSteps.push(step.id);
      }
      if (needsApproval || needsAccess) {
        const requests: ApprovalRequest[] = [
          {
            id: 'appr_0',
            toolName: requested.name,
            args: requested.args,
            summary,
            risk,
            allowedDecisions: (await tools.editableArgs(requested.name))
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
        if (ctx.decision && !cancelled) {
          repairWithAgent = true;
          repairFailureText = String(outcome.text);
        } else {
          await this.persist(ctx, {
            content: 'An error occurred.',
            error: outcome.text,
            metadata: { outcome: 'failed', model: traceModel, durationMs, steps, toolCount: 1 },
          });
          log.phase('failed', { error: outcome.text, model: traceModel });
          this.notify('Turn failed', truncateText(outcome.text, 120));
        }
      } else {
        const artifact = extractArtifactMarker(outcome.text);
        const artifacts = artifact ? [artifact] : [];
        await this.persist(ctx, {
          content: truncateText(outcome.text, DIRECT_RESULT_PERSIST_CAP),
          metadata: {
            outcome: 'ok',
            model: traceModel,
            durationMs,
            steps,
            toolCount: 1,
            ...(artifacts.length > 0 ? { artifacts } : {}),
          },
        });
        log.phase('finished', {
          steps,
          durationMs,
          model: traceModel,
          ...(artifacts.length > 0 ? { artifacts } : {}),
        });
        this.notify('Done', truncateText(outcome.text, 120) || 'Done.');
      }
    } finally {
      unsubscribeDownloads();
      this.active = null;
      this.approval.clear();
    }

    if (repairWithAgent) {
      console.log('[decision] dispatch failed — falling through to agent repair');
      log.endStep(`decision_${ctx.tempMessageId}`, Date.now(), {
        label: `${interpolate(TEXT.DECISION_TRACE_LABEL, {
          engine: ctx.decision ? ctx.decision.engine : '',
        })} — failed`,
        summary: `${decisionSummary ?? ''} — ${TEXT.DECISION_TRACE_DISPATCH_FAILED}`.trim(),
        response: truncateText(`Dispatch failed: ${repairFailureText}`, 400),
        status: 'error',
      });
      await this.runTurn(ctx, log.allSteps());
    }
  }

  private async auditDenied(
    requests: TurnInterruptPayload['requests'],
    fallbackArgs: unknown,
    source: ToolApprovalSource,
    ctx: TurnContext
  ): Promise<void> {
    await auditDenied(requests, fallbackArgs, source, ctx);
  }

  private async runStreamTurn(ctx: TurnContext, seedSteps: TurnTraceStep[] = []): Promise<void> {
    const log = new TurnEventLog(ctx.tempMessageId, ctx.conversationId, (event) => this.deps.broadcast(event), seedSteps);
    let cancelled = false;
    let releaseCancel: () => void = () => {};
    const cancelledPromise = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    this.active = {
      tempMessageId: ctx.tempMessageId,
      conversationId: ctx.conversationId,
      cancel: () => {
        cancelled = true;
        releaseCancel();
      },
    };

    const startedAt = Date.now();
    log.phase('queued', seedSteps.length ? { steps: seedSteps.map((step) => ({ ...step })) } : {});
    this.logDecisionFallThrough(log, ctx);
    this.logDecisionRoute(log, ctx);
    this.logMemoryMarker(log, ctx);
    const thinking = log.beginStep({ id: `think_${ctx.tempMessageId}`, phase: 'thinking', label: 'Thinking' });

    let fullContent = '';
    let firstDelta = true;
    let failed: Error | null = null;

    const stream = this.deps.gateway.chatStream({
      provider: ctx.provider,
      modelId: ctx.modelId,
      apiKey: ctx.apiKey,
      messages: this.withMemoryContext(ctx, this.fittedHistory(ctx, log)),
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
    await generateTitleIfNeeded(this.deps, ctx, assistantContent);
  }

  /**
   * A custom rule fired on a confident dispatch (plan 24 S7). The dispatch
   * itself always runs; the rule only layers a side effect from the closed
   * action set (notify/speak/tag; route is handled at dispatch time).
   */
  private applyDecisionRule(fire: DecisionRuleFire | undefined, conversationId: string): void {
    applyTurnDecisionRule(this.deps, fire, conversationId);
  }

  private notify(title: string, body: string): void {
    notifyTurn(this.deps, title, body);
  }

  private async persist(
    ctx: Pick<TurnContext, 'conversationId' | 'userMessageId' | 'branchedFrom' | 'decision' | 'request'>,
    data: { content: string; error?: string; metadata: TurnMetadata }
  ): Promise<void> {
    await persistTurn(this.deps, ctx, data);
  }
}
