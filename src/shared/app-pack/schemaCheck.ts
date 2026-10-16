import { MANIFEST_SCHEMA } from './manifest.schema.generated';

export interface SchemaIssue {
  path: string;
  message: string;
}

export type SchemaCheckResult = { ok: true } | { ok: false; issues: SchemaIssue[] };

const MAX_ISSUES = 20;

/**
 * Structural pre-check over the generated manifest schema (plan 30 S2):
 * a small draft-2020-12 subset interpreter covering exactly the keywords
 * the generator emits (type, enum, const, pattern, numeric/length bounds,
 * required/properties/additionalProperties/items, anyOf/allOf, if/then,
 * local $ref). The full validator stays normative — this is the cheap
 * first gate that rejects malformed imports with schema-pointed paths.
 */
export function checkManifestSchema(value: unknown): SchemaCheckResult {
  return checkSchema(MANIFEST_SCHEMA, value);
}

/**
 * Structural check against an arbitrary draft-2020-12 subset schema (the
 * same interpreter the manifest pre-check runs — plan 32 Phase 8 extends
 * it to the vendored extension-sources/extension-manifest schemas; it now
 * covers their full keyword set incl. `not` and `contains`). `resolveRoot`
 * is where local `$ref` pointers resolve — the containing document when
 * checking a `$defs` subschema directly.
 */
export function checkSchema(root: unknown, value: unknown, resolveRoot: unknown = root): SchemaCheckResult {
  const issues: SchemaIssue[] = [];
  checkNode(root, value, resolveRoot, '$', issues);
  return issues.length === 0 ? { ok: true } : { ok: false, issues: issues.slice(0, MAX_ISSUES) };
}

function resolvesToNull(schema: unknown): boolean {
  return schema === false;
}

