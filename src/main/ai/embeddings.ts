import { LLMProvider, LLMProviderType } from '@shared/types';
import { classifyProviderError, ProviderErrorCode } from '@shared/ai/providerErrors';

/**
 * Sanctioned non-chat model endpoint (the tts.ts/catalog.ts precedent,
 * ADR-0018): embeddings for the `embed` task, owned by the AI layer per
 * the family alignment gate. Two flavors:
 * OpenAI-compatible `POST {apiBase}/embeddings` (`{ model, input }` →
 * `data[].embedding`) for OPENAI/GROQ/TOGETHER/FIREWORKS/OLLAMA
 * providers, and native Gemini `POST {base}/models/{model}:embedContent`
 * for `LLMProviderType.GOOGLE` (one call per input, `{ embedding: {
 * values } }` back).
 *
 * INFRASTRUCTURE-FIRST (plan 26): no product feature calls this yet —
 * the slot, the setup gap-fill and the transport land together so the
 * first embeddings consumer (memory/semantic search) only has to resolve
 * the `embed` task and call this. Intentional, not dead code.
 *
 * `provider.timeout` bounds every request (AbortController, the
 * setup.ts precedent). Errors are classified through the shared
 * `classifyProviderError` and thrown as `EmbeddingsError` with the
 * classified `code`; key material never appears in thrown messages,
 * logs, or error bodies (scrubbed).
 */

export class EmbeddingsError extends Error {
  readonly code: ProviderErrorCode;
  readonly suspectedVendor?: string;

  constructor(classified: { code: ProviderErrorCode; suspectedVendor?: string }, message: string) {
    super(message);
    this.name = 'EmbeddingsError';
    this.code = classified.code;
    this.suspectedVendor = classified.suspectedVendor;
  }
}

const OPENAI_COMPATIBLE_TYPES: readonly LLMProviderType[] = [
  LLMProviderType.OPENAI,
  LLMProviderType.GROQ,
  LLMProviderType.TOGETHER,
  LLMProviderType.FIREWORKS,
  LLMProviderType.OLLAMA,
];

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Redacts raw and URL-encoded key material from anything we surface. */
function scrubKey(text: string, apiKey: string): string {
  let scrubbed = text;
  if (apiKey) {
    scrubbed = scrubbed.split(apiKey).join('[redacted]');
    try {
      const encoded = encodeURIComponent(apiKey);
      if (encoded !== apiKey) {
        scrubbed = scrubbed.split(encoded).join('[redacted]');
      }
    } catch {
      // encodeURIComponent cannot throw on string input; kept for safety
    }
  }
  return scrubbed;
}

export const PROFILE_TEXT_CAP = 2000;
export const RRF_K = 60;
export const RRF_LEXICAL_WEIGHT = 0.6;
export const RRF_SEMANTIC_WEIGHT = 0.4;

/** D5 profile text: name + description + enabled tool names + keyword tags, NFKD, capped. */
export function profileTextOf(app: {
  name: string;
  description?: string;
  tools: { name: string; enabled: boolean; keywordTags: string[] }[];
}): string {
  const parts = [app.name, app.description ?? ''];
  for (const tool of app.tools) {
    if (!tool.enabled) {
      continue;
    }
    parts.push(tool.name, ...tool.keywordTags);
  }
  return parts
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PROFILE_TEXT_CAP);
}

/** Pure cosine; dim mismatch scores 0 (family dim-mismatch rule). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Reciprocal Rank Fusion over the matched set only (plan 18 D6):
 * `0.6 lexical / 0.4 semantic`, k=60. A missing side contributes 0;
 * higher fused score = stronger candidate.
 */
export function rrfFuse(
  lexicalRank: readonly string[],
  semanticRank: ReadonlyMap<string, number>,
  weights: { lexical?: number; semantic?: number } = {}
): { order: string[]; scores: Map<string, number> } {
  const lexicalWeight = weights.lexical ?? RRF_LEXICAL_WEIGHT;
  const semanticWeight = weights.semantic ?? RRF_SEMANTIC_WEIGHT;
  const ids = new Set([...lexicalRank, ...semanticRank.keys()]);
  const semanticOrder = [...semanticRank.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  const scores = new Map<string, number>();
  for (const id of ids) {
    const lexicalIndex = lexicalRank.indexOf(id);
    const semanticIndex = semanticOrder.indexOf(id);
    const score =
      (lexicalIndex === -1 ? 0 : lexicalWeight / (RRF_K + lexicalIndex + 1)) +
      (semanticIndex === -1 ? 0 : semanticWeight / (RRF_K + semanticIndex + 1));
    scores.set(id, score);
  }
  return {
    order: [...ids].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b)),
    scores,
  };
}

export interface EmbeddingRow {
  kind: string;
  refId: string;
  model: string;
  dims: number;
  contentHash: string;
  vector: Uint8Array<ArrayBuffer>;
}

export interface EmbeddingStore {
  find(kind: string, refId: string, model: string): Promise<EmbeddingRow | null>;
  upsert(row: EmbeddingRow): Promise<void>;
  deleteWhereModelNot(model: string): Promise<number>;
}

export interface EmbeddingServiceDeps {
  store: EmbeddingStore;
  resolveModel(): { modelId: string; embed(texts: string[]): Promise<number[][]> } | null;
  hash(text: string): string;
}

