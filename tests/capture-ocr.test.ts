import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@shared/config/AppConfig';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { AiTask, LLMProviderType } from '@shared/types';
import type { EgressMode } from '@shared/egress';
import { resolveOcrModel } from '@shared/ai/tasks';
import { OcrService, type OcrExec } from '@main/services/ocr/OcrService';
import { describeCaptureCapabilities } from '@main/services/capture/capabilities';

const IMAGE = 'data:image/png;base64,' + Buffer.from('fake-image').toString('base64');

function configWith(assignments: Partial<Record<AiTask, string | null>>, caps: Array<'text' | 'vision'> = ['text', 'vision']): AppConfig {
  const provider = {
    ...DEFAULT_CONFIG.providers[0],
    id: 'p1',
    name: 'Local',
    type: LLMProviderType.OPENAI,
    apiBase: 'https://api.example.com/v1',
    availableModels: [
      { id: 'vision-model', name: 'vision', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps },
    ],
  };
  return {
    ...DEFAULT_CONFIG,
    providers: [provider],
    taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, ...assignments },
  };
}

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), 'node_modules', '.tmp', 'ocr-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function service(options: {
  config: AppConfig;
  egress?: EgressMode;
  exec?: OcrExec;
  gatewayChat?: (input: unknown) => Promise<string>;
}): { ocr: OcrService; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(options.gatewayChat ?? (async () => 'Hello from the model'));
  const ocr = new OcrService({
    getConfig: () => options.config,
    resolveKey: async () => 'key',
    gateway: { chat } as never,
    egressMode: () => options.egress ?? 'off',
    tempDir: () => directory,
    locale: () => 'en-US',
    platform: 'linux',
    exec: options.exec,
  });
  return { ocr, chat };
}

describe('OCR task resolution', () => {
  it('prefers the OCR slot, then vision, then chat', () => {
    const withOcr = configWith({ [AiTask.OCR]: 'vision-model' });
    expect(resolveOcrModel(withOcr)?.task).toBe(AiTask.OCR);

    const withoutOcr = configWith({ [AiTask.OCR]: null, [AiTask.VISION]: 'vision-model' });
    expect(resolveOcrModel(withoutOcr)?.task).toBe(AiTask.VISION);
  });

  it('never resolves to a model that cannot see', () => {
    const textOnly = configWith({ [AiTask.OCR]: 'vision-model', [AiTask.CHAT]: 'vision-model' }, ['text']);
    expect(resolveOcrModel(textOnly)).toBeNull();
  });
});

describe('OcrService local engine', () => {
  it('runs tesseract and returns its text', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) =>
      args[0] === '--version' ? 'tesseract 5.3' : '  Hello\nWorld  '
    ) as unknown as OcrExec;
    const { ocr, chat } = service({ config: configWith({}), exec });
    const outcome = await ocr.extract(IMAGE);
    expect(outcome).toEqual({ ok: true, text: 'Hello\nWorld', engine: 'local', chars: 11 });
    expect(chat).not.toHaveBeenCalled();
  });

  it('treats empty output as "no text", not an error string', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => (args[0] === '--version' ? 'ok' : '   \n')) as unknown as OcrExec;
    const { ocr } = service({ config: configWith({}), exec });
    expect(await ocr.extract(IMAGE)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('falls back to the model when the binary is missing', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }) as unknown as OcrExec;
    const { ocr, chat } = service({ config: configWith({ [AiTask.OCR]: 'vision-model' }), exec });
    const outcome = await ocr.extract(IMAGE);
    expect(outcome.ok && outcome.engine).toBe('model');
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ task: 'ocr' }));
  });
});

describe('OcrService model engine and egress', () => {
  it('does not call the provider when the policy blocks it', async () => {
    const exec = vi.fn(async () => {
      throw new Error('ENOENT');
    }) as unknown as OcrExec;
    const { ocr, chat } = service({
      config: configWith({ [AiTask.OCR]: 'vision-model' }),
      egress: 'strict-local',
      exec,
    });
    const outcome = await ocr.extract(IMAGE);
    expect(outcome).toMatchObject({ ok: false, reason: 'blocked' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('reports no engine when neither path exists', async () => {
    const exec = vi.fn(async () => {
      throw new Error('ENOENT');
    }) as unknown as OcrExec;
    const { ocr } = service({ config: configWith({}), exec });
    expect(await ocr.extract(IMAGE)).toMatchObject({ ok: false, reason: 'no_engine' });
  });

  it('normalises a fenced model answer and names the provider', async () => {
    const exec = vi.fn(async () => {
      throw new Error('ENOENT');
    }) as unknown as OcrExec;
    const { ocr } = service({
      config: configWith({ [AiTask.OCR]: 'vision-model' }),
      exec,
      gatewayChat: async () => '```text\nInvoice 42\n```',
    });
    const outcome = await ocr.extract(IMAGE);
    expect(outcome).toMatchObject({ ok: true, text: 'Invoice 42', engine: 'model', provider: 'Local' });
  });

  it('rejects a non-image payload before doing anything', async () => {
    const { ocr, chat } = service({ config: configWith({}) });
    expect(await ocr.extract('data:application/pdf;base64,AAAA')).toMatchObject({ ok: false, reason: 'failed' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('reports capabilities: engines, provider, egress', async () => {
    const exec = vi.fn(async () => 'tesseract 5') as unknown as OcrExec;
    const { ocr } = service({ config: configWith({ [AiTask.OCR]: 'vision-model' }), exec, egress: 'local-network' });
    const caps = await ocr.capabilities();
    expect(caps).toMatchObject({ local: true, model: true, provider: 'Local', modelId: 'vision-model', egress: 'local-network' });
  });
});

describe('capture capabilities report', () => {
  it('reports the cheap half: region, display count, OCR engines — no enumeration', async () => {
    const exec = vi.fn(async () => 'tesseract 5') as unknown as OcrExec;
    const { ocr } = service({ config: configWith({ [AiTask.OCR]: 'vision-model' }), exec });
    const regionAvailable = vi.fn(async () => true);
    const listSources = vi.fn(async () => ({ screens: [], windows: [], region: true }));
    const report = await describeCaptureCapabilities({
      capture: { regionAvailable, listSources } as never,
      ocr,
      platform: 'linux',
      displayCount: () => 2,
    });
    expect(report).toMatchObject({ platform: 'linux', region: true, screens: 2 });
    expect(report.ocr.local).toBe(true);
    expect(report.ocr.model).toBe(true);
    expect(listSources).not.toHaveBeenCalled();
  });
});

void tmpdir;
