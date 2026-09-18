import { describe, it, expect, vi, beforeEach } from 'vitest';

const { translate } = vi.hoisted(() => ({
  translate: vi.fn(),
}));

vi.mock('@main/services/TranslateService', () => ({
  TranslateService: { getInstance: () => ({ translate }) },
}));

import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import { formatTranslationResult, translateTool } from '@main/ai/tools/native/translate';
import { interpolate, TEXT } from '@shared/constants/text';

const def = translateTool;

describe('translate tool registration', () => {
  it('is in the native catalog with read-only network placement', () => {
    expect(NATIVE_TOOL_CATALOG.find((tool) => tool.name === 'translate')).toBe(def);
    expect(def.risk).toBe('read-only');
    expect(def.category).toBe('network');
    expect(def.timeoutMs).toBe(20_000);
    expect(def.resultCharCap).toBe(8_000);
  });
});

describe('translate tool exec', () => {
  beforeEach(() => {
    translate.mockReset();
  });

  it('rejects empty text via the schema', () => {
    expect(def.schema.safeParse({ text: '' }).success).toBe(false);
    expect(def.schema.safeParse({ text: 'hello' }).success).toBe(true);
    expect(def.schema.safeParse({ text: 'hello', target: 'el', source: 'en' }).success).toBe(true);
  });

  it('passes the request through with an explicit target and the abort signal', async () => {
    translate.mockResolvedValue({ text: 'Χαλημέρα', engine: 'llm', target: 'el', source: 'en' });
    const controller = new AbortController();
    const result = await def.exec({ text: 'good morning', target: 'el', source: 'en' }, { signal: controller.signal });
    expect(translate).toHaveBeenCalledWith({ text: 'good morning', target: 'el', source: 'en' }, { signal: controller.signal });
    expect(result).toContain('Χαλημέρα');
  });

  it('omits target and source when absent so the service applies its defaults', async () => {
    translate.mockResolvedValue({ text: 'Bonjour', engine: 'deepl', target: 'fr' });
    await def.exec({ text: 'hello' }, {});
    expect(translate).toHaveBeenCalledWith({ text: 'hello' }, { signal: undefined });
  });

  it('formats the result with the engine label and route meta line', async () => {
    translate.mockResolvedValue({ text: 'Καλημέρα', engine: 'deepl', target: 'el', source: 'en' });
    const result = (await def.exec({ text: 'hello', target: 'el' }, {})) as string;
    const [first, meta] = result.split('\n\n');
    expect(first).toBe('Καλημέρα');
    expect(meta).toBe(interpolate(TEXT.TRANSLATE_RESULT_META, { engine: 'DeepL', route: 'en → el' }));
  });

  it('summarizes with the target and a text preview', () => {
    expect(def.summarize({ text: 'hello world', target: 'el' })).toBe('Translate → el: hello world');
    expect(def.summarize({ text: 'hello world' })).toBe('Translate: hello world');
  });
});

describe('formatTranslationResult', () => {
  it('labels known engines and omits the source on auto-detect', () => {
    expect(formatTranslationResult({ text: 'Hola', engine: 'libretranslate', target: 'es' })).toBe(
      `Hola\n\n${interpolate(TEXT.TRANSLATE_RESULT_META, { engine: 'LibreTranslate', route: '→ es' })}`
    );
    expect(formatTranslationResult({ text: 'Hola', engine: 'llm', target: 'es', source: 'de' })).toContain('LLM · de → es');
  });

  it('falls back to the raw engine name for unknown engines', () => {
    expect(formatTranslationResult({ text: 'Hola', engine: 'mystery', target: 'es' })).toContain('mystery · → es');
  });
});
