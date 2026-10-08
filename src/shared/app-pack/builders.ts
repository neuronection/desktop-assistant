import type {
  AssessmentPackManifest,
  PackClassifyRule,
  PackClassifyStep,
  PackComposeStep,
  PackCondition,
  PackConfigSchema,
  PackDecideStep,
  PackI18n,
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
  config(schema: PackConfigSchema): PackConfigSchema {
    return schema;
  },
  i18n(defaultLocale: string, locales: PackI18n['locales']): PackI18n {
    return { defaultLocale, locales };
  },
};

export type { PackManifestBase, PackPrivacy };
