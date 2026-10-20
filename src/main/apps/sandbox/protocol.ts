import { CAPABILITY_RPC_SCHEMA, EXTENSION_CHARTER, type ErrorDetail } from '@shared/app-pack';
import { checkSchema } from '@shared/app-pack/schemaCheck';
import { SANDBOX_HARD_LIMITS } from '@shared/app-pack/sandbox';

export const RPC_VERSION = 1;

export const CAP_METHODS = ['cap.net.fetch', 'cap.state.get', 'cap.state.set', 'cap.items.emit', 'cap.secrets.need'] as const;
export const EVENT_METHODS = ['evt.progress', 'evt.log'] as const;
export type CapMethod = (typeof CAP_METHODS)[number];
export type EventMethod = (typeof EVENT_METHODS)[number];

export type RpcErrorEnvelope = {
  code: string;
  /** The bounded detail object (7E) — never a string, never JSON-encoded. */
  detail: ErrorDetail;
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
  detail: ErrorDetail | string,
  retryable?: RpcErrorEnvelope['retryable'],
  retryAfterMs?: number
): RpcErrorEnvelope {
  if (!ERROR_CODES.has(code)) {
    throw new Error(`unknown charter error code: ${code}`);
  }
  const envelope: RpcErrorEnvelope = {
    code,
    detail: capErrorDetail(detail),
    retryable: retryable ?? DEFAULT_RETRYABLE[code] ?? 'no',
  };
  if (retryAfterMs !== undefined) {
    envelope.retryAfterMs = Math.max(0, Math.floor(retryAfterMs));
  }
  return envelope;
}

/**
 * The bounded error-detail object (plan 37 7E — the TS mirror of
 * `contract.cap_error_detail`, pinned by the rpc fixtures): declared keys
 * only, per-key caps, serialized size capped at
 * `limits.errorDetailMaxChars` (truncate `message` first, then drop
 * non-`message` keys). A plain string becomes `{ message }` at
 * CONSTRUCTION sites only — the wire never carries the string form.
 */
const ERROR_DETAIL_CAPS: Readonly<Record<string, number>> = {
  message: 400,
  path: 256,
  field: 64,
  id: 128,
  packId: 128,
  runId: 128,
  slot: 128,
  host: 253,
  method: 128,
  op: 64,
  stage: 64,
  engine: 64,
  expected: 128,
  actual: 128,
};
const ERROR_DETAIL_INTS: ReadonlySet<string> = new Set(['hop', 'limit', 'used']);

export function capErrorDetail(detail: unknown): ErrorDetail {
  const source: Record<string, unknown> =
    typeof detail === 'string' ? { message: detail } : detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {};
  const out: ErrorDetail = {};
  for (const [key, value] of Object.entries(source)) {
    if (ERROR_DETAIL_INTS.has(key)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        (out as Record<string, unknown>)[key] = value;
      }
    } else if (typeof value === 'string' && key in ERROR_DETAIL_CAPS) {
      (out as Record<string, unknown>)[key] = value.slice(0, ERROR_DETAIL_CAPS[key]);
    }
  }
  const size = (): number => stableJson(out).length;
  const cap = SANDBOX_HARD_LIMITS.errorDetailMaxChars;
  while (size() > cap) {
    const message = out.message;
    if (message) {
      out.message = message.slice(0, Math.max(0, message.length - (size() - cap)));
      continue;
    }
    const droppable = Object.keys(out).find((key) => key !== 'message');
    if (droppable === undefined) {
      break;
    }
    delete (out as Record<string, unknown>)[droppable];
  }
  return out;
}

/** Canonical JSON for hashing/audit (never an error-detail encoder). */
export function stableJson(data: unknown): string {
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
