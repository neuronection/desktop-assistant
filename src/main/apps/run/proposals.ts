import { join } from 'path';
import { PACK_HOST_SENSITIVE_BASELINE } from '@shared/app-pack';
import type { AssessmentPackManifest, PackError, ValidatedPack } from '@shared/app-pack';
import { globToRegex, matchesGlob } from '@main/ai/tools/native/file-search';
import type { QuarantineService } from '../quarantine';
import type { MiniAppRunItemRow, MiniAppRunRow, MiniAppRunStore } from './store';

export interface ProposalItem {
  relPath: string;
  fingerprint: string;
  verdict: string;
  confidence: number | null;
  category: string | null;
  evidence: Record<string, unknown> | null;
}

export interface ProposalPayload {
  items: ProposalItem[];
  minConfidence: number;
  sensitiveGlobs: string[];
}

export interface ProposalOutcomeItem {
  relPath: string;
  outcome: 'moved' | 'changed' | 'failed' | 'skipped' | 'ask';
  detail?: string;
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'aborted' | 'failed';

export interface ProposalRow {
  id: string;
  runId: string;
  packId: string;
  verb: string;
  status: ProposalStatus;
  payload: ProposalPayload;
  outcome: ProposalOutcomeItem[] | null;
  error: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ProposalStore {
  create(row: ProposalRow): Promise<void>;
  get(id: string): Promise<ProposalRow | null>;
  update(id: string, patch: Partial<Pick<ProposalRow, 'status' | 'outcome' | 'error' | 'resolvedAt'>>): Promise<void>;
  pendingForRun(runId: string): Promise<ProposalRow | null>;
}

export interface ProposalFsView {
  statItem(relative: string): Promise<{ ok: true; size: number; mtimeMs: number; isFile: boolean } | { ok: false; error: PackError }>;
  rootPath: string;
}

export type ArmResult =
  | { ok: true; proposal: ProposalRow }
  | { ok: false; error: PackError };

export type ResolveResult = { ok: true; executed: boolean } | { ok: false; error: PackError };

/**
 * HITL Class-B arming (plan 26 S6, ADR-0015 Tier 1 floor): assessment
 * and arming are separate phases; the fail-closed gate (confidence ∧ no
 * exception ∧ no sensitive glob) runs at ARM time and every item is
 * re-validated at EXECUTION time in the same per-item-atomic operation
 * that moves it. Resolution is idempotent (second responder = no-op);
 * batches execute sequentially and fail soft; side effects arm only
 * from the user's act — never from model output.
 */
export class ProposalService {
  private readonly aborting = new Set<string>();

  constructor(
    private readonly proposals: ProposalStore,
    private readonly quarantine: QuarantineService,
    private readonly runs: MiniAppRunStore,
    private readonly deps: { now(): number; newId(): string }
  ) {}

