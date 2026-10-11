import type {
  AssessmentPackManifest,
  PackClassifyRule,
  PackClassifyStep,
  PackComposeStep,
  PackCondition,
  PackConfigSchema,
  PackDecideStep,
  PackI18n,
  PackLiveCardSchema,
  PackManifestBase,
  PackManifest,
  PackPipeline,
  PackPrivacy,
  PackProposeStep,
  PackReportSchema,
  PackScanStep,
  SurfacePackManifest,
} from './types';

/**
 * SDK builders (plan 26 S1): a pack is the serialized form of these
 * helpers. Pure data in, pure data out — no validation side effects;
 * authors run `validate` (or the CLI) on the result.
 */

export type PackInput = Omit<AssessmentPackManifest, 'run'> & { run: PipelineInput } | SurfacePackManifest;

export interface PipelineInput {
  scan?: PackScanStep;
  classify?: PackClassifyStep;
  decide?: PackDecideStep;
  compose?: PackComposeStep;
  propose?: PackProposeStep;
}

export function definePack(pack: PackInput): PackManifest {
  if (pack.kind === 'surface') {
    return { ...(pack as SurfacePackManifest) };
  }
  const assessment = pack as Omit<AssessmentPackManifest, 'run'> & { run?: PipelineInput };
  const pipeline: PackPipeline = {
    scan: assessment.run?.scan ?? {},
    classify: assessment.run?.classify ?? {},
    compose: assessment.run?.compose ?? {},
    ...(assessment.run?.decide ? { decide: assessment.run.decide } : {}),
    ...(assessment.run?.propose ? { propose: assessment.run.propose } : {}),
  };
  return { ...assessment, run: pipeline };
}

export function question(
  input: { id: string; instructions: string } & (
    | { type: 'noul'; criteria?: { true: string; false: string } }
    | { type: 'choice'; options: Record<string, string | null> }
    | { type: 'score'; levels: string[] }
  )
): PackDecideStep['questions'][number] {
  return input as PackDecideStep['questions'][number];
}

export function rule(id: string, when: PackCondition, note?: string): PackClassifyRule {
  return { id, when, ...(note ? { note } : {}) };
}

export const run = {
  scan(step: PackScanStep = {}): PackScanStep {
    return step;
  },
  classify(step: PackClassifyStep = {}): PackClassifyStep {
    return step;
  },
  decide(step: PackDecideStep): PackDecideStep {
    return step;
  },
  compose(step: PackComposeStep = {}): PackComposeStep {
    return step;
  },
  propose(step: PackProposeStep): PackProposeStep {
    return step;
  },
};

export const ui = {
  report(schema: PackReportSchema): PackReportSchema {
    return schema;
  },
  liveCard(schema: PackLiveCardSchema): PackLiveCardSchema {
    return schema;
  },
  config(schema: PackConfigSchema): PackConfigSchema {
    return schema;
  },
  i18n(defaultLocale: string, locales: PackI18n['locales']): PackI18n {
    return { defaultLocale, locales };
  },
};

/**
 * The live run card every assessment pack gets when the manifest
 * declares no `liveCard` (plan 28 D3): status, progress, verdict
 * tallies. Labels resolve host-side (`live.<id>` i18n keys with bind
 * fallback) so the default stays zero-config.
 */
export const DEFAULT_LIVE_CARD: PackLiveCardSchema = {
  nodes: [
    { id: 'status', type: 'badge', bind: 'run.status' },
    { id: 'progress', type: 'progress', bind: 'progress' },
    { id: 'scanned', type: 'stat', bind: 'totals.scanned' },
    { id: 'keep', type: 'stat', bind: 'totals.keep' },
    { id: 'ask', type: 'stat', bind: 'totals.ask' },
    { id: 'candidate', type: 'stat', bind: 'totals.candidate' },
  ],
};

export type { PackManifestBase, PackPrivacy };
