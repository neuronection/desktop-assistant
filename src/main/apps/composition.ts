import { app, BrowserWindow, Notification } from 'electron';
import { randomUUID, createHash } from 'crypto';
import { mkdir, rename, copyFile, rm } from 'fs/promises';
import type { AppConfig } from '@shared/config/AppConfig';
import type { LLMProvider } from '@shared/types';
import {
  DEFAULT_LIVE_CARD,
  resolveSandboxLimits,
  validatePackConfig,
  type ImportMiniAppResult,
  type MiniAppLiveCardView,
  type MiniAppRunDiffView,
  type MiniAppRunReportView,
  type MiniAppRunStats,
  type MiniAppRunView,
  type MiniAppSaveConfigResult,
  type MiniAppSetEnabledResult,
  type MiniAppsState,
  type PackError,
} from '@shared/app-pack';
import { mkdirSync } from 'node:fs';
import { SandboxService, type SandboxRunRow, type SandboxStore } from './sandbox/SandboxService';
import type { SandboxStateStore } from './sandbox/capabilities';
import { electronSandboxSpawn } from './sandbox/spawn-electron';
import { MiniAppRegistry } from './registry';
import { ALL_BUNDLED_PACKS } from '@packs';
import { capabilitiesFor, PackCapabilityError, type PackCapabilityDeps } from './capabilities';
import { nodePackFsDeps } from './capabilities/node-fs';
import type { PackFsEnv } from './capabilities/fs';
import { PackFs, validateRunRoot } from './capabilities/fs';
import { PackRunBridge } from './capabilities/run';
import type { DecisionEngineDeps } from '@main/ai/decide';
import { resolveDecision } from '@main/ai/decide';
import { diffRuns, exportRunReport } from './run/export';
import { MiniAppRunService } from './run/RunService';
import { reduceRunStats } from './run/stats';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore, MiniAppRunTotals } from './run/store';
import { ProposalService, type ProposalRow, type ProposalStore } from './run/proposals';
import { QuarantineService, type QuarantineFsDeps, type QuarantineRecord, type QuarantineStore } from './quarantine';
import { createMiniAppWindowService, MiniAppWindowService, type MiniAppWindowStore } from './windows';
import { ExtensionSourcesService } from './sources/lifecycle';
import { ChildGitTransport } from './sources/transport';
import { extensionSourceSecretKey } from './sources/secretKey';
import { SecretService } from '@main/services/SecretService';
import { runnerFingerprint } from './run/fingerprint';
import { formatPackError } from './errors';
import type { MainConfigService } from '@main/services/ConfigService';
import type { DatabaseService } from '@main/services/DatabaseService';
import type { ConversationService } from '@main/services/ConversationService';
import type { MessageService } from '@main/services/MessageService';
import { stat } from 'fs/promises';
import { join } from 'node:path';
import { stringToMessageRole } from '@shared/database-types';
import { TEXT, interpolate } from '@shared/constants/text';

export interface MiniAppStackDeps {
  configService: MainConfigService;
  databaseService: DatabaseService;
  conversationService: ConversationService;
  messageService: MessageService;
  decisionEngineDeps(): DecisionEngineDeps;
}

/**
 * Mini-app domain composition (plan 26): the ONE place the pack stack
 * is assembled — registry, run/quarantine/proposal services, their
 * Prisma-backed stores, and the palette seam CommandService consumes.
 * Extracted from ipc-handlers so every deps object lives next to its
 * consumer (the seam-misplacement class of bug dies here).
 */
export interface MiniAppStack {
  registry: MiniAppRegistry;
  sources: ExtensionSourcesService;
  sandbox: SandboxService;
  runService: MiniAppRunService;
  proposalService: ProposalService;
  quarantineService: QuarantineService;
  palettePacks(): { id: string; kind: 'assessment' | 'surface'; title: string; description: string; enabled: boolean; commands?: string[] }[];
  startRunFromPalette(packId: string): Promise<{ ok: true; text: string; conversationId: string | null } | { ok: false; error: string }>;
  packTitle(packId: string): string;
  buildReportView(runId: string, itemCap?: number): Promise<MiniAppRunReportView | null>;
  buildLiveCardView(packId: string): MiniAppLiveCardView | null;
  buildRunStats(windowDays: number | null): Promise<MiniAppRunStats>;
  runRowToView(row: MiniAppRunRow): MiniAppRunView;
  diffFor(runId: string): Promise<MiniAppRunDiffView | null>;
  formatError(error: PackError): string;
  store(): MiniAppRunStore;
  quarantineStore(): QuarantineStore;
  openRunFs(rootPath: string): Promise<{ statItem: (relative: string) => Promise<{ ok: true; size: number; mtimeMs: number; isFile: boolean } | { ok: false; error: PackError }>; rootPath: string } | null>;
  executeProposal(proposalId: string): Promise<{ relPath: string; outcome: string; detail?: string }[]>;
  restoreQuarantineRecord(recordId: string): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }>;
  installBundled(restore?: boolean): Promise<string[]>;
  windows: MiniAppWindowService;
  init(): void;
  fsEnv: PackFsEnv;
}

