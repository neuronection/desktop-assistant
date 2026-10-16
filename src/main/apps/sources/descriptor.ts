import { checkSchema } from '@shared/app-pack/schemaCheck';
import { SOURCES_SCHEMA, type SourceKind } from '@shared/app-pack';
import type { SchemaCheckResult } from '@shared/app-pack/schemaCheck';

export interface ValidatedSourceDescriptor {
  kind: SourceKind;
  /** https URL (git) or absolute local path (local). */
  origin: string;
  /** The validated descriptor verbatim. */
  document: Record<string, unknown>;
  subpath: string;
}

export type DescriptorValidation = { ok: true; descriptor: ValidatedSourceDescriptor } | { ok: false; error: string };

const ABSOLUTE_PATH_RE = /^\/[^\u0000-\u001f\u007f]*$/;
const TRAVERSAL_RE = /(^|\/)\.\.(\/|$)/;

/**
 * Validates a source descriptor against the VENDORED extension-sources
 * schema (plan 32 Phase 8): production documents against the https-only
 * root; a `local` document routes to the structurally distinct
 * `$defs.localSourceDescriptor` variant. Unknown shapes fail closed —
 * there is no third kind. Host-side confinement is ADDITIONAL host
 * policy: the local kind additionally requires an absolute,
 * traversal-free path (the schema's own structural rule, re-asserted
 * here with a typed reason before any process spawn).
 */
export function validateSourceDescriptor(doc: unknown): DescriptorValidation {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, error: 'A source descriptor must be a JSON object.' };
  }
  const record = doc as Record<string, unknown>;
  const isLocal = 'local' in record;
  let result: SchemaCheckResult;
  if (isLocal) {
    if ('url' in record) {
      return { ok: false, error: 'A source is either https or local — never both.' };
    }
    const defs = (SOURCES_SCHEMA as { $defs?: Record<string, unknown> }).$defs ?? {};
    result = checkSchema(defs.localSourceDescriptor, doc);
  } else {
    result = checkSchema(SOURCES_SCHEMA, doc);
  }
  if (!result.ok) {
    const detail = result.issues
      .slice(0, 5)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join('; ');
    return { ok: false, error: `Source descriptor is structurally invalid: ${detail}` };
  }
  if (isLocal) {
    const path = ((record.local as Record<string, unknown>).path as string) ?? '';
    if (!ABSOLUTE_PATH_RE.test(path) || TRAVERSAL_RE.test(path)) {
      return { ok: false, error: 'Local source paths must be absolute and free of ".." segments.' };
    }
    return { ok: true, descriptor: { kind: 'local', origin: path, document: record, subpath: subpathOf(record) } };
  }
  return { ok: true, descriptor: { kind: 'git', origin: record.url as string, document: record, subpath: subpathOf(record) } };
}

function subpathOf(record: Record<string, unknown>): string {
  return typeof record.subpath === 'string' ? record.subpath : '';
}
