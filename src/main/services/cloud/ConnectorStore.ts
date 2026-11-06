// ConnectorAccount custody law (ADR-0042 clause 9 / ADR-0052 §2): the row is
// metadata only. No field here is token-shaped and none may ever be added —
// credentials live exclusively in the secret store under the keyringRef pointer.

export interface ConnectorAccountRow {
  id: string;
  connectorKind: string;
  label: string;
  authKind: string;
  keyringRef: string;
  expiresAt: Date | null;
  scopes: unknown;
  status: string;
  updatedAt: Date;
}

export interface ConnectorAccountCreateInput {
  connectorKind: string;
  label: string;
  authKind: string;
  keyringRef: string;
  scopes: string[];
  status: string;
}

export interface ConnectorAccountPatch {
  label?: string;
  scopes?: string[];
  status?: string;
  expiresAt?: Date | null;
  keyringRef?: string;
}

export interface ConnectorAccountStore {
  list(): Promise<ConnectorAccountRow[]>;
  get(id: string): Promise<ConnectorAccountRow | null>;
  create(input: ConnectorAccountCreateInput): Promise<ConnectorAccountRow>;
  update(id: string, patch: ConnectorAccountPatch): Promise<ConnectorAccountRow | null>;
  remove(id: string): Promise<void>;
}

export type ConnectorErrorCode =
  | 'needs-config'
  | 'needs-auth'
  | 'needs-secret'
  | 'transient'
  | 'provider-error'
  | 'in-flight'
  | 'cancelled'
  | 'timeout'
  | 'state-mismatch'
  | 'not-found'
  | 'invalid'
  /** The protocol/host cannot do this yet — e.g. recurrence writes (plan 52 H1), CalDAV before its adapter lands. */
  | 'unsupported';

/**
 * Typed failure surface (ADR-0052 §3 failure posture): every stop maps to a
 * code the UI can render. Error messages carry no token material — they are
 * built from status codes and provider error codes only.
 */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(code: ConnectorErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
  }
}

export function providerOf(row: Pick<ConnectorAccountRow, 'connectorKind'>): string {
  return row.connectorKind.startsWith('calendar:') ? row.connectorKind.slice('calendar:'.length) : row.connectorKind;
}

export function secretKey(accountId: string, slot: 'access' | 'refresh' | 'expires' | 'extra'): string {
  return `connector:${accountId}:${slot}`;
}

export const ACCOUNT_SECRET_SLOTS = ['access', 'refresh', 'expires', 'extra'] as const;