const REPORT_DISPLAY_CAP = 2000;

export function createMiniAppStack(deps: MiniAppStackDeps): MiniAppStack {
  const { configService, databaseService, conversationService, messageService } = deps;

  const registry = new MiniAppRegistry({
    config: () => configService.getConfig(),
    updateMiniApps: async (patch) => {
      const current = configService.getConfig().miniApps;
      await configService.updateConfig({ miniApps: { ...current, ...patch } });
    },
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });

  const sources = new ExtensionSourcesService({
    miniApps: () => {
      const settings = configService.getConfig().miniApps;
      return {
        sources: (settings.sources ?? []).map((source) => ({ ...source })),
        sourceInstalls: (settings.sourceInstalls ?? []).map((install) => ({ ...install })),
        packs: settings.packs.map((pack) => ({ manifest: pack.manifest, enabled: pack.enabled, ...(pack.error ? { error: pack.error } : {}) })),
      };
    },
    updateMiniApps: async (patch) => {
      const current = configService.getConfig().miniApps;
      await configService.updateConfig({ miniApps: { ...current, ...patch } });
    },
    registry,
    transport: new ChildGitTransport(),
    contentRoot: () => join(app.getPath('userData'), 'mini-apps'),
    secretStore: {
      get: (slot) => SecretService.getInstance().getSecret(extensionSourceSecretKey(slot)),
      set: async (slot, value) => {
        await SecretService.getInstance().setSecret(extensionSourceSecretKey(slot), value);
      },
    },
    newId: () => randomUUID(),
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });

  const runBridge = new PackRunBridge({ newId: () => randomUUID(), now: () => Date.now() });
  const fsEnv: PackFsEnv = {
    home: app.getPath('home'),
    userData: app.getPath('userData'),
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    ...(process.env.SYSTEMROOT ? { systemRoot: process.env.SYSTEMROOT } : {}),
    ...(process.env.PROGRAMFILES ? { programFiles: process.env.PROGRAMFILES } : {}),
    ...(process.env.PROGRAMDATA ? { programData: process.env.PROGRAMDATA } : {}),
  };
  const capabilityDeps: PackCapabilityDeps = {
    ...nodePackFsDeps,
    fsEnv,
    decideDeps: { config: () => configService.getConfig(), engineDeps: deps.decisionEngineDeps() },
    run: runBridge,
  };

  const db = () => databaseService.getClient();

  const prismaRunRow = (row: {
    id: string; packId: string; packVersion: string; rootPath: string; configHash: string; engineId: string;
    status: string; totals: unknown; estimateCalls: number; actualCalls: number; inputTokens: number; outputTokens: number;
    error: string | null; conversationId: string | null; disallowArm: boolean; startedAt: Date; updatedAt: Date; finishedAt: Date | null;
  }): MiniAppRunRow => ({
    id: row.id,
    packId: row.packId,
    packVersion: row.packVersion,
    rootPath: row.rootPath,
    configHash: row.configHash,
    engineId: row.engineId,
    status: row.status as MiniAppRunRow['status'],
    totals: (row.totals as MiniAppRunTotals) ?? null,
    estimateCalls: row.estimateCalls,
    actualCalls: row.actualCalls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    error: row.error,
    conversationId: row.conversationId,
    disallowArm: row.disallowArm,
    startedAt: Number(row.startedAt),
    updatedAt: Number(row.updatedAt),
    finishedAt: row.finishedAt ? Number(row.finishedAt) : null,
  });

  const feedbackRowToView = (row: {
    packId: string; rootPath: string; relPath: string; verdict: string; source: string; note: string | null;
  }): { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude'; note?: string } => ({
    packId: row.packId,
    rootPath: row.rootPath,
    relPath: row.relPath,
    verdict: row.verdict as 'keep' | 'ask' | 'candidate',
    source: row.source as 'override' | 'exclude',
    ...(row.note ? { note: row.note } : {}),
  });

  const runStore: MiniAppRunStore = {
    createRun: async (row) => {
      await db().miniAppRun.create({
        data: {
          id: row.id,
          packId: row.packId,
          packVersion: row.packVersion,
          rootPath: row.rootPath,
          configHash: row.configHash,
          engineId: row.engineId,
          status: row.status,
          totals: row.totals as never,
          estimateCalls: row.estimateCalls,
          actualCalls: row.actualCalls,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          error: row.error,
          conversationId: row.conversationId,
          disallowArm: row.disallowArm,
          startedAt: new Date(row.startedAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    },
    updateRun: async (id, patch) => {
      await db().miniAppRun.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.totals !== undefined ? { totals: patch.totals as never } : {}),
          ...(patch.estimateCalls !== undefined ? { estimateCalls: patch.estimateCalls } : {}),
          ...(patch.actualCalls !== undefined ? { actualCalls: patch.actualCalls } : {}),
          ...(patch.inputTokens !== undefined ? { inputTokens: patch.inputTokens } : {}),
          ...(patch.outputTokens !== undefined ? { outputTokens: patch.outputTokens } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.finishedAt !== undefined && patch.finishedAt !== null ? { finishedAt: new Date(patch.finishedAt) } : {}),
        },
      });
    },
    getRun: async (id) => {
      const row = await db().miniAppRun.findUnique({ where: { id } });
      return row ? prismaRunRow(row) : null;
    },
    runsByStatus: async (status) => {
      const rows = await db().miniAppRun.findMany({ where: { status } });
      return rows.map(prismaRunRow);
    },
    recentRuns: async (packId, limit = 20) => {
      const rows = await db().miniAppRun.findMany({
        where: packId !== undefined ? { packId } : undefined,
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });
      return rows.map(prismaRunRow);
    },
    allRuns: async () => {
      const rows = await db().miniAppRun.findMany({ orderBy: { updatedAt: 'desc' } });
      return rows.map(prismaRunRow);
    },
    appendItem: async (row) => {
      const existing = await db().miniAppRunItem.findFirst({ where: { runId: row.runId, fingerprint: row.fingerprint } });
      if (existing) {
        await db().miniAppRunItem.update({
          where: { id: existing.id },
          data: {
            verdict: row.verdict,
            confidence: row.confidence,
            decidedBy: row.decidedBy,
            evidence: row.evidence as never,
            updatedAt: new Date(row.updatedAt),
          },
        });
        return;
      }
      await db().miniAppRunItem.create({
        data: { ...row, evidence: row.evidence as never, updatedAt: new Date(row.updatedAt) },
      });
    },
    itemsOfRun: async (runId) => {
      const rows = await db().miniAppRunItem.findMany({ where: { runId } });
      return rows.map((row) => ({
        runId: row.runId,
        packId: row.packId,
        packVersion: row.packVersion,
        configHash: row.configHash,
        engineId: row.engineId,
        fingerprint: row.fingerprint,
        relPath: row.relPath,
        verdict: row.verdict as MiniAppRunItemRow['verdict'],
        confidence: row.confidence ?? null,
        decidedBy: row.decidedBy,
        evidence: (row.evidence as Record<string, unknown> | null) ?? null,
        updatedAt: Number(row.updatedAt),
      }));
    },
    updateItemVerdict: async (runId, relPath, verdict, decidedBy) => {
      const existing = await db().miniAppRunItem.findFirst({ where: { runId, relPath } });
      if (!existing) {
        return false;
      }
      await db().miniAppRunItem.update({
        where: { id: existing.id },
        data: { verdict, decidedBy, evidence: { userOverride: true } as never },
      });
      return true;
    },
    findCachedVerdict: async (key) => {
      const row = await db().miniAppRunItem.findFirst({ where: key, orderBy: { updatedAt: 'desc' } });
      if (!row) {
        return null;
      }
      return {
        packId: row.packId,
        packVersion: row.packVersion,
        configHash: row.configHash,
        engineId: row.engineId,
        fingerprint: row.fingerprint,
        relPath: row.relPath,
        verdict: row.verdict as MiniAppRunItemRow['verdict'],
        confidence: row.confidence ?? null,
        decidedBy: row.decidedBy,
        evidence: (row.evidence as Record<string, unknown> | null) ?? null,
        updatedAt: Number(row.updatedAt),
      };
    },
    upsertFeedback: async (row) => {
      const existing = await db().miniAppFeedback.findUnique({
        where: { packId_rootPath_relPath: { packId: row.packId, rootPath: row.rootPath, relPath: row.relPath } },
      });
      if (existing) {
        await db().miniAppFeedback.update({
          where: { id: existing.id },
          data: { verdict: row.verdict, source: row.source, ...(row.note ? { note: row.note } : {}) },
        });
        return;
      }
      await db().miniAppFeedback.create({ data: row });
    },
    feedbackFor: async (packId, rootPath) => {
      const rows = await db().miniAppFeedback.findMany({ where: { packId, rootPath } });
      const map = new Map<string, { packId: string; rootPath: string; relPath: string; verdict: 'keep' | 'ask' | 'candidate'; source: 'override' | 'exclude'; note?: string }>();
      for (const row of rows) {
        map.set(row.relPath, feedbackRowToView(row));
      }
      return map;
    },
    feedbackList: async (packId) => {
      const rows = await db().miniAppFeedback.findMany({ where: { packId }, orderBy: { updatedAt: 'desc' }, take: 500 });
      return rows.map(feedbackRowToView);
    },
    feedbackClear: async (packId, relPath) => {
      const where = relPath !== undefined ? { packId, relPath } : { packId };
      const removed = await db().miniAppFeedback.deleteMany({ where });
      return removed.count;
    },
    pruneRuns: async (keepPerPack) => {
      const rows = await db().miniAppRun.findMany({ orderBy: { updatedAt: 'desc' } });
      const perPack = new Map<string, number>();
      const doomed: string[] = [];
      for (const row of rows) {
        if (['paused', 'interrupted', 'running', 'queued'].includes(row.status)) {
          continue;
        }
        const seen = (perPack.get(row.packId) ?? 0) + 1;
        perPack.set(row.packId, seen);
        if (seen > keepPerPack) {
          doomed.push(row.id);
        }
      }
      for (const id of doomed) {
        await db().miniAppRunItem.deleteMany({ where: { runId: id } });
        await db().miniAppRun.delete({ where: { id } });
      }
      return doomed.length;
    },
  };

  const quarantineFs: QuarantineFsDeps = {
    mkdir: async (path, recursive) => {
      await mkdir(path, { recursive });
    },
    stat: async (path) => {
      const stats = await stat(path);
      return { isFile: stats.isFile(), isDirectory: stats.isDirectory(), size: stats.size, dev: stats.dev };
    },
    rename: (from, to) => rename(from, to),
    copyAndDelete: async (from, to) => {
      await copyFile(from, to);
      await rm(from, { force: true });
    },
    writeFile: (path, content) => import('fs/promises').then((fsPromises) => fsPromises.writeFile(path, content, 'utf8')),
    readFile: (path) => import('fs/promises').then((fsPromises) => fsPromises.readFile(path, 'utf8')),
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    unlink: (path) => rm(path, { force: true }),
    now: () => Date.now(),
    newId: () => randomUUID(),
  };

  const quarantineRowToRecord = (row: {
    id: string; proposalId: string; packId: string; runId: string; relPath: string;
    originPath: string; quarantinePath: string; size: number; movedAt: Date; restoredAt: Date | null;
  }): QuarantineRecord => ({
    id: row.id,
    proposalId: row.proposalId,
    packId: row.packId,
    runId: row.runId,
    relPath: row.relPath,
    originPath: row.originPath,
    quarantinePath: row.quarantinePath,
    size: row.size,
    movedAt: Number(row.movedAt),
    restoredAt: row.restoredAt ? Number(row.restoredAt) : null,
  });

  const quarantineStore: QuarantineStore = {
    create: async (record) => {
      await db().miniAppQuarantine.create({
        data: {
          id: record.id, proposalId: record.proposalId, packId: record.packId, runId: record.runId,
          relPath: record.relPath, originPath: record.originPath, quarantinePath: record.quarantinePath,
          size: record.size, movedAt: new Date(record.movedAt),
        },
      });
    },
    byProposal: async (proposalId) => {
      const rows = await db().miniAppQuarantine.findMany({ where: { proposalId } });
      return rows.map(quarantineRowToRecord);
    },
    byRun: async (runId) => {
      const rows = await db().miniAppQuarantine.findMany({ where: { runId } });
      return rows.map(quarantineRowToRecord);
    },
    byPack: async (packId) => {
      const rows = await db().miniAppQuarantine.findMany({ where: { packId } });
      return rows.map(quarantineRowToRecord);
    },
    olderThan: async (packId, cutoff) => {
      const rows = await db().miniAppQuarantine.findMany({
        where: { packId, movedAt: { lt: new Date(cutoff) }, restoredAt: null },
      });
      return rows.map(quarantineRowToRecord);
    },
    markRestored: async (id, at) => {
      await db().miniAppQuarantine.update({ where: { id }, data: { restoredAt: new Date(at) } });
    },
    delete: async (id) => {
      await db().miniAppQuarantine.delete({ where: { id } });
    },
    packIdsWithRecords: async () => {
      const rows = await db().miniAppQuarantine.findMany({ distinct: ['packId'], select: { packId: true } });
      return rows.map((row) => row.packId);
    },
  };

  const quarantineService = new QuarantineService(quarantineFs, quarantineStore, async () => app.getPath('userData'));

  const proposalStore: ProposalStore = {
    create: async (row) => {
      await db().miniAppProposal.create({
        data: {
          id: row.id, runId: row.runId, packId: row.packId, verb: row.verb, status: row.status,
          payload: row.payload as never, outcome: null as never, error: null,
          ...(row.resolvedAt !== null ? { resolvedAt: new Date(row.resolvedAt) } : {}),
        },
      });
    },
    get: async (id) => {
      const row = await db().miniAppProposal.findUnique({ where: { id } });
      return row ? proposalRowToView(row) : null;
    },
    update: async (id, patch) => {
      await db().miniAppProposal.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.outcome !== undefined ? { outcome: patch.outcome as never } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.resolvedAt !== undefined && patch.resolvedAt !== null ? { resolvedAt: new Date(patch.resolvedAt) } : {}),
        },
      });
    },
    pendingForRun: async (runId) => {
      const row = await db().miniAppProposal.findFirst({ where: { runId, status: 'pending' } });
      return row ? proposalRowToView(row) : null;
    },
  };

  const proposalRowToView = (row: {
    id: string; runId: string; packId: string; verb: string; status: string;
    payload: unknown; outcome: unknown; error: string | null; createdAt: Date; resolvedAt: Date | null;
  }): ProposalRow => ({
    id: row.id,
    runId: row.runId,
    packId: row.packId,
    verb: row.verb,
    status: row.status as ProposalRow['status'],
    payload: row.payload as ProposalRow['payload'],
    outcome: (row.outcome as ProposalRow['outcome']) ?? null,
    error: row.error,
    createdAt: Number(row.createdAt),
    resolvedAt: row.resolvedAt ? Number(row.resolvedAt) : null,
  });

  const proposalService = new ProposalService(proposalStore, quarantineService, runStore, {
    now: () => Date.now(),
    newId: () => randomUUID(),
  });

  const sandboxStore: SandboxStore = {
    createRun: async (row) => {
      await db().miniAppSandboxRun.create({
        data: {
          id: row.id, packId: row.packId, digest: row.digest, pid: row.pid, op: row.op, outcome: row.outcome,
          reason: row.reason, startedAt: new Date(row.startedAt), updatedAt: new Date(row.updatedAt),
          ...(row.finishedAt !== null ? { finishedAt: new Date(row.finishedAt) } : {}),
        },
      });
    },
    closeRun: async (id, outcome, reason, finishedAt) => {
      await db().miniAppSandboxRun.update({
        where: { id },
        data: { outcome, reason, finishedAt: new Date(finishedAt), updatedAt: new Date(finishedAt) },
      });
    },
    openRuns: async () => {
      const rows = await db().miniAppSandboxRun.findMany({ where: { finishedAt: null } });
      return rows.map((row) => ({
        id: row.id,
        packId: row.packId,
        digest: row.digest,
        pid: row.pid,
        op: row.op,
        outcome: row.outcome as SandboxRunRow['outcome'],
        reason: row.reason,
        startedAt: Number(row.startedAt),
        updatedAt: Number(row.updatedAt),
        finishedAt: row.finishedAt ? Number(row.finishedAt) : null,
      }));
    },
    appendCall: async (record) => {
      await db().miniAppSandboxCall.create({
        data: {
          packId: record.packId,
          digest: record.digest,
          method: record.method,
          argsHash: record.argsHash,
          callNumber: record.callNumber,
          ok: record.ok,
          errorCode: record.errorCode,
          durationMs: record.durationMs,
        },
      });
    },
  };

  const sandboxStateStore: SandboxStateStore = {
    get: async (packId, key) => {
      const row = await db().miniAppSandboxState.findUnique({ where: { packId_key: { packId, key } } });
      return (row?.value as unknown) ?? null;
    },
    all: async (packId) => {
      const rows = await db().miniAppSandboxState.findMany({ where: { packId } });
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },
    set: async (packId, key, value) => {
      await db().miniAppSandboxState.upsert({
        where: { packId_key: { packId, key } },
        create: { packId, key, value: value as never },
        update: { value: value as never },
      });
    },
  };

  const sandbox = new SandboxService({
    spawn: electronSandboxSpawn,
    childPath: () =>
      app.isPackaged
        ? join(process.resourcesPath, 'resources', 'sandbox-child.cjs')
        : join(app.getAppPath(), 'src', 'main', 'resources', 'sandbox-child.cjs'),
    workdir: (packId) => {
      const dir = join(app.getPath('userData'), 'mini-apps', 'work', packId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    resolveTarget: (packId) => {
      const base = registry.sandboxTarget(packId);
      if (!base) {
        return null;
      }
      const install = (configService.getConfig().miniApps.sourceInstalls ?? []).find((entry) => entry.extensionId === packId);
      if (!install?.contentDigest) {
        return null;
      }
      return {
        packId,
        manifest: base.manifest,
        contentPath: base.contentPath,
        manifestDigest: base.manifestDigest,
        contentDigest: install.contentDigest,
        config: base.config,
      };
    },
    selfDisable: (packId, reason) => registry.selfDisable(packId, reason),
    store: sandboxStore,
    stateStore: sandboxStateStore,
    secretGet: (packId, slot) => SecretService.getInstance().getSecret(`miniapp:${packId}:${slot}`),
    limits: () => resolveSandboxLimits(configService.getConfig().miniApps.sandbox),
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });

  app.on('will-quit', () => {
    for (const packId of sandbox.livePacks()) {
      sandbox.killPack(packId);
    }
  });

  const windowStore: MiniAppWindowStore = {
    create: async (row) => {
      await db().miniAppWindow.create({
        data: {
          id: row.id,
          packId: row.packId,
          runId: row.runId,
          closeReason: null,
          createdAt: new Date(row.openedAt),
        },
      });
    },
    markClosed: async (id, reason, at) => {
      await db().miniAppWindow.update({
        where: { id },
        data: { closeReason: reason, closedAt: new Date(at) },
      });
    },
  };

  const windows = createMiniAppWindowService({
    config: () => configService.getConfig(),
    packView: (packId) => {
      const view = registry.getState().packs.find((candidate) => candidate.id === packId);
      return view ? { enabled: view.enabled, ...(view.error ? { error: view.error } : {}), capabilities: view.capabilities, title: view.title } : null;
    },
    buildReportView: async (runId) => buildReportView(runId),
    store: windowStore,
    now: () => Date.now(),
    newId: () => randomUUID(),
  });

  const packTitle = (packId: string): string => {
    const view = registry.getState().packs.find((candidate) => candidate.id === packId);
    return view?.title ?? packId;
  };

  const runRowToView = (row: MiniAppRunRow): MiniAppRunView => ({
    id: row.id,
    packId: row.packId,
    packVersion: row.packVersion,
    rootPath: row.rootPath,
    status: row.status,
    totals: row.totals,
    estimateCalls: row.estimateCalls,
    actualCalls: row.actualCalls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    error: row.error,
    conversationId: row.conversationId,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  });

  const runService = new MiniAppRunService({
    store: runStore,
    runBridge,
    getPack: (packId) => {
      const pack = registry.runnablePack(packId);
      if (!pack) {
        return null;
      }
      const view = registry.getState().packs.find((candidate) => candidate.id === packId);
      const effective = view ? validatePackConfig(pack, view.configValues) : validatePackConfig(pack, undefined);
      return { pack, config: effective.ok ? effective.values : {}, title: view?.title ?? packId };
    },
    openFs: async (pack, root) => {
      try {
        return await capabilitiesFor(pack, capabilityDeps).fs(root);
      } catch (error) {
        if (error instanceof PackCapabilityError) {
          return { ok: false, error: error.error };
        }
        throw error;
      }
    },
    decideFor: (pack) => {
      try {
        return capabilitiesFor(pack, capabilityDeps).decide;
      } catch {
        return null;
      }
    },
    resolveEngineId: async () => {
      const config = configService.getConfig();
      const resolution = await resolveDecision('choice', config, deps.decisionEngineDeps());
      if (resolution.kind === 'systemone') {
        return { ok: true as const, engineId: `systemone:${resolution.provider.id}:${resolution.model.id}` };
      }
      if (resolution.kind === 'off') {
        return { ok: false as const, error: { code: 'not-ready', detail: { reason: 'no decision model is assigned' } } };
      }
      if (resolution.kind === 'unavailable' && resolution.code === 'needs-key') {
        return { ok: false as const, error: { code: 'needs-secret', detail: { reason: resolution.reason } } };
      }
      return { ok: false as const, error: { code: 'not-ready', detail: { reason: (resolution as { reason?: string }).reason ?? 'decision model unavailable' } } };
    },
    broadcast: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('miniapps:run-event', event);
      }
    },
    createConversation: async (title) => {
      const created = await conversationService.createConversation(title);
      return { id: created.id };
    },
    createRunMessage: async (conversationId, content, metadata) => {
      const message = await messageService.createMessage(content, stringToMessageRole('assistant'), conversationId, undefined, undefined, metadata as never);
      return { id: message.id };
    },
    updateRunMessage: async (messageId, content, metadata) => {
      await messageService.updateMessage(messageId, { content, metadata: metadata as never });
    },
    notify: (title, body) => {
      const behavior = configService.getConfig().behavior;
      if (behavior?.notifyOnComplete === false) {
        return;
      }
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    },
    packTitle,
    now: () => Date.now(),
    newId: () => randomUUID(),
  });

  const openRunFs = async (rootPath: string): Promise<{ statItem: (relative: string) => Promise<{ ok: true; size: number; mtimeMs: number; isFile: boolean } | { ok: false; error: PackError }>; rootPath: string } | null> => {
    const validated = await validateRunRoot(rootPath, fsEnv, nodePackFsDeps);
    if (!validated.ok) {
      return null;
    }
    const fs = new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps);
    return {
      rootPath: validated.value.root,
      statItem: async (relative) => {
        const result = await fs.statItem(relative);
        return result.ok
          ? { ok: true, size: result.value.size, mtimeMs: result.value.mtimeMs, isFile: result.value.isFile }
          : { ok: false, error: result.error };
      },
    };
  };

  const buildReportView = async (runId: string, itemCap = REPORT_DISPLAY_CAP): Promise<MiniAppRunReportView | null> => {
    const run = await runService.getRun(runId);
    if (!run) {
      return null;
    }
    const items = await runService.itemsOfRun(runId);
    const manifest = registry.runnablePack(run.packId)?.manifest;
    const labels: Record<string, string> = {};
    let reportNodes: unknown[] = [
      { id: 'status', type: 'badge', bind: 'run.status' },
      { id: 'totals', type: 'stat', bind: 'totals.scanned' },
      { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence', 'decidedBy'] },
      { id: 'ev', type: 'evidence' },
    ];
    if (manifest && manifest.kind === 'assessment' && manifest.report) {
      reportNodes = manifest.report.nodes;
      const locale = manifest.i18n.locales[manifest.i18n.defaultLocale] ?? {};
      for (const [key, value] of Object.entries(locale)) {
        if (key.startsWith('report.') || key.startsWith('rule.')) {
          labels[key] = value;
        }
      }
    }
    const mapped = items.map((item) => ({
      relPath: item.relPath,
      verdict: item.verdict,
      confidence: item.confidence,
      decidedBy: item.decidedBy,
      evidence: item.evidence,
    }));
    return {
      run: runRowToView(run),
      packTitle: packTitle(run.packId),
      items: itemCap > 0 ? mapped.slice(0, itemCap) : mapped,
      ...(itemCap > 0 && mapped.length > itemCap ? { itemsTruncated: mapped.length - itemCap } : {}),
      reportNodes,
      labels,
      canArm:
        manifest !== undefined &&
        manifest.kind === 'assessment' &&
        manifest.run.propose !== undefined &&
        manifest.capabilities.includes('fs-write-quarantine') &&
        !run.disallowArm,
      windowSupported: manifest !== undefined && manifest.capabilities.includes('ui:window'),
    };
  };

  const diffFor = async (runId: string): Promise<MiniAppRunDiffView | null> => {
    const run = await runService.getRun(runId);
    if (!run) {
      return null;
    }
    const latestItems = (await runService.itemsOfRun(runId)).map((item) => ({
      relPath: item.relPath,
      fingerprint: item.fingerprint,
      verdict: item.verdict,
    }));
    const prior = (await runService.recentRuns(run.packId, 50))
      .filter((candidate) => candidate.id !== runId && candidate.rootPath === run.rootPath && ['done', 'paused', 'interrupted', 'canceled'].includes(candidate.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const baseline = prior
      ? {
          runId: prior.id,
          finishedAt: prior.finishedAt,
          updatedAt: prior.updatedAt,
          items: (await runService.itemsOfRun(prior.id)).map((item) => ({
            relPath: item.relPath,
            fingerprint: item.fingerprint,
            verdict: item.verdict,
          })),
        }
      : null;
    const diff = diffRuns({ runId, finishedAt: run.finishedAt, updatedAt: run.updatedAt, items: latestItems }, baseline);
    return { runId, baselineRunId: diff.baselineRunId, entries: diff.entries };
  };

  const palettePacks = () =>
    registry
      .getState()
      .packs.filter((view) => (view.kind === 'assessment' || view.kind === 'surface') && !view.error)
      .map((view) => ({
        id: view.id,
        kind: view.kind,
        title: view.title,
        description: view.description ?? '',
        enabled: view.enabled,
        ...(view.kind === 'surface' && view.commands.length > 0 ? { commands: view.commands } : {}),
      }));

  const startRunFromPalette = async (packId: string): Promise<{ ok: true; text: string; conversationId: string | null } | { ok: false; error: string }> => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      return { ok: false as const, error: 'No window is available to pick a folder.' };
    }
    const { dialog } = await import('electron');
    const picked = await dialog.showOpenDialog(window, { title: TEXT.MINIAPPS_RUN_PICK_TITLE, properties: ['openDirectory'] });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false as const, error: 'cancelled' };
    }
    const started = await runService.start(packId, picked.filePaths[0], {});
    if (!started.ok) {
      return { ok: false as const, error: formatPackError(started.error) };
    }
    const run = await runService.getRun(started.runId);
    return {
      ok: true as const,
      text: interpolate(TEXT.MINIAPPS_RUN_STARTED_NOTICE, { title: packTitle(packId) }),
      conversationId: run?.conversationId ?? null,
    };
  };

  const buildLiveCardView = (packId: string): MiniAppLiveCardView | null => {
    const manifest = registry.runnablePack(packId)?.manifest;
    if (!manifest || manifest.kind !== 'assessment') {
      return null;
    }
    const schema = manifest.liveCard ?? DEFAULT_LIVE_CARD;
    const locale = manifest.i18n.locales[manifest.i18n.defaultLocale] ?? {};
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(locale)) {
      if (key.startsWith('live.')) {
        labels[key] = value;
      }
    }
    return { packId, nodes: schema.nodes, labels };
  };

  const installBundledPacks = async (restore = false): Promise<string[]> => {
    const installed = restore ? await registry.restoreBundled(ALL_BUNDLED_PACKS) : await registry.ensureBundled(ALL_BUNDLED_PACKS);
    const quarantinedIds = await quarantineStore.packIdsWithRecords().catch(() => [] as string[]);
    const installedIds = new Set(registry.getState().packs.map((view) => view.id));
    for (const packId of new Set([...installedIds, ...quarantinedIds])) {
      void quarantineService.pruneRetention(packId).catch(() => undefined);
    }
    return installed;
  };

  const init = (): void => {
    windows.reconcileBoot();
    void runService.reconcileBoot().catch((error) => console.error('Mini-app run reconciliation failed:', error));
    void installBundledPacks().catch((error) => console.error('Mini-app bundled install failed:', error));
  };

  return {
    registry,
    sources,
    sandbox,
    runService,
    proposalService,
    quarantineService,
    palettePacks,
    startRunFromPalette,
    packTitle,
    buildReportView,
    buildLiveCardView,
    buildRunStats: async (windowDays) => reduceRunStats(await runStore.allRuns(), windowDays, Date.now(), packTitle),
    runRowToView,
    diffFor,
    formatError: formatPackError,
    store: () => runStore,
    quarantineStore: () => quarantineStore,
    openRunFs,
    executeProposal: async (proposalId) => {
      const proposal = await proposalService.get(proposalId);
      if (!proposal) {
        return [];
      }
      const run = await runService.getRun(proposal.runId);
      if (!run) {
        return [];
      }
      const fs = await openRunFs(run.rootPath);
      if (!fs) {
        return [];
      }
      return proposalService.execute(proposalId, fs, (relative, size, mtimeMs) => runnerFingerprint(fs.rootPath, relative, size, mtimeMs));
    },
    restoreQuarantineRecord: async (recordId) => {
      const allPacks = await quarantineStore.packIdsWithRecords();
      for (const packId of allPacks) {
        const records = await quarantineStore.byPack(packId);
        const record = records.find((entry) => entry.id === recordId);
        if (record) {
          const result = await quarantineService.restore(record);
          return result.ok ? { ok: true, restoredPath: result.restoredPath } : { ok: false, error: formatPackError(result.error) };
        }
      }
      return { ok: false, error: 'Unknown quarantine record.' };
    },
    installBundled: installBundledPacks,
    windows,
    init,
    fsEnv,
  };
}
