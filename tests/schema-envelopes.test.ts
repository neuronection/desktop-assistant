import { describe, expect, it } from 'vitest';
import { parseAttachmentList, validateAttachmentList } from '@shared/schema/attachmentList';
import { parseCommandArgs, validateCommandArgs } from '@shared/schema/commandArgs';
import { parseConversationMetadata, validateConversationMetadata } from '@shared/schema/conversationMetadata';
import { parseImagePathList } from '@shared/schema/imagePathList';
import { parseMemoryProvenance } from '@shared/schema/memoryProvenance';
import { parseMemoryTags } from '@shared/schema/memoryTags';
import { parseMiniAppItemEvidence } from '@shared/schema/miniAppItemEvidence';
import {
  parseMiniAppProposalOutcome,
  parseMiniAppProposalPayload,
  validateMiniAppProposalPayload,
} from '@shared/schema/miniAppProposal';
import { parseMiniAppRunTotals, validateMiniAppRunTotals } from '@shared/schema/miniAppRunTotals';
import { parseSandboxStateValue } from '@shared/schema/sandboxStateValue';
import { parseScheduleSpec } from '@shared/schema/scheduleSpec';
import { parseTurnMetadata, validateTurnMetadata } from '@shared/schema/turnMetadata';
import { notificationPayloadSchema } from '@shared/schema/notificationPayload';
import { automationTriggerSchema } from '@shared/schema/automationTrigger';
import { automationActionSchema } from '@shared/schema/automationAction';
import { connectorScopesSchema } from '@shared/schema/connectorScopes';

