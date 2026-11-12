import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType, type AIMessage } from '@shared/types';
import type { EgressMode } from '@shared/egress';
import { classifyHost, egressAllowed } from '@shared/egress';
import { resolveOcrModel, type TaskModelResolution } from '@shared/ai/tasks';
import {
  OCR_AUDIT_TASK,
  OCR_PROMPT,
  chooseOcrEngine,
  normaliseOcrText,
  tesseractLanguage,
  type OcrCapabilityReport,
  type OcrEngine,
} from '@shared/ai/ocr';
import type { AiGateway } from '@main/ai/gateway';

const TESSERACT_PROBE_TIMEOUT_MS = 2_500;
const TESSERACT_TIMEOUT_MS = 20_000;
const MAX_INPUT_CHARS = 16_000_000;

export type OcrExec = (file: string, args: string[], options: { timeout: number }) => Promise<string>;

export interface OcrServiceDeps {
  getConfig(): AppConfig;
  resolveKey(provider: TaskModelResolution['provider']): Promise<string | null>;
  gateway: AiGateway;
  egressMode(): EgressMode;
  /** `userData/capture-tmp`; the caller owns the boot sweep. */
  tempDir(): string;
  exec?: OcrExec;
  readFile?(path: string): Promise<Buffer>;
  locale?(): string;
  platform?: NodeJS.Platform;
}

export type OcrOutcome =
  | { ok: true; text: string; engine: OcrEngine; provider?: string; model?: string; chars: number }
  | { ok: false; reason: 'no_engine' | 'blocked' | 'empty' | 'failed'; message?: string };

const defaultExec: OcrExec = (file, args, options) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: options.timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout));
    });
  });

/**
 * OCR (plan 82): one service, two engines, no surprises.
 *
 * - `tesseract` when installed (free, no egress, off the main thread);
 * - otherwise the assigned `ocr` model (ocr → vision → chat) through the
 *   gateway, audited as `AiCall.task = 'ocr'`;
 * - the egress policy is checked *before* the call, because the gateway
 *   re-wraps errors and cannot report a typed "blocked" to the UI.
 */
export class OcrService {
  private localProbe: Promise<boolean> | null = null;
  private sequence = 0;
  private readonly exec: OcrExec;

  constructor(private readonly deps: OcrServiceDeps) {
    this.exec = deps.exec ?? defaultExec;
  }

  public async localAvailable(): Promise<boolean> {
    if (this.deps.platform === 'win32') {
      return false;
    }
    if (!this.localProbe) {
      this.localProbe = this.exec('tesseract', ['--version'], { timeout: TESSERACT_PROBE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
    }
    return this.localProbe;
  }

  /** What the UI may offer right now, including *why* it cannot. */
  public async capabilities(): Promise<OcrCapabilityReport> {
    const config = this.deps.getConfig();
    const resolution = resolveOcrModel(config);
    const egress = this.deps.egressMode();
    const local = await this.localAvailable();
    return {
      local,
      model: resolution !== null,
      ...(resolution ? { provider: resolution.provider.name, modelId: resolution.modelId } : {}),
      allowed: resolution ? this.modelAllowed(resolution, egress) : false,
      egress,
    };
  }

  private modelAllowed(resolution: TaskModelResolution, mode: EgressMode): boolean {
    const raw = resolution.provider.apiBase ?? '';
    try {
      const host = new URL(raw).hostname;
      return egressAllowed(mode, classifyHost(host));
    } catch {
      // A provider without a parsable base URL falls through to the guarded
      // fetch, which records and enforces the policy there.
      return true;
    }
  }

  public async extract(dataUrl: string, input: { language?: string } = {}): Promise<OcrOutcome> {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_INPUT_CHARS) {
      return { ok: false, reason: 'failed', message: 'Unsupported image payload.' };
    }
    const config = this.deps.getConfig();
    const resolution = resolveOcrModel(config);
    const egress = this.deps.egressMode();
    const choice = chooseOcrEngine({
      localAvailable: await this.localAvailable(),
      modelAvailable: resolution !== null,
      modelAllowed: resolution ? this.modelAllowed(resolution, egress) : false,
    });
    if (!choice.engine) {
      return {
        ok: false,
        reason: choice.reason === 'blocked' ? 'blocked' : 'no_engine',
        message:
          choice.reason === 'blocked'
            ? `Reading text with a model is blocked by the ${egress} egress policy.`
            : 'No OCR engine is available: install tesseract or assign a vision model to the OCR task.',
      };
    }
    if (choice.engine === 'local') {
      const local = await this.runLocal(dataUrl, input.language);
      if (local !== null) {
        return local;
      }
      if (resolution && this.modelAllowed(resolution, egress)) {
        return this.runModel(dataUrl, resolution);
      }
      return { ok: false, reason: 'failed', message: 'The local OCR engine could not read this image.' };
    }
    return this.runModel(dataUrl, resolution as TaskModelResolution);
  }

  private async runLocal(dataUrl: string, language?: string): Promise<OcrOutcome | null> {
    const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) {
      return null;
    }
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1].replace(/[^a-z0-9]/gi, '');
    const bytes = Buffer.from(match[2], 'base64');
    const directory = this.deps.tempDir();
    const file = join(directory, `ocr-${process.pid}-${++this.sequence}.${extension}`);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(file, bytes, { mode: 0o600 });
      const stdout = await this.exec(
        'tesseract',
        [file, 'stdout', '-l', tesseractLanguage(language ?? this.deps.locale?.()), '--psm', '6'],
        { timeout: TESSERACT_TIMEOUT_MS }
      );
      const text = normaliseOcrText(stdout);
      if (!text) {
        return { ok: false, reason: 'empty', message: 'No text found in the capture.' };
      }
      return { ok: true, text, engine: 'local', chars: text.length };
    } catch {
      return null;
    } finally {
      void fs.rm(file, { force: true }).catch(() => undefined);
    }
  }

  private async runModel(dataUrl: string, resolution: TaskModelResolution): Promise<OcrOutcome> {
    const apiKey = await this.deps.resolveKey(resolution.provider);
    if (!apiKey && resolution.provider.type !== LLMProviderType.OLLAMA) {
      return { ok: false, reason: 'failed', message: 'The OCR model provider has no API key.' };
    }
    const messages: AIMessage[] = [
      { role: 'system', content: OCR_PROMPT },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] },
    ];
    try {
      const raw = await this.deps.gateway.chat({
        provider: resolution.provider,
        modelId: resolution.modelId,
        apiKey: apiKey ?? '',
        messages,
        task: OCR_AUDIT_TASK,
      });
      const text = normaliseOcrText(raw);
      if (!text) {
        return { ok: false, reason: 'empty', message: 'No text found in the capture.' };
      }
      return {
        ok: true,
        text,
        engine: 'model',
        provider: resolution.provider.name,
        model: resolution.modelId,
        chars: text.length,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      if (/egress policy/i.test(message)) {
        return { ok: false, reason: 'blocked', message };
      }
      return { ok: false, reason: 'failed', message };
    }
  }
}
