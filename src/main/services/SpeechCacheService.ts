import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { LLMProviderType } from '@shared/types';
import { speechCacheUrl, type SpeechCacheStats } from '@shared/speech';
import { MainConfigService } from '@main/services/ConfigService';
import type { TtsAudio } from '@main/ai/tts';

export const SPEECH_CACHE_KEY_VERSION = 'v1';
export const SPEECH_CACHE_INDEX_FILE = 'index.json';
export const SPEECH_CACHE_FILE_RE = /^([a-f0-9]{64})\.([a-z0-9]{1,8})$/;

const TOUCH_THROTTLE_MS = 60_000;
const RENAME_RETRY_MS = 50;
const DEFAULT_MAX_UTTERANCES = 50;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

const EXTENSION_MIMES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
  bin: 'application/octet-stream',
};

export interface SpeechCacheKeyInput {
  providerId?: string;
  providerType?: LLMProviderType;
  apiBase?: string;
  modelId?: string;
  voice?: string;
  speed?: number;
  text: string;
}

/**
 * Chunk-granular content key over voice-affecting inputs only (plan 58 D4):
 * no outputs (`mime`) — a pre-synthesis guess that disagrees with the
 * response is a permanent miss. `speed` is normalized out for GOOGLE-flavored
 * providers because the Gemini path ignores it.
 */
export function speechCacheKey(input: SpeechCacheKeyInput): string {
  const speed =
    input.providerType === LLMProviderType.GOOGLE || input.speed === undefined
      ? ''
      : String(input.speed);
  const material = [
    SPEECH_CACHE_KEY_VERSION,
    input.providerId ?? '',
    input.providerType ?? '',
    input.apiBase ?? '',
    input.modelId ?? '',
    input.voice ?? '',
    speed,
    input.text,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function utteranceHashOf(chunkKeys: readonly string[]): string {
  return createHash('sha256').update(chunkKeys.join('|')).digest('hex');
}

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? 'bin';
}

export function mimeForExtension(extension: string): string {
  return EXTENSION_MIMES[extension] ?? 'application/octet-stream';
}

export interface SpeechCacheFileSystem {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<{ size: number; isFile(): boolean }>;
  utimes(path: string, atime: Date, mtime: Date): Promise<void>;
}

const nodeFs: SpeechCacheFileSystem = {
  mkdir: (path, options) => mkdir(path, options),
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path),
  writeFile: (path, data) => writeFile(path, data),
  rename: (from, to) => rename(from, to),
  rm: (path, options) => rm(path, options),
  stat: (path) => stat(path),
  utimes: (path, atime, mtime) => utimes(path, atime, mtime),
};

export interface SpeechCacheOptions {
  dir: string;
  maxUtterances?: () => number;
  maxBytes?: () => number;
  enabled?: () => boolean;
  fs?: SpeechCacheFileSystem;
  now?: () => number;
  log?: (message: string) => void;
}

interface CacheFileRecord {
  name: string;
  size: number;
  mime: string;
}

interface CacheUtterance {
  chunks: string[];
  touchedAt: number;
}

export interface SpeechCacheHit {
  url: string;
  mime: string;
}

interface SpeechCacheIndexFile {
  version: number;
  utterances: Record<string, { chunks: string[]; touchedAt: number }>;
}

export class SpeechCacheService {
  private static instance: SpeechCacheService | null = null;
  private readonly dir: string;
  private readonly fs: SpeechCacheFileSystem;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly files = new Map<string, CacheFileRecord>();
  private readonly utterances = new Map<string, CacheUtterance>();
  private readonly keyOwners = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly lastTouch = new Map<string, number>();
  private unavailable = false;
  private warned = false;
  private loaded = false;

  constructor(private readonly options: SpeechCacheOptions) {
    this.dir = options.dir;
    this.fs = options.fs ?? nodeFs;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? ((message) => console.warn(message));
  }

