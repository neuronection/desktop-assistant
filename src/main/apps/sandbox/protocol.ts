import { CAPABILITY_RPC_SCHEMA, EXTENSION_CHARTER } from '@shared/app-pack';
import { checkSchema } from '@shared/app-pack/schemaCheck';
import { SANDBOX_HARD_LIMITS } from '@shared/app-pack/sandbox';

export const RPC_VERSION = 1;

export const CAP_METHODS = ['cap.net.fetch', 'cap.state.get', 'cap.state.set', 'cap.items.emit', 'cap.secrets.need'] as const;
export const EVENT_METHODS = ['evt.progress', 'evt.log'] as const;
export type CapMethod = (typeof CAP_METHODS)[number];
export type EventMethod = (typeof EVENT_METHODS)[number];

export type RpcErrorEnvelope = {
  code: string;
  detail: string;
  retryable: 'yes' | 'no' | 'after-delay' | 'after-config-change';
  retryAfterMs?: number;
};

export type RpcMessage = {
  v: number;
  type: 'call' | 'result' | 'error' | 'event';
  id: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: RpcErrorEnvelope;
};

/** The charter's per-code default retryable — one vocabulary with the seam. */
export const DEFAULT_RETRYABLE: Readonly<Record<string, RpcErrorEnvelope['retryable']>> =
  Object.fromEntries(
    ((EXTENSION_CHARTER.errors.codes as unknown as { code: string; retryable: string }[]) ?? []).map((entry) => [entry.code, entry.retryable])
  ) as Readonly<Record<string, RpcErrorEnvelope['retryable']>>;

export const ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(DEFAULT_RETRYABLE));

export const MAX_PROTOCOL_VIOLATIONS = 3;

export function errorEnvelope(
  code: string,
  detail: string,
  retryable?: RpcErrorEnvelope['retryable'],
  retryAfterMs?: number
): RpcErrorEnvelope {
  if (!ERROR_CODES.has(code)) {
    throw new Error(`unknown charter error code: ${code}`);
  }
  const envelope: RpcErrorEnvelope = {
    code,
    detail: detail.slice(0, SANDBOX_HARD_LIMITS.errorDetailMaxChars),
    retryable: retryable ?? DEFAULT_RETRYABLE[code] ?? 'no',
  };
  if (retryAfterMs !== undefined) {
    envelope.retryAfterMs = Math.max(0, Math.floor(retryAfterMs));
  }
  return envelope;
}

/** Capped JSON data, never a raw exception string (protocol §8). */
export function jsonDetail(data: unknown): string {
  try {
    return JSON.stringify(data) ?? '{}';
  } catch {
    return '{}';
  }
}

export class FramingError extends Error {
  constructor(detail: string) {
    super(detail.slice(0, SANDBOX_HARD_LIMITS.errorDetailMaxChars));
    this.name = 'FramingError';
  }
}

/** The structural gate for one framed message — the vendored schema, verbatim. */
export function validateFrame(doc: unknown): RpcMessage {
  const verdict = checkSchema(CAPABILITY_RPC_SCHEMA, doc);
  if (!verdict.ok) {
    const detail = verdict.issues
      .slice(0, 3)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join('; ');
    throw new FramingError(`message fails the capability-rpc schema: ${detail}`);
  }
  return doc as RpcMessage;
}

/** Outbound framing: one JSON line, byte-capped (the line cap is the framing law both ways). */
export function encodeFrame(message: Record<string, unknown>): string {
  const line = JSON.stringify(message);
  if (line === undefined || line.length > SANDBOX_HARD_LIMITS.rpcLineMaxBytes) {
    throw new FramingError('outbound message exceeds rpcLineMaxBytes');
  }
  return line;
}