describe('JSON envelope registry (plan 36 S2, D3)', () => {
  it('turnMetadata round-trips unknown fields and rejects an invalid outcome on write', () => {
    const value = {
      outcome: 'ok',
      model: 'test-model',
      durationMs: 123,
      steps: [{ id: 's1', phase: 'thinking', label: 'Thinking', startedAt: 1, futureField: 'kept' }],
      nodeTimeline: [{ node: 'model_request', outcome: 'done', durationMs: 10, resumed: false, futureNode: true }],
      artifacts: [{ kind: 'file', path: '/tmp/out.txt', name: 'out.txt', sizeBytes: 3, futureArtifact: 1 }],
      decision: { engine: 'systemone', confidence: 0.9, band: 'act', futureDecision: true },
      miniAppRun: {
        runId: 'run-1',
        packId: 'pack',
        packTitle: 'Pack',
        status: 'done',
        rootPath: '/tmp',
        futureRun: 'kept',
      },
      futureTop: { nested: true },
    };
    const parsed = parseTurnMetadata(value);
    expect(parsed).toMatchObject({ outcome: 'ok', futureTop: { nested: true } });
    expect((parsed?.steps?.[0] as Record<string, unknown>)?.futureField).toBe('kept');
    expect(() => validateTurnMetadata({ outcome: 'running' })).toThrow(/outcome/);
    expect(() => validateTurnMetadata({ model: 'no outcome at all' })).not.toThrow();
  });

  it('attachmentList round-trips every attachment arm and unknown fields', () => {
    const attachments = [
      { type: 'image', data: 'data:image/png;base64,AA', future: 1 },
      { type: 'screen-capture', data: 'data:image/png;base64,BB', sourceId: 'window:1', future: 2 },
      { type: 'pdf', data: 'data:application/pdf;base64,CC', filename: 'a.pdf', extractedText: 'text', future: 3 },
    ];
    const parsed = parseAttachmentList(attachments);
    expect(parsed).toHaveLength(3);
    expect((parsed[0] as Record<string, unknown>).future).toBe(1);
    expect(parseAttachmentList([{ type: 'video', data: 'x' }])).toEqual([]);
    expect(() => validateAttachmentList([{ type: 'image' }])).toThrow(/Invalid attachment list/);
  });

  it('conversationMetadata round-trips unknown fields', () => {
    const parsed = parseConversationMetadata({ modelId: 'm', speakReplies: true, future: 'kept' });
    expect(parsed).toMatchObject({ modelId: 'm', speakReplies: true, future: 'kept' });
    expect(() => validateConversationMetadata('nope')).toThrow();
  });

  it('scheduleSpec accepts every kind and preserves extras on read', () => {
    expect(parseScheduleSpec({ kind: 'interval', minutes: 15, future: true })?.kind).toBe('interval');
    expect(parseScheduleSpec({ kind: 'daily', time: '09:00', future: true })?.kind).toBe('daily');
    expect(parseScheduleSpec({ kind: 'weekly', days: [1, 3], time: '08:30', future: true })?.kind).toBe('weekly');
    expect(parseScheduleSpec({ kind: 'cron', expr: '* * * * *', future: true })?.kind).toBe('cron');
    expect(parseScheduleSpec({ kind: 'nope' })).toBeNull();
  });

  it('memory tags/provenance and image paths parse leniently', () => {
    expect(parseMemoryTags(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseMemoryTags('nope')).toEqual([]);
    const provenance = parseMemoryProvenance([
      { id: 'm1', content: 'old', source: 'user', mergedAt: '2026-01-01T00:00:00.000Z', future: 1 },
    ]);
    expect(provenance[0].id).toBe('m1');
    expect((provenance[0] as Record<string, unknown>).future).toBe(1);
    expect(parseImagePathList(['a.png'])).toEqual(['a.png']);
    expect(parseImagePathList(null)).toEqual([]);
  });

  it('commandArgs round-trips argv and accepts the stored string form on read', () => {
    expect(parseCommandArgs({ argv: ['2+2'], future: 1 })).toMatchObject({ argv: ['2+2'], future: 1 });
    expect(parseCommandArgs(JSON.stringify({ argv: ['/tr', 'el'] }))).toEqual({ argv: ['/tr', 'el'] });
    expect(() => validateCommandArgs({ argv: 'nope' })).toThrow();
  });

  it('miniApp run totals/evidence round-trip unknown fields', () => {
    const totals = { scanned: 1, keep: 2, ask: 3, candidate: 4, ruleDecided: 5, modelDecided: 6, cacheHits: 7, pending: 8, future: true };
    const parsed = parseMiniAppRunTotals(totals);
    expect(parsed).toMatchObject({ scanned: 1, future: true });
    expect(() => validateMiniAppRunTotals({ scanned: 1 })).toThrow();
    expect(parseMiniAppItemEvidence({ rule: 'fresh', future: 1 })).toMatchObject({ rule: 'fresh', future: 1 });
  });

  it('miniApp proposal payload carries v and preserves unknown fields; outcome parses leniently', () => {
    const payload = validateMiniAppProposalPayload({
      items: [{ relPath: 'a', fingerprint: 'f', verdict: 'candidate', confidence: 0.9, category: 'x', evidence: null, future: 1 }],
      minConfidence: 0.8,
      sensitiveGlobs: ['*.key'],
      future: 'kept',
    });
    expect(payload.v).toBe(1);
    expect((payload as unknown as Record<string, unknown>).future).toBe('kept');
    expect(parseMiniAppProposalPayload({ v: 1, items: [], minConfidence: 0, sensitiveGlobs: [], future: true })?.v).toBe(1);
    expect(parseMiniAppProposalOutcome([{ relPath: 'a', outcome: 'moved', future: 1 }])?.[0]).toMatchObject({ outcome: 'moved' });
    expect(parseMiniAppProposalOutcome({ nope: true })).toBeNull();
  });

  it('sandbox state values are opaque and notifications/automations/connector scopes round-trip', () => {
    expect(parseSandboxStateValue({ any: ['value'] })).toEqual({ any: ['value'] });
    expect(notificationPayloadSchema.parse({ runId: 'r', future: 1 })).toMatchObject({ runId: 'r', future: 1 });
    expect(automationTriggerSchema.parse({ kind: 'fs', future: 1 })).toMatchObject({ kind: 'fs', future: 1 });
    expect(automationActionSchema.parse({ kind: 'turn', future: 1 })).toMatchObject({ kind: 'turn', future: 1 });
    expect(connectorScopesSchema.parse(['read', 'future'])).toEqual(['read', 'future']);
  });
});