function checkNode(schema: unknown, value: unknown, root: unknown, path: string, issues: SchemaIssue[]): void {
  if (issues.length >= MAX_ISSUES || schema === undefined || schema === true) {
    return;
  }
  if (schema === false) {
    issues.push({ path, message: 'is not allowed here' });
    return;
  }
  if (typeof schema !== 'object' || schema === null) {
    return;
  }
  const node = schema as Record<string, unknown>;
  if (typeof node.$ref === 'string') {
    checkNode(resolveRef(root, node.$ref), value, root, path, issues);
    return;
  }
  if (Array.isArray(node.allOf)) {
    for (const sub of node.allOf) {
      checkNode(sub, value, root, path, issues);
    }
  }
  if (node.not !== undefined && node.not !== true) {
    const probe: SchemaIssue[] = [];
    checkNode(node.not, value, root, path, probe);
    if (probe.length === 0) {
      issues.push({ path, message: 'must not match the forbidden shape' });
    }
  }
  if (Array.isArray(node.anyOf)) {
    const scratch: SchemaIssue[] = [];
    for (const sub of node.anyOf) {
      const before = scratch.length;
      checkNode(sub, value, root, path, scratch);
      if (scratch.length === before) {
        scratch.length = 0;
        break;
      }
    }
    if (scratch.length > 0) {
      issues.push({ path, message: 'does not match any allowed variant' });
    }
  }
  if (node.if !== undefined && node.then !== undefined) {
    const probe: SchemaIssue[] = [];
    checkNode(node.if, value, root, path, probe);
    if (probe.length === 0) {
      checkNode(node.then, value, root, path, issues);
    }
  }
  if (Array.isArray(node.type)) {
    if (!node.type.some((entry) => matchesType(entry, value))) {
      issues.push({ path, message: `must be one of type ${node.type.join(', ')}` });
      return;
    }
  } else if (typeof node.type === 'string' && !matchesType(node.type, value)) {
    issues.push({ path, message: `must be of type ${node.type}` });
    return;
  }
  if (Array.isArray(node.enum) && !node.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    issues.push({ path, message: `must be one of ${node.enum.map((entry) => JSON.stringify(entry)).join(', ')}` });
  }
  if (node.const !== undefined && JSON.stringify(node.const) !== JSON.stringify(value)) {
    issues.push({ path, message: `must be ${JSON.stringify(node.const)}` });
  }
  if (typeof value === 'string') {
    checkString(node, value, path, issues);
  }
  if (typeof value === 'number') {
    checkNumber(node, value, path, issues);
  }
  if (Array.isArray(value)) {
    checkArray(node, value, root, path, issues);
  }
  if (isRecord(value)) {
    checkObject(node, value, root, path, issues);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function checkString(node: Record<string, unknown>, value: string, path: string, issues: SchemaIssue[]): void {
  if (typeof node.minLength === 'number' && value.length < node.minLength) {
    issues.push({ path, message: `is shorter than ${node.minLength} characters` });
  }
  if (typeof node.maxLength === 'number' && value.length > node.maxLength) {
    issues.push({ path, message: `exceeds ${node.maxLength} characters` });
  }
  if (typeof node.pattern === 'string' && !new RegExp(node.pattern).test(value)) {
    issues.push({ path, message: `does not match pattern ${node.pattern}` });
  }
}

function checkNumber(node: Record<string, unknown>, value: number, path: string, issues: SchemaIssue[]): void {
  if (typeof node.minimum === 'number' && value < node.minimum) {
    issues.push({ path, message: `must be >= ${node.minimum}` });
  }
  if (typeof node.maximum === 'number' && value > node.maximum) {
    issues.push({ path, message: `must be <= ${node.maximum}` });
  }
}

function checkArray(node: Record<string, unknown>, value: unknown[], root: unknown, path: string, issues: SchemaIssue[]): void {
  if (typeof node.minItems === 'number' && value.length < node.minItems) {
    issues.push({ path, message: `must have at least ${node.minItems} entries` });
  }
  if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
    issues.push({ path, message: `must have at most ${node.maxItems} entries` });
  }
  if (node.uniqueItems === true && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
    issues.push({ path, message: 'must not contain duplicate entries' });
  }
  if (node.items !== undefined && node.items !== false) {
    value.forEach((entry, index) => checkNode(node.items, entry, root, `${path}[${index}]`, issues));
  }
  if (node.contains !== undefined && node.contains !== false) {
    const scratch: SchemaIssue[] = [];
    for (const entry of value) {
      const before = scratch.length;
      checkNode(node.contains, entry, root, path, scratch);
      if (scratch.length === before) {
        return;
      }
    }
    issues.push({ path, message: 'must contain at least one matching entry' });
  }
}

function checkObject(node: Record<string, unknown>, value: Record<string, unknown>, root: unknown, path: string, issues: SchemaIssue[]): void {
  if (typeof node.minProperties === 'number' && Object.keys(value).length < node.minProperties) {
    issues.push({ path, message: `must have at least ${node.minProperties} properties` });
  }
  if (typeof node.maxProperties === 'number' && Object.keys(value).length > node.maxProperties) {
    issues.push({ path, message: `must have at most ${node.maxProperties} properties` });
  }
  if (Array.isArray(node.required)) {
    for (const key of node.required) {
      if (typeof key === 'string' && !(key in value)) {
        issues.push({ path, message: `is missing the required property "${key}"` });
      }
    }
  }
  const properties = isRecord(node.properties) ? node.properties : null;
  const propertyNames = isRecord(node.propertyNames) ? node.propertyNames : null;
  if (propertyNames) {
    for (const key of Object.keys(value)) {
      checkNode(propertyNames, key, root, `${path}.${key}`, issues);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (properties && key in properties) {
      checkNode(properties[key], entry, root, `${path}.${key}`, issues);
      continue;
    }
    if (resolvesToNull(node.additionalProperties)) {
      issues.push({ path: `${path}.${key}`, message: `unknown field "${key}" is not allowed here` });
    } else if (node.additionalProperties !== undefined && node.additionalProperties !== true) {
      checkNode(node.additionalProperties, entry, root, `${path}.${key}`, issues);
    }
  }
}

function resolveRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return undefined;
  }
  let node: unknown = root;
  for (const segment of ref.slice(2).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    node = isRecord(node) ? node[key] : undefined;
  }
  return node;
}
