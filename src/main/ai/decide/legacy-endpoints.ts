/**
 * Pre-plan-26 named Jev endpoints (`config.decision.jev`). The settings
 * surface is retired (plan 26 S2); these constants exist only so the
 * one-time migration can map a stored endpoint onto a provider row.
 */
export const JEV_BASE_URLS: Record<'openrouter' | 'typesafe', string> = {
  openrouter: 'https://openrouter.ai/api',
  typesafe: 'https://api.typesafe.ai',
};
