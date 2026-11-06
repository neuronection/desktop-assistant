import { globToRegex, matchesGlob, parseRuleEntry } from '@shared/app-pack/policy';
import type { MiniAppRuleImpactList, MiniAppRuleImpactView } from '@shared/app-pack';
import type { MiniAppRunItemRow } from './store';

export type { MiniAppRuleImpactList, MiniAppRuleImpactView };

export interface ImpactRuleSet {
  keep: string[];
  review: string[];
  junk: string[];
}

const SAMPLE_CAP = 10;

interface ImpactListSpec {
  configKey: string;
  ruleId: string;
  direction: MiniAppRuleImpactList['direction'];
  entries: string[];
  flipsFrom: MiniAppRunItemRow['verdict'][];
}

function ageDaysOf(item: MiniAppRunItemRow): number | null {
  const meta = item.evidence?.meta as { ageDays?: unknown } | undefined;
  return typeof meta?.ageDays === 'number' ? meta.ageDays : null;
}

/**
 * Draft-rule replay (plan 51 S2.6): re-evaluates the draft user rule
 * lists over a run's stored items with the shared policy semantics.
 * Overridden and host-sensitive items never flip (the user decision and
 * the baseline outrank rules); items whose evidence predates
 * evidence.meta count as unverifiable for `:days` entries — the age
 * check is the one thing that cannot replay.
 */
export function replayRuleImpact(
  runId: string | null,
  items: MiniAppRunItemRow[],
  draft: ImpactRuleSet
): MiniAppRuleImpactView {
  const specs: ImpactListSpec[] = [
    { configKey: 'keepRules', ruleId: 'user-keep', direction: 'to-keep', entries: draft.keep, flipsFrom: ['ask', 'candidate'] },
    { configKey: 'reviewRules', ruleId: 'user-review', direction: 'to-ask', entries: draft.review, flipsFrom: ['keep', 'candidate'] },
    { configKey: 'junkRules', ruleId: 'user-junk', direction: 'to-candidate-queue', entries: draft.junk, flipsFrom: ['keep'] },
  ];
  const results = specs.map((spec) => ({ spec, count: 0, samples: [] as string[] }));
  let unverifiable = 0;
  for (const item of items) {
    if (item.decidedBy === 'rule:host-sensitive' || item.decidedBy.startsWith('override:')) {
      continue;
    }
    const ageDays = ageDaysOf(item);
    let itemUnverifiable = false;
    for (const result of results) {
      const outcome = evaluateImpactList(result.spec.entries, item.relPath, ageDays);
      if (outcome === 'match') {
        if (result.spec.flipsFrom.includes(item.verdict)) {
          result.count += 1;
          if (result.samples.length < SAMPLE_CAP) {
            result.samples.push(item.relPath);
          }
        }
        break;
      } else if (outcome === 'unverifiable') {
        itemUnverifiable = true;
      }
    }
    if (itemUnverifiable) {
      unverifiable += 1;
    }
  }
  return {
    runId,
    totalItems: items.length,
    lists: results.map(({ spec, count, samples }) => ({
      configKey: spec.configKey,
      ruleId: spec.ruleId,
      direction: spec.direction,
      count,
      samples,
    })),
    unverifiable,
  };
}

function evaluateImpactList(entries: string[], relPath: string, ageDays: number | null): 'match' | 'no-match' | 'unverifiable' {
  let ageUnknown = false;
  for (const entry of entries) {
    const parsed = parseRuleEntry(entry);
    if (!matchesGlob(relPath, globToRegex(parsed.glob), parsed.glob.includes('/'))) {
      continue;
    }
    if (parsed.minAgeDays === null) {
      return 'match';
    }
    if (ageDays === null) {
      ageUnknown = true;
      continue;
    }
    if (ageDays >= parsed.minAgeDays) {
      return 'match';
    }
  }
  return ageUnknown ? 'unverifiable' : 'no-match';
}
