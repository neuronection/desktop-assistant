// Family cloud connectors (ADR-0052 / plan 52 P3): shared view types for the
// Settings → Calendar surface. Metadata only — no view ever carries a code,
// a token or any secret material (ADR-0042 clause 3).

/**
 * The family marker category every projected event carries (ADR-0052 §6/E8).
 * It is both the user's filter handle and the attribution signal: Google has
 * no categories field, so it rides `extendedProperties.private.nxCategories`
 * there and a real CATEGORIES field on CalDAV/Graph — read back as
 * `categories` on all three.
 */
export const SOURCE_CATEGORY = 'NEURONECTION';

/**
 * The inbound law (ADR-0052 §6/E8): a remote event may become a local record
 * ONLY when it is attributable — the marker category, a uid a host minted, or
 * an existing link row. A title that merely looks relevant is a suggestion
 * the user confirms, never a record.
 */
export function isAttributable(
  event: { uid?: string; categories?: string[] },
  namespaces: readonly string[] = [],
): boolean {
  const categories = (event.categories ?? []).map((value) => String(value).toUpperCase());
  if (categories.includes(SOURCE_CATEGORY)) {
    return true;
  }
  const uid = event.uid ?? '';
  return namespaces.some((namespace) => uid.startsWith(namespace));
}

export type ConnectorStatus =
  | 'ok'
  | 'degraded'
  | 'failing'
  | 'stale'
  | 'needs-auth'
  | 'needs-secret'
  | 'needs-config';

export const CONNECTOR_BINDABLE_PROTOCOLS = ['google-calendar', 'graph-calendar'] as const;
export type ConnectorProtocol = 'caldav' | 'google-calendar' | 'graph-calendar' | 'ics';

export interface CalendarProviderView {
  id: string;
  label: string;
  protocol: ConnectorProtocol;
  bindable: boolean;
  clientIdConfigured: boolean;
  clientIdEnv: string | null;
  /** Verbatim provider scope strings — consent data, never paraphrased. */
  scopesRead: string[];
  scopesWrite: string[];
  /** Token-bearing destination hosts, verbatim from the family catalog. */
  domains: string[];
  /**
   * The bind form renders ONLY from this (ADR-0052 §11 / Rev 6) — a new
   * provider with an existing protocol needs no UI change.
   */
  setupFields: SetupFieldView[];
}

export interface SetupFieldView {
  key: string;
  kind: 'url' | 'text' | 'secret' | 'calendar';
  required: boolean;
  labelKey: string;
  placeholder?: string | null;
  autocomplete?: string | null;
  authKind?: string | null;
  manualKey?: string | null;
}

export interface CalendarCatalogView {
  providers: CalendarProviderView[];
  /** Providers the v1 slice cannot bind yet (CalDAV/ICS) — shown as next. */
  upcoming: { id: string; label: string; protocol: string }[];
}

export interface ConnectorAccountView {
  id: string;
  provider: string;
  providerLabel: string;
  protocol: ConnectorProtocol;
  label: string;
  authKind: string;
  status: ConnectorStatus;
  /** Advisory token expiry (ISO) — the secret store holds the truth. */
  expiresAt: string | null;
  scopes: string[];
  consecutiveFailures: number;
  /**
   * Whether the provider exposes a revoke endpoint (consent honesty, plan 52
   * H/E12): unbind copy for a non-revocable provider must not claim the
   * grant was revoked — it is only forgotten on this device.
   */
  revocable: boolean;
}

export type ConnectorBindState = 'idle' | 'waiting' | 'completed' | 'failed';

export interface ConnectorBindStatusView {
  providerId: string;
  state: ConnectorBindState;
  accountId: string | null;
  code: string | null;
  error: string | null;
}

export interface ConnectorTestResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface CalendarEvent {
  /**
   * Identity (ADR-0052 §5 / plan 52 E1): Google `iCalUID` / Graph `iCalUId` —
   * what WE push and what survives a round trip. `remoteId` is the provider's
   * opaque write handle; never key identity on it.
   */
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  htmlLink?: string;
  categories?: string[];
  /** The provider's opaque write handle (Google `id` / Graph `id`). */
  remoteId?: string;
  /** Provider concurrency token (Graph `changeKey`). Opaque, round-tripped only. */
  etag?: string;
}

export interface CalendarListResult {
  events: CalendarEvent[];
  /** Opaque provider cursor (nextSyncToken / deltaLink) — round-tripped only. */
  cursor?: string;
  truncated: boolean;
}

/**
 * Consent scope growth (ADR-0042 clause 4 / ADR-0052 §3): requested vs
 * granted scopes → what is added and what is removed. Pinned to the family
 * fixture wall (`catalog.scopeGrowth`); a re-bind shows the delta verbatim —
 * never a silent widening or drop.
 */
export function scopeDiff(granted: string[], requested: string[]): { added: string[]; removed: string[] } {
  const grantedSet = new Set(granted);
  const requestedSet = new Set(requested);
  return {
    added: requested.filter((scope) => !grantedSet.has(scope)),
    removed: granted.filter((scope) => !requestedSet.has(scope)),
  };
}
