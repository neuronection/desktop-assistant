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