  static createDefault(): SpeechCacheService {
    const configService = MainConfigService.getInstance();
    return new SpeechCacheService({
      dir: join(app.getPath('userData'), 'speech-cache'),
      maxUtterances: () => configService.getConfig().voice?.speechCacheMaxUtterances ?? DEFAULT_MAX_UTTERANCES,
      maxBytes: () => configService.getConfig().voice?.speechCacheMaxBytes ?? DEFAULT_MAX_BYTES,
      enabled: () => configService.getConfig().voice?.speechCache !== false,
    });
  }

  static getInstance(): SpeechCacheService {
    if (!SpeechCacheService.instance) {
      SpeechCacheService.instance = SpeechCacheService.createDefault();
    }
    return SpeechCacheService.instance;
  }

  static resetForTests(): void {
    SpeechCacheService.instance = null;
  }

  get directory(): string {
    return this.dir;
  }

  keyOf(input: SpeechCacheKeyInput): string {
    return speechCacheKey(input);
  }

  isEnabled(): boolean {
    return this.options.enabled?.() ?? true;
  }

  private maxUtterances(): number {
    return Math.max(1, this.options.maxUtterances?.() ?? DEFAULT_MAX_UTTERANCES);
  }

  private maxBytes(): number {
    return Math.max(0, this.options.maxBytes?.() ?? DEFAULT_MAX_BYTES);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    if (!this.isEnabled()) {
      return;
    }
    try {
      await this.ensureDir();
    } catch {
      this.markUnavailable();
      return;
    }
    const names = await this.fs.readdir(this.dir).catch(() => null);
    if (!names) {
      this.markUnavailable();
      return;
    }
    const index = await this.readIndex();
    const onDisk = new Map<string, { name: string; size: number }>();
    for (const name of names) {
      if (name === SPEECH_CACHE_INDEX_FILE) {
        continue;
      }
      const match = SPEECH_CACHE_FILE_RE.exec(name);
      if (!match) {
        await this.fs.rm(join(this.dir, name), { force: true, recursive: true }).catch(() => undefined);
        continue;
      }
      const info = await this.fs.stat(join(this.dir, name)).catch(() => null);
      if (!info?.isFile()) {
        await this.fs.rm(join(this.dir, name), { force: true, recursive: true }).catch(() => undefined);
        continue;
      }
      onDisk.set(match[1], { name, size: info.size });
    }
    const referenced = new Set<string>();
    for (const [hash, entry] of Object.entries(index?.utterances ?? {})) {
      const chunks = entry.chunks.filter((key) => onDisk.has(key));
      if (chunks.length === 0) {
        continue;
      }
      chunks.forEach((key) => referenced.add(key));
      this.utterances.set(hash, { chunks, touchedAt: Number.isFinite(entry.touchedAt) ? entry.touchedAt : 0 });
      chunks.forEach((key) => this.keyOwners.set(key, hash));
    }
    for (const [key, file] of onDisk) {
      if (!referenced.has(key)) {
        await this.fs.rm(join(this.dir, file.name), { force: true }).catch(() => undefined);
        continue;
      }
      this.files.set(key, { name: file.name, size: file.size, mime: mimeForExtension(file.name.split('.').pop() ?? '') });
    }
    await this.evict();
  }

  async stats(): Promise<SpeechCacheStats> {
    return {
      enabled: this.isEnabled(),
      available: !this.unavailable,
      utterances: this.countedUtterances().length,
      bytes: this.totalBytes(),
    };
  }

