import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { scopeDiff as scopeDiffShared, type ConnectorProtocol } from '@shared/connectors';
import { bundledClientId, bundledClientSecret } from './bundledClientIds';

// The vendored family catalog (ADR-0052 §1) is the single source of provider
// rows: endpoints, verbatim scopes, destination domains. This host renders it
// and keys adapters by protocol — it never hand-writes a provider or a scope.

export interface ProviderServiceConfig {
  protocol: ConnectorProtocol;
  apiBase?: string;
  pathTemplate?: string;
  writable: boolean;
  scopes: { read: string[]; write: string[] };
  /** Rev 6: the bind form renders ONLY from this — never a provider branch. */
  setupFields?: SetupField[];
}

export interface SetupField {
  key: string;
  kind: 'url' | 'text' | 'secret' | 'calendar';
  required: boolean;
  labelKey: string;
  placeholder?: string | null;
  autocomplete?: string | null;
  authKind?: string | null;
  manualKey?: string | null;
}

export interface ProviderRow {
  id: string;
  label: string;
  services: string[];
  authKinds: string[];
  oauth?: {
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl: string | null;
    extraAuthParams: Record<string, string>;
  };
  domains: string[];
  serviceConfig: Record<string, ProviderServiceConfig | undefined>;
}

export interface ProviderCatalog {
  schemaVersion: number;
  providers: ProviderRow[];
}

/**
 * Where a provider's public client id comes from (host/deployment config,
 * ADR-0042 clause 5): a NAMING CONVENTION over the catalog row id, never a
 * hand-written provider map — adding an OAuth provider is one catalog row
 * and setting its env var, with no code change (plan 52 §12 rule 1).
 * `google` → `DESKTOP_GOOGLE_CLIENT_ID`, `microsoft` → `DESKTOP_MICROSOFT_CLIENT_ID`.
 */
export function clientIdEnvFor(providerId: string, prefix: string = 'DESKTOP'): string {
  // Mirrors `cloud_providers.client_id_env` — the naming convention is
  // contract data (`catalog.clientIdEnv`), never a per-provider lookup.
  return `${prefix.toUpperCase()}_${providerId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')}_CLIENT_ID`;
}

export function catalogPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'contracts', 'cloud-providers.json');
  }
  return join(app.getAppPath(), 'contracts', 'cloud-providers.json');
}

export function loadProviderCatalog(): ProviderCatalog {
  const path = catalogPath();
  if (!existsSync(path)) {
    throw new Error(`Vendored provider catalog missing at ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ProviderCatalog;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported cloud-providers catalog schemaVersion ${parsed.schemaVersion}`);
  }
  return parsed;
}

export function calendarProviderRow(catalog: ProviderCatalog, providerId: string): ProviderRow | null {
  const row = catalog.providers.find((entry) => entry.id === providerId);
  if (!row || !row.serviceConfig.calendar) {
    return null;
  }
  return row;
}

export function calendarScopes(row: ProviderRow): { read: string[]; write: string[] } {
  return row.serviceConfig.calendar?.scopes ?? { read: [], write: [] };
}

/**
 * The OAuth client id for a provider, in resolution order:
 *
 * 1. the environment (`DESKTOP_<ID>_CLIENT_ID`) — self-hosters and forks;
 * 2. the **bundled family-registered id** — the shipped build (ADR-0042 §5,
 *    the GNOME Online Accounts model: the user just clicks "Sign in");
 * 3. `null` — `needs-config`, surfaced honestly rather than as a crash.
 *
 * Env wins so an operator can point a build at their own registration
 * without recompiling; the bundled id is what makes the out-of-the-box path
 * work with no cloud console.
 */
export function clientIdFor(row: ProviderRow, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env[clientIdEnvFor(row.id)]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return bundledClientId(row.id);
}

/**
 * The token-endpoint client value, when the provider demands one.
 *
 * Only Google does for "Desktop app" clients — documented Optional but
 * required in practice, and documented non-confidential for installed apps
 * (see `bundledClientIds.ts`). Microsoft's public client needs none, so this
 * returns `null` for it and the exchange stays pure PKCE. The env override
 * (`DESKTOP_<ID>_CLIENT_SECRET`) exists for self-hosters who registered their
 * own client.
 */
export function clientSecretFor(row: ProviderRow, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env[clientIdEnvFor(row.id).replace('_CLIENT_ID', '_CLIENT_SECRET')]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return bundledClientSecret(row.id);
}

/**
 * Consent growth (ADR-0042 clause 4): requested vs granted scopes → what is
 * added and what is removed. Lives in `@shared/connectors` (both the bind UI
 * and main need it); re-exported here for the main-side callers. Pinned to
 * the family fixture wall (`catalog.scopeGrowth`) — growth re-consents and
 * removals are shown, never silent.
 */
export const scopeDiff: (granted: string[], requested: string[]) => { added: string[]; removed: string[] } = scopeDiffShared;
