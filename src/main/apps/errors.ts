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
  const reason = typeof error.detail?.reason === 'string' ? `: ${error.detail.reason}` : '';
  return `${CODE_LABELS[error.code]}${reason}`;
}
