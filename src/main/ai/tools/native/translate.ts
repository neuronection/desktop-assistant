import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { interpolate, TEXT } from '@shared/constants/text';

const schema = z.object({
  text: z.string().min(1).describe('The text to translate.'),
  target: z.string().optional().describe("Target language code — built-in ISO-639-1 (e.g. 'en', 'el', 'de') or a custom code configured in settings. Omit to use the configured default target."),
  source: z.string().optional().describe('Source language code; omit to auto-detect.'),
});

const ENGINE_LABELS: Record<string, string> = {
  deepl: 'DeepL',
  libretranslate: 'LibreTranslate',
  llm: 'LLM',
};

export function formatTranslationResult(result: { text: string; engine: string; source?: string; target: string }): string {
  const engine = ENGINE_LABELS[result.engine] ?? result.engine;
  const route = result.source ? `${result.source} → ${result.target}` : `→ ${result.target}`;
  return `${result.text}\n\n${interpolate(TEXT.TRANSLATE_RESULT_META, { engine, route })}`;
}

export const translateTool: NativeToolDefinition<{ text: string; target?: string; source?: string }> = {
  name: 'translate',
  description:
    'Translate text between languages. Uses the configured translation engine — a dedicated service (DeepL/LibreTranslate) or the assigned LLM. The target defaults to the configured default target language; the source auto-detects when omitted. Built-in ISO-639-1 codes and custom language codes from settings are accepted.',
  schema,
  risk: 'read-only',
  category: 'network',
  timeoutMs: 20_000,
  resultCharCap: 8_000,
  summarize: (args) => `Translate${args.target ? ` → ${args.target}` : ''}: ${args.text.slice(0, 40)}`,
  async exec(args, ctx) {
    const { TranslateService } = await import('@main/services/TranslateService');
    const result = await TranslateService.getInstance().translate(
      {
        text: args.text,
        ...(args.target ? { target: args.target } : {}),
        ...(args.source ? { source: args.source } : {}),
      },
      { signal: ctx.signal }
    );
    return formatTranslationResult(result);
  },
};
