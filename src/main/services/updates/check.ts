import { checkSchema } from '@shared/app-pack/schemaCheck';
import { VERSION_API_SCHEMA } from '@shared/updates/version-api.schema.generated';
import type { UpdateRelease } from '@shared/types';

export const UPDATE_API_BASE = 'https://neuronection.com/api/v1/versions';
export const UPDATE_PRODUCT = 'desktop-assistant';
const FETCH_TIMEOUT_MS = 10_000;

export interface VersionDoc {
  schemaVersion: number;
  project: string;
  repo: string;
  generatedAt: string;
  checkIntervalSec: number;
  latestStable: UpdateRelease;
  latestBeta: UpdateRelease | null;
  history: UpdateRelease[];
}

export type VersionDocValidation = { ok: true } | { ok: false; reason: string };

export function validateVersionDoc(doc: unknown): VersionDocValidation {
  const defs = (VERSION_API_SCHEMA as { $defs?: Record<string, unknown> }).$defs;
  const productVersions = defs?.productVersions;
  if (!productVersions) {
    return { ok: false, reason: 'vendored schema is missing $defs.productVersions' };
  }
  const result = checkSchema(productVersions, doc, VERSION_API_SCHEMA);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    reason: result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '),
  };
}

export async function fetchVersionDoc(
  product: string = UPDATE_PRODUCT,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<VersionDoc> {
  const response = await fetch(`${UPDATE_API_BASE}/${product}.json`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`version API ${response.status} for ${product}`);
  }
  const body: unknown = await response.json();
  const validation = validateVersionDoc(body);
  if (!validation.ok) {
    throw new Error(`version API response rejected: ${validation.reason}`);
  }
  return body as VersionDoc;
}