  /** The fail-closed gate + proposal creation (no side effects yet). */
  async arm(pack: ValidatedPack, run: MiniAppRunRow, items: MiniAppRunItemRow[], fs: ProposalFsView): Promise<ArmResult> {
    const manifest = pack.manifest as AssessmentPackManifest;
    const propose = manifest.run.propose;
    if (!propose || !manifest.capabilities.includes('fs-write-quarantine')) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'pack declares no arming' } } };
    }
    if (await this.proposals.pendingForRun(run.id)) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'a proposal is already pending for this run' } } };
    }
    const sensitive = [...new Set([...manifest.privacy.sensitiveGlobs, ...PACK_HOST_SENSITIVE_BASELINE])];
    const minConfidence = propose.gate.minConfidence;
    const gated: ProposalItem[] = [];
    for (const item of items) {
      if (item.verdict !== 'candidate') {
        continue;
      }
      if (item.confidence !== null && item.confidence < minConfidence) {
        continue;
      }
      if (sensitive.some((glob) => matchesGlob(item.relPath, globToRegex(glob), glob.includes('/')))) {
        continue;
      }
      gated.push({
        relPath: item.relPath,
        fingerprint: item.fingerprint,
        verdict: item.verdict,
        confidence: item.confidence,
        category: categoryOf(item, propose.groupBy),
        evidence: item.evidence,
      });
    }
    if (gated.length === 0) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'no items pass the arming gate' } } };
    }
    const row: ProposalRow = {
      id: this.deps.newId(),
      runId: run.id,
      packId: run.packId,
      verb: propose.verb,
      status: 'pending',
      payload: { items: gated, minConfidence, sensitiveGlobs: sensitive },
      outcome: null,
      error: null,
      createdAt: this.deps.now(),
      resolvedAt: null,
    };
    await this.proposals.create(row);
    return { ok: true, proposal: row };
  }

  /** Idempotent resolution (ADR-0015): the second responder is a no-op. */
  async resolve(proposalId: string, approve: boolean): Promise<ResolveResult> {
    const proposal = await this.proposals.get(proposalId);
    if (!proposal) {
      return { ok: false, error: { code: 'not-found', detail: { id: proposalId } } };
    }
    if (proposal.status !== 'pending') {
      return { ok: true, executed: false };
    }
    if (!approve) {
      await this.proposals.update(proposalId, { status: 'rejected', resolvedAt: this.deps.now() });
      return { ok: true, executed: false };
    }
    await this.proposals.update(proposalId, { status: 'approved', resolvedAt: this.deps.now() });
    return { ok: true, executed: true };
  }

  abort(proposalId: string): void {
    this.aborting.add(proposalId);
  }

  private isAborting(proposalId: string): boolean {
    return this.aborting.has(proposalId);
  }

  /**
   * Revalidate-and-move: ONE main-side operation per item — fingerprint
   * re-computed from the live file; a changed item drops to `ask`.
   * Sequential, fail-soft: an error stops the batch, already-moved items
   * stay restorable, pending items record as skipped.
   */
  async execute(proposalId: string, fs: ProposalFsView, fingerprintFor: (relative: string, size: number, mtimeMs: number) => string): Promise<ProposalOutcomeItem[]> {
    const proposal = await this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'approved') {
      return [];
    }
    const outcome: ProposalOutcomeItem[] = [];
    const movedItems: { relPath: string; originPath: string; quarantinePath: string; fingerprintAtArm: string; movedAt: number }[] = [];
    let stopped = false;
    for (const item of proposal.payload.items) {
      if (stopped || this.isAborting(proposalId)) {
        outcome.push({ relPath: item.relPath, outcome: 'skipped' });
        await this.runs.updateItemVerdict(proposal.runId, item.relPath, 'ask', 'arm:skipped');
        continue;
      }
      const stats = await fs.statItem(item.relPath);
      if (!stats.ok) {
        outcome.push({ relPath: item.relPath, outcome: 'ask', detail: 'vanished or unreadable' });
        await this.runs.updateItemVerdict(proposal.runId, item.relPath, 'ask', 'arm:changed');
        continue;
      }
      const current = fingerprintFor(item.relPath, stats.size, stats.mtimeMs);
      if (current !== item.fingerprint) {
        outcome.push({ relPath: item.relPath, outcome: 'changed', detail: 'changed after assessment — back to ask' });
        await this.runs.updateItemVerdict(proposal.runId, item.relPath, 'ask', 'arm:changed');
        continue;
      }
      const moved = await this.quarantine.moveOne({
        proposalId,
        packId: proposal.packId,
        runId: proposal.runId,
        originPath: join(fs.rootPath, ...item.relPath.split(/[\\/]/)),
        relPath: item.relPath,
        expectedFingerprintAtArm: item.fingerprint,
        currentFingerprint: current,
        currentIsFile: stats.isFile,
      });
      if (!moved.ok) {
        if (moved.error.code === 'io') {
          outcome.push({ relPath: item.relPath, outcome: 'failed', detail: JSON.stringify(moved.error.detail) });
          stopped = true;
          continue;
        }
        outcome.push({ relPath: item.relPath, outcome: 'ask', detail: JSON.stringify(moved.error.detail) });
        await this.runs.updateItemVerdict(proposal.runId, item.relPath, 'ask', 'arm:changed');
        continue;
      }
      outcome.push({ relPath: item.relPath, outcome: 'moved' });
      movedItems.push({
        relPath: item.relPath,
        originPath: moved.record.originPath,
        quarantinePath: moved.record.quarantinePath,
        fingerprintAtArm: item.fingerprint,
        movedAt: moved.record.movedAt,
      });
      await this.runs.updateItemVerdict(proposal.runId, item.relPath, 'keep', 'quarantined');
    }
    if (movedItems.length > 0) {
      await this.quarantine.writeManifest({
        proposalId,
        packId: proposal.packId,
        runId: proposal.runId,
        items: movedItems,
      });
    }
    const status: ProposalStatus = this.isAborting(proposalId) ? 'aborted' : stopped ? 'failed' : 'executed';
    this.aborting.delete(proposalId);
    await this.proposals.update(proposalId, { status, outcome });
    return outcome;
  }

  async restoreItem(runId: string, relPath: string): Promise<{ ok: true; restoredPath: string } | { ok: false; error: PackError }> {
    return this.quarantine.restoreItem(runId, relPath);
  }

  async restoreBatch(proposalId: string): Promise<{ ok: true; restored: number } | { ok: false; error: PackError }> {
    const records = await this.quarantine.recordsByProposal(proposalId);
    const ordered = [...records].sort((a, b) => b.movedAt - a.movedAt);
    let restored = 0;
    for (const record of ordered) {
      const result = await this.quarantine.restore(record);
      if (result.ok) {
        restored += 1;
      }
    }
    return { ok: true, restored };
  }

  pendingForRun(runId: string): Promise<ProposalRow | null> {
    return this.proposals.pendingForRun(runId);
  }

  get(proposalId: string): Promise<ProposalRow | null> {
    return this.proposals.get(proposalId);
  }
}

function categoryOf(item: MiniAppRunItemRow, groupBy: string | undefined): string | null {
  if (!groupBy) {
    return null;
  }
  const evidence = item.evidence;
  if (!evidence || typeof evidence !== 'object') {
    return null;
  }
  const answers = (evidence as { answers?: Record<string, unknown> }).answers;
  if (!answers || typeof answers !== 'object') {
    return null;
  }
  if (groupBy.startsWith('answer.')) {
    const rest = groupBy.slice(7);
    const dot = rest.indexOf('.');
    if (dot <= 0) {
      return null;
    }
    const answer = answers[rest.slice(0, dot)];
    if (!answer || typeof answer !== 'object') {
      return null;
    }
    const part = rest.slice(dot + 1);
    if (part === 'choice') {
      const choice = (answer as { choice?: unknown }).choice;
      return typeof choice === 'string' ? choice : null;
    }
    return null;
  }
  return null;
}
