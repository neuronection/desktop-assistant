/**
 * Keyring key convention for source credential slots (plan 32 Phase 8,
 * D22): slot REFERENCES ride the descriptor; values live only here —
 * `ext-source:<slot>` in the SecretService store, resolved at fetch time
 * into the git subprocess environment, never into argv or logs.
 */
export const extensionSourceSecretKey = (slot: string): string => `ext-source:${slot}`;
