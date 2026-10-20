import type { PackError } from '@shared/app-pack';

const CODE_LABELS: Record<PackError['code'], string> = {
  'not-ready': 'not ready',
  'needs-secret': 'a required secret is missing',
  budget: 'the run budget was exhausted',
  'rate-limited': 'the engine is rate-limiting requests',
  'path-denied': 'the path was refused',
  canceled: 'the operation was cancelled',
  provider: 'the model provider failed',
  io: 'a filesystem error occurred',
  'not-found': 'not found',
  invalid: 'invalid request',
};

export function formatPackError(error: PackError): string {
  // 7E: product copy is keyed by `code`; the `message` diagnostic is the
  // interim host copy until the per-code label pass lands.
  const message = typeof error.detail?.message === 'string' ? `: ${error.detail.message}` : '';
  return `${CODE_LABELS[error.code]}${message}`;
}
