import { toJsonSchema } from '@langchain/core/utils/json_schema';

/**
 * JSON Schema keywords the Gemini function-calling API rejects with a 400
 * ("Unknown name ...") — the native `streamGenerateContent` surface only
 * accepts a subset of OpenAPI 3.03. LangChain's converter strips
 * `$schema`/`additionalProperties`/`strict` but passes these through
 * (e.g. zod `.positive()` → `exclusiveMinimum`), so a single offending
 * tool breaks the whole request. Warn-only: the keywords are reported at
 * bind time so the culprit is named instead of a provider error index.
 */
export const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS = ['exclusiveMinimum', 'exclusiveMaximum'] as const;

export interface SchemaKeywordFinding {
  tool: string;
  path: string;
  keyword: string;
}

const MODEL_STRIPPED_KEYS = new Set(['$schema', 'additionalProperties', 'strict']);

/**
 * Type arrays the Gemini converter cannot adjust: it rewrites
 * `[x, 'null']` into `x` + `nullable: true` and singles into plain
 * strings, but anything else (two non-null members — zod v4 renders
 * `z.union([z.string(), z.number()])` exactly that way — plus >2
 * entries, empty and null-only arrays) throws "Gemini does not support
 * union types in function schemas" client-side and kills the whole
 * bind. Warn-only: reported at bind time so the culprit is named.
 */
function typeArrayFinding(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length === 0 || (value.length === 1 && value[0] === 'null') || value.length > 2) {
    return `type[${value.join('|')}]`;
  }
  if (value.length === 2 && !value.includes('null')) {
    return `type[${value.join('|')}]`;
  }
  return null;
}

function stripModelHandledKeys(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripModelHandledKeys);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!MODEL_STRIPPED_KEYS.has(key)) {
      stripped[key] = stripModelHandledKeys(value);
    }
  }
  return stripped;
}

function collect(node: unknown, path: string, findings: { path: string; keyword: string }[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collect(item, `${path}[${index}]`, findings));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if ((GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS as readonly string[]).includes(key) && value !== undefined) {
      findings.push({ path: childPath, keyword: key });
    }
    const union = key === 'type' ? typeArrayFinding(value) : null;
    if (union) {
      findings.push({ path: childPath, keyword: union });
    }
    collect(value, childPath, findings);
  }
}

export function findGeminiUnsupportedKeywords(toolName: string, schema: unknown): SchemaKeywordFinding[] {
  let jsonSchema: unknown;
  try {
    jsonSchema = toJsonSchema(schema as never);
  } catch {
    return [];
  }
  const findings: { path: string; keyword: string }[] = [];
  collect(stripModelHandledKeys(jsonSchema), 'parameters', findings);
  return findings.map((finding) => ({ tool: toolName, ...finding }));
}

export function reportGeminiUnsupportedSchemas(tools: { name: string; schema: unknown }[]): SchemaKeywordFinding[] {
  const findings = tools.flatMap((tool) => findGeminiUnsupportedKeywords(tool.name, tool.schema));
  if (findings.length > 0) {
    const detail = findings.map((finding) => `${finding.tool}: ${finding.path} (${finding.keyword})`).join(', ');
    console.warn(
      'Gemini function-calling rejects some schema keywords/type unions — ' +
        `${findings.length} offending schema node(s), these tools may fail to bind: ${detail}`,
    );
  }
  return findings;
}
