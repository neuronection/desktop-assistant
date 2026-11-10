/**
 * Beta feature tags (plan 71): one registry of features that ship tagged
 * "beta" in the UI. The tag is presentation only — it never gates behavior;
 * an unlisted feature is simply not beta. Ids are namespaced so a pack id can
 * never collide with a host feature.
 */

export const BETA_FEATURE_IDS = ['mini-app:file-deletion-review'] as const;

export type BetaFeatureId = (typeof BETA_FEATURE_IDS)[number];

export function isBetaFeature(id: string): id is BetaFeatureId {
  return (BETA_FEATURE_IDS as readonly string[]).includes(id);
}

/** The beta tag for an installed mini-app pack, or null when the pack is not tagged. */
export function betaFeatureForPack(packId: string): BetaFeatureId | null {
  const id = `mini-app:${packId}`;
  return isBetaFeature(id) ? id : null;
}