  async clear(): Promise<void> {
    const names = await this.fs.readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name === SPEECH_CACHE_INDEX_FILE) {
        continue;
      }
      await this.fs.rm(join(this.dir, name), { force: true, recursive: true }).catch(() => undefined);
    }
    await this.fs.rm(join(this.dir, SPEECH_CACHE_INDEX_FILE), { force: true }).catch(() => undefined);
    this.files.clear();
    this.utterances.clear();
    this.keyOwners.clear();
    this.lastTouch.clear();
    this.unavailable = false;
    this.warned = false;
    try {
      await this.ensureDir();
    } catch {
      this.markUnavailable();
    }
  }

  async lookup(key: string): Promise<SpeechCacheHit | null> {
    if (!this.isEnabled()) {
      return null;
    }
    const file = this.files.get(key);
    if (!file) {
      return null;
    }
    const owner = this.keyOwners.get(key);
    if (owner) {
      await this.touch(owner);
    }
    return { url: speechCacheUrl(file.name), mime: file.mime };
  }

  async registerUtterance(chunkKeys: readonly string[]): Promise<string | null> {
    if (!this.isEnabled() || chunkKeys.length === 0) {
      return null;
    }
    const hash = utteranceHashOf(chunkKeys);
    if (!this.utterances.has(hash)) {
      this.utterances.set(hash, { chunks: [...chunkKeys], touchedAt: this.now() });
      chunkKeys.forEach((key) => this.keyOwners.set(key, hash));
    }
    await this.evict();
    return hash;
  }

  async store(key: string, audio: TtsAudio): Promise<string | null> {
    if (!this.isEnabled()) {
      return null;
    }
    const existing = this.files.get(key);
    if (existing) {
      return speechCacheUrl(existing.name);
    }
    const running = this.pending.get(key);
    if (running) {
      return running;
    }
    const task = this.write(key, audio).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async read(name: string): Promise<{ data: Buffer; mime: string } | null> {
    const match = SPEECH_CACHE_FILE_RE.exec(name);
    if (!match) {
      return null;
    }
    const file = this.files.get(match[1]);
    if (!file || file.name !== name) {
      return null;
    }
    try {
      const info = await this.fs.stat(join(this.dir, name));
      if (!info.isFile()) {
        return null;
      }
      const data = await this.fs.readFile(join(this.dir, name));
      return { data, mime: file.mime };
    } catch {
      return null;
    }
  }

  private async write(key: string, audio: TtsAudio): Promise<string | null> {
    const name = `${key}.${extensionForMime(audio.mime)}`;
    const target = join(this.dir, name);
    const temp = join(this.dir, `${key}.${this.now().toString(36)}.tmp`);
    let written: CacheFileRecord;
    this.inFlight.add(key);
    try {
      await this.ensureDir();
      const buffer = Buffer.from(audio.audioBase64, 'base64');
      await this.fs.writeFile(temp, buffer);
      await this.renameWithRetry(temp, target);
      written = { name, size: buffer.length, mime: audio.mime };
      this.files.set(key, written);
      this.unavailable = false;
    } catch (error) {
      await this.fs.rm(temp, { force: true }).catch(() => undefined);
      this.markUnavailable(error);
      return null;
    } finally {
      this.inFlight.delete(key);
    }
    await this.evict();
    return speechCacheUrl(written.name);
  }

  private async renameWithRetry(temp: string, target: string): Promise<void> {
    try {
      await this.fs.rename(temp, target);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS));
      await this.fs.rename(temp, target);
    }
  }

  private async touch(hash: string): Promise<void> {
    const entry = this.utterances.get(hash);
    if (!entry) {
      return;
    }
    const at = this.now();
    entry.touchedAt = at;
    const last = this.lastTouch.get(hash) ?? 0;
    if (at - last < TOUCH_THROTTLE_MS) {
      return;
    }
    this.lastTouch.set(hash, at);
    const date = new Date(at);
    await Promise.all(
      entry.chunks.map(async (key) => {
        const file = this.files.get(key);
        if (!file) {
          return;
        }
        await this.fs.utimes(join(this.dir, file.name), date, date).catch(() => undefined);
      })
    );
    await this.persistIndex();
  }

  private countedUtterances(): { hash: string; entry: CacheUtterance; bytes: number }[] {
    const counted: { hash: string; entry: CacheUtterance; bytes: number }[] = [];
    for (const [hash, entry] of this.utterances) {
      const bytes = this.bytesOf(entry);
      if (bytes > 0) {
        counted.push({ hash, entry, bytes });
      }
    }
    return counted;
  }

  private bytesOf(entry: CacheUtterance): number {
    return entry.chunks.reduce((total, key) => total + (this.files.get(key)?.size ?? 0), 0);
  }

  private totalBytes(): number {
    return [...this.files.values()].reduce((total, file) => total + file.size, 0);
  }

  private async evict(): Promise<void> {
    const counted = this.countedUtterances().sort((left, right) => left.entry.touchedAt - right.entry.touchedAt);
    let utterances = counted.length;
    let bytes = this.totalBytes();
    for (const candidate of counted) {
      if (utterances <= this.maxUtterances() && bytes <= this.maxBytes()) {
        break;
      }
      if (candidate.entry.chunks.some((key) => this.inFlight.has(key))) {
        continue;
      }
      for (const key of candidate.entry.chunks) {
        const file = this.files.get(key);
        if (!file) {
          continue;
        }
        await this.fs.rm(join(this.dir, file.name), { force: true }).catch(() => undefined);
        this.files.delete(key);
        this.keyOwners.delete(key);
      }
      this.utterances.delete(candidate.hash);
      this.lastTouch.delete(candidate.hash);
      utterances -= 1;
      bytes -= candidate.bytes;
    }
    if (bytes > this.maxBytes()) {
      for (const [key, file] of [...this.files]) {
        if (this.keyOwners.has(key) || this.inFlight.has(key)) {
          continue;
        }
        await this.fs.rm(join(this.dir, file.name), { force: true }).catch(() => undefined);
        this.files.delete(key);
        bytes -= file.size;
        if (bytes <= this.maxBytes()) {
          break;
        }
      }
    }
    await this.persistIndex();
  }

  private async persistIndex(): Promise<void> {
    const index: SpeechCacheIndexFile = { version: 1, utterances: {} };
    for (const [hash, entry] of this.utterances) {
      if (this.bytesOf(entry) > 0) {
        index.utterances[hash] = { chunks: entry.chunks, touchedAt: entry.touchedAt };
      }
    }
    const temp = join(this.dir, `${SPEECH_CACHE_INDEX_FILE}.tmp`);
    try {
      await this.fs.writeFile(temp, Buffer.from(JSON.stringify(index), 'utf8'));
      await this.renameWithRetry(temp, join(this.dir, SPEECH_CACHE_INDEX_FILE));
    } catch {
      await this.fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }

  private async readIndex(): Promise<SpeechCacheIndexFile | null> {
    try {
      const raw = await this.fs.readFile(join(this.dir, SPEECH_CACHE_INDEX_FILE));
      const parsed = JSON.parse(raw.toString('utf8')) as SpeechCacheIndexFile;
      if (parsed?.version !== 1 || typeof parsed.utterances !== 'object' || parsed.utterances === null) {
        return null;
      }
      const utterances: SpeechCacheIndexFile['utterances'] = {};
      for (const [hash, entry] of Object.entries(parsed.utterances)) {
        if (!/^[a-f0-9]{64}$/.test(hash) || !Array.isArray(entry?.chunks)) {
          continue;
        }
        const chunks = entry.chunks.filter(
          (key): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)
        );
        if (chunks.length > 0) {
          utterances[hash] = { chunks, touchedAt: entry.touchedAt };
        }
      }
      return { version: 1, utterances };
    } catch {
      return null;
    }
  }

  private async ensureDir(): Promise<void> {
    await this.fs.mkdir(this.dir, { recursive: true });
  }

  private markUnavailable(error?: unknown): void {
    const code = (error as { code?: string } | null | undefined)?.code;
    if (error === undefined || code === 'EACCES' || code === 'EROFS' || code === 'ENOSPC') {
      this.unavailable = true;
    }
    if (!this.warned) {
      this.warned = true;
      const detail =
        error instanceof Error
          ? error.message
          : error === undefined
            ? 'cache directory unavailable'
            : String(error);
      this.log(`Speech cache unavailable — playback continues from memory: ${detail}`);
    }
  }
}