/**
 * Table-backed profile cache (plan 18 D4/D5): content-hash dedupe, model
 * switch = full miss + prune, query text never persisted.
 */
export class EmbeddingService {
  constructor(private readonly deps: EmbeddingServiceDeps) {}

  async profileVector(app: {
    id: string;
    name: string;
    description?: string;
    tools: { name: string; enabled: boolean; keywordTags: string[] }[];
  }): Promise<number[] | null> {
    const resolved = this.deps.resolveModel();
    if (!resolved) {
      return null;
    }
    const text = profileTextOf(app);
    const contentHash = this.deps.hash(`${resolved.modelId}:${text}`);
    const existing = await this.deps.store.find('app-profile', app.id, resolved.modelId);
    if (existing && existing.contentHash === contentHash) {
      return decodeVector(existing.vector, existing.dims);
    }
    const [vector] = await resolved.embed([text]);
    if (!vector || vector.length === 0) {
      return null;
    }
    await this.deps.store.upsert({
      kind: 'app-profile',
      refId: app.id,
      model: resolved.modelId,
      dims: vector.length,
      contentHash,
      vector: encodeVector(vector),
    });
    return vector;
  }

  /** Query text is embedded per call and never persisted (D4). */
  async queryVector(text: string): Promise<number[] | null> {
    const resolved = this.deps.resolveModel();
    if (!resolved) {
      return null;
    }
    const [vector] = await resolved.embed([text]);
    return vector && vector.length > 0 ? vector : null;
  }

  /** Prune-on-model-change: rows from any other embedding model are dead. */
  async pruneOnModelChange(): Promise<number> {
    const resolved = this.deps.resolveModel();
    if (!resolved) {
      return 0;
    }
    return this.deps.store.deleteWhereModelNot(resolved.modelId);
  }
}

export function encodeVector(vector: readonly number[]): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as Uint8Array<ArrayBuffer>;
}

export function decodeVector(bytes: Uint8Array, dims: number): number[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let index = 0; index < dims; index += 1) {
    out.push(buffer.readFloatLE(index * 4));
  }
  return out;
}

export async function embedTexts(provider: LLMProvider, model: string, inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeout || 120000);
  try {
    if (provider.type === LLMProviderType.GOOGLE) {
      return await embedGemini(provider, model, inputs, controller.signal);
    }
    if (OPENAI_COMPATIBLE_TYPES.includes(provider.type)) {
      return await embedOpenAICompatible(provider, model, inputs, controller.signal);
    }
    throw new EmbeddingsError(
      { code: 'unknown' },
      `Provider type ${provider.type} does not serve embeddings.`
    );
  } catch (error) {
    if (error instanceof EmbeddingsError) {
      throw error;
    }
    const err = error as Error;
    const classified = classifyProviderError({
      status: typeof (err as { status?: number }).status === 'number' ? (err as { status?: number }).status : undefined,
      message: err.message,
      name: err.name,
      localProvider: provider.type === LLMProviderType.OLLAMA,
      apiKey: provider.apiKey,
    });
    throw new EmbeddingsError(
      classified,
      scrubKey(err.message || 'embeddings request failed', provider.apiKey).slice(0, 300)
    );
  } finally {
    clearTimeout(timer);
  }
}

async function embedOpenAICompatible(
  provider: LLMProvider,
  model: string,
  inputs: string[],
  signal: AbortSignal
): Promise<number[][]> {
  const base = (provider.apiBase || '').replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!response.ok) {
    throw await endpointError(response);
  }
  const payload = (await response.json()) as { data?: { index?: number; embedding: number[] }[] };
  const rows = payload.data ?? [];
  if (rows.length !== inputs.length) {
    throw new Error(`Embeddings vendor returned ${rows.length} vectors for ${inputs.length} inputs`);
  }
  // Honor the vendor's index ordering when present (some compatible
  // servers reorder); otherwise the response order is the input order.
  const indexed = rows.every((row, i) => row.index === undefined || row.index === i);
  if (indexed) {
    return rows.map((row) => row.embedding);
  }
  const ordered: number[][] = new Array(rows.length);
  rows.forEach((row, i) => {
    ordered[row.index ?? i] = row.embedding;
  });
  return ordered;
}

async function embedGemini(
  provider: LLMProvider,
  model: string,
  inputs: string[],
  signal: AbortSignal
): Promise<number[][]> {
  const base = (provider.apiBase || GEMINI_DEFAULT_BASE).replace(/\/$/, '').replace(/\/openai$/, '');
  const vectors = await Promise.all(
    inputs.map(async (text) => {
      const url = `${base}/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(provider.apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!response.ok) {
        throw await endpointError(response);
      }
      const payload = (await response.json()) as { embedding?: { values?: number[] } };
      const values = payload.embedding?.values;
      if (!values) {
        throw new Error('Gemini returned no embedding for this request');
      }
      return values;
    })
  );
  return vectors;
}

async function endpointError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  let message = body.slice(0, 300) || `HTTP ${response.status}`;
  try {
    message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    // keep raw text
  }
  const error = new Error(message) as Error & { status?: number };
  error.status = response.status;
  return error;
}
