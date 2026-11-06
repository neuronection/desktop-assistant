import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LLMProviderType } from '@shared/types';
import { speechCacheUrl } from '@shared/speech';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(tmpdir(), 'da-speech-cache-mock') },
}));

import {
  SpeechCacheService,
  extensionForMime,
  speechCacheKey,
  utteranceHashOf,
  SPEECH_CACHE_FILE_RE,
  SPEECH_CACHE_INDEX_FILE,
  type SpeechCacheFileSystem,
} from '@main/services/SpeechCacheService';

const KEY_INPUT = {
  providerId: 'p1',
  providerType: LLMProviderType.OPENAI,
  apiBase: 'https://api.example.test/v1',
  modelId: 'tts-1',
  voice: 'alloy',
  speed: 1,
  text: 'Hello there.',
};

function base64Of(size: number): string {
  return Buffer.alloc(size, 7).toString('base64');
}

function audio(size = 64, mime = 'audio/wav'): { audioBase64: string; mime: string } {
  return { audioBase64: base64Of(size), mime };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'da-speech-cache-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function create(overrides: Partial<ConstructorParameters<typeof SpeechCacheService>[0]> = {}): SpeechCacheService {
  return new SpeechCacheService({ dir, log: () => undefined, ...overrides });
}

async function seed(
  cache: SpeechCacheService,
  inputs: typeof KEY_INPUT,
  chunks: number[] = [64]
): Promise<{ keys: string[]; hash: string }> {
  const texts = chunks.map((_, index) => `${inputs.text} part ${index + 1}`);
  const keys = texts.map((text) => cache.keyOf({ ...inputs, text }));
  await cache.registerUtterance(keys);
  for (let index = 0; index < keys.length; index += 1) {
    await cache.store(keys[index], audio(chunks[index]));
  }
  return { keys, hash: utteranceHashOf(keys) };
}

describe('speech cache key (plan 58 D4)', () => {
  it('is stable for identical inputs and sensitive to every voice input', () => {
    const base = speechCacheKey(KEY_INPUT);
    expect(speechCacheKey({ ...KEY_INPUT })).toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, apiBase: 'https://other.test/v1' })).not.toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, providerType: LLMProviderType.OLLAMA })).not.toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, providerId: 'p2' })).not.toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, modelId: 'tts-2' })).not.toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, voice: 'nova' })).not.toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, speed: 1.5 })).not.toBe(base);
    expect(speechCacheKey({ ...KEY_INPUT, text: 'Hello there!' })).not.toBe(base);
  });

  it('normalizes speed out for GOOGLE-flavored providers', () => {
    const google = { ...KEY_INPUT, providerType: LLMProviderType.GOOGLE };
    expect(speechCacheKey({ ...google, speed: 0.5 })).toBe(speechCacheKey({ ...google, speed: 2 }));
    const openai = { ...KEY_INPUT, providerType: LLMProviderType.OPENAI };
    expect(speechCacheKey({ ...openai, speed: 0.5 })).not.toBe(speechCacheKey({ ...openai, speed: 2 }));
  });

  it('is hex sha256 and never keys on the response mime', async () => {
    expect(speechCacheKey(KEY_INPUT)).toMatch(/^[a-f0-9]{64}$/);
    const cache = create();
    const key = cache.keyOf(KEY_INPUT);
    expect(await cache.store(key, audio(32, 'audio/wav'))).toBe(speechCacheUrl(`${key}.wav`));
    expect(await cache.store(key, audio(32, 'audio/mpeg'))).toBe(speechCacheUrl(`${key}.wav`));
  });
});

describe('speech cache round trip', () => {
  it('stores a chunk, serves it, and reports honest stats', async () => {
    const cache = create();
    const { keys } = await seed(cache, KEY_INPUT, [128]);
    expect(readdirSync(dir)).toContain(`${keys[0]}.wav`);
    const hit = await cache.lookup(keys[0]);
    expect(hit).toEqual({ url: speechCacheUrl(`${keys[0]}.wav`), mime: 'audio/wav' });
    expect(await cache.lookup(cache.keyOf({ ...KEY_INPUT, text: 'never stored' }))).toBeNull();
    expect(await cache.stats()).toEqual({ enabled: true, available: true, utterances: 1, bytes: 128 });
  });

  it('is a no-op when the setting is off, but never blocks playback', async () => {
    const cache = create({ enabled: () => false });
    const key = cache.keyOf(KEY_INPUT);
    expect(await cache.store(key, audio())).toBeNull();
    expect(await cache.lookup(key)).toBeNull();
    expect(await cache.registerUtterance([key])).toBeNull();
    expect(await cache.stats()).toMatchObject({ enabled: false, utterances: 0, bytes: 0 });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('clears everything and stays usable afterwards', async () => {
    const cache = create();
    const { keys } = await seed(cache, KEY_INPUT, [64, 64]);
    await cache.clear();
    expect(readdirSync(dir)).toEqual([]);
    expect(await cache.stats()).toMatchObject({ utterances: 0, bytes: 0 });
    expect(await cache.lookup(keys[0])).toBeNull();
    expect(await cache.store(keys[0], audio())).toBe(speechCacheUrl(`${keys[0]}.wav`));
  });
});

describe('speech cache eviction (plan 58 §4.3)', () => {
  it('evicts whole utterances by count and never splits a long one', async () => {
    let clock = 1000;
    const cache = create({ maxUtterances: () => 2, now: () => clock });
    const first = await seed(cache, { ...KEY_INPUT, text: 'first' }, [64, 64, 64]);
    clock += 10;
    const second = await seed(cache, { ...KEY_INPUT, text: 'second' }, [64]);
    expect((await cache.stats()).utterances).toBe(2);
    clock += 10;
    await seed(cache, { ...KEY_INPUT, text: 'third' }, [64]);
    expect((await cache.stats()).utterances).toBe(2);
    expect(await cache.lookup(first.keys[0])).toBeNull();
    for (const key of first.keys) {
      expect(await cache.lookup(key), `chunk ${key} must leave with its utterance`).toBeNull();
    }
    for (const key of second.keys) {
      expect(await cache.lookup(key)).not.toBeNull();
    }
  });

  it('touches every chunk of an utterance so a replay never evicts its head', async () => {
    let clock = 1000;
    const cache = create({ maxUtterances: () => 2, now: () => clock });
    const long = await seed(cache, { ...KEY_INPUT, text: 'long' }, [64, 64, 64]);
    clock += 10;
    const middle = await seed(cache, { ...KEY_INPUT, text: 'middle' }, [64]);
    clock += 10;
    expect(await cache.lookup(long.keys[2])).not.toBeNull();
    clock += 10;
    await seed(cache, { ...KEY_INPUT, text: 'newer' }, [64]);
    expect(await cache.lookup(middle.keys[0])).toBeNull();
    for (const key of long.keys) {
      expect(await cache.lookup(key), `head ${key} survives a replay touch`).not.toBeNull();
    }
  });

  it('honors the byte budget', async () => {
    const cache = create({ maxUtterances: () => 50, maxBytes: () => 200 });
    const big = await seed(cache, { ...KEY_INPUT, text: 'big' }, [100, 100, 100]);
    expect((await cache.stats()).bytes).toBeLessThanOrEqual(200);
    for (const key of big.keys) {
      expect(readdirSync(dir).includes(`${key}.wav`)).toBe(false);
    }
    const small = await seed(cache, { ...KEY_INPUT, text: 'small' }, [100]);
    expect((await cache.stats()).bytes).toBe(100);
    for (const key of small.keys) {
      expect(await cache.lookup(key)).not.toBeNull();
    }
  });

  it('skips an utterance whose chunk is still being written', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowKey = speechCacheKey({ ...KEY_INPUT, text: 'in flight' });
    const slowFs = createSlowWriteFs(gate, slowKey);
    const cache = create({ fs: slowFs, maxUtterances: () => 1 });
    const settledKey = speechCacheKey({ ...KEY_INPUT, text: 'settled' });
    await cache.registerUtterance([settledKey, slowKey]);
    await cache.store(settledKey, audio());
    const pending = cache.store(slowKey, audio());
    await seed(cache, { ...KEY_INPUT, text: 'newcomer' }, [64, 64]);
    expect(readdirSync(dir)).toContain(`${settledKey}.wav`);
    expect(await cache.lookup(settledKey)).not.toBeNull();
    release!();
    await pending;
  });
});

describe('speech cache write safety (plan 58 races 2/12)', () => {
  it('single-flights concurrent writes of the same key', async () => {
    const writes: string[] = [];
    const fs = createCountingFs(writes);
    const cache = create({ fs });
    const key = cache.keyOf(KEY_INPUT);
    const [left, right] = await Promise.all([cache.store(key, audio()), cache.store(key, audio())]);
    expect(left).toBe(right);
    expect(writes.filter((name) => name.endsWith('.tmp') && !name.endsWith(`${SPEECH_CACHE_INDEX_FILE}.tmp`))).toHaveLength(1);
  });

  it('retries a rename once (AV/indexer EPERM), then succeeds', async () => {
    const fs = createRetryRenameFs();
    const cache = create({ fs });
    const key = cache.keyOf(KEY_INPUT);
    expect(await cache.store(key, audio())).toBe(speechCacheUrl(`${key}.wav`));
    expect(fs.renames).toBe(2);
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('degrades to the ephemeral path when the write keeps failing', async () => {
    const logs: string[] = [];
    const fs = createFailingRenameFs();
    const cache = create({ fs, log: (message) => logs.push(message) });
    const key = cache.keyOf(KEY_INPUT);
    expect(await cache.store(key, audio())).toBeNull();
    expect(logs).toHaveLength(1);
    expect(await cache.stats()).toMatchObject({ available: true, utterances: 0 });
  });

  it('marks the cache unavailable for the session on EACCES', async () => {
    const logs: string[] = [];
    const fs = createUnwritableFs();
    const cache = create({ fs, log: (message) => logs.push(message) });
    await cache.load();
    expect(await cache.stats()).toMatchObject({ available: false });
    expect(await cache.store(cache.keyOf(KEY_INPUT), audio())).toBeNull();
    expect(logs).toHaveLength(1);
  });

  it('deletes a leftover tmp file at boot and re-creates the dir per write', async () => {
    const cache = create();
    const key = cache.keyOf(KEY_INPUT);
    writeFileSync(join(dir, `${key}.orphan.tmp`), 'partial');
    await cache.load();
    expect(readdirSync(dir)).not.toContain(`${key}.orphan.tmp`);
    rmSync(dir, { recursive: true, force: true });
    expect(await cache.store(key, audio())).toBe(speechCacheUrl(`${key}.wav`));
    expect(readdirSync(dir)).toContain(`${key}.wav`);
  });
});

describe('speech cache boot pass (plan 58 §4.3)', () => {
  it('keeps indexed chunks and deletes unknown, orphaned and corrupt files', async () => {
    const keeper = 'a'.repeat(64);
    const orphan = 'b'.repeat(64);
    writeFileSync(join(dir, `${keeper}.wav`), Buffer.alloc(32, 1));
    writeFileSync(join(dir, `${orphan}.wav`), Buffer.alloc(16, 1));
    writeFileSync(join(dir, 'not-a-chunk.wav'), 'x');
    writeFileSync(join(dir, 'short.wav'), 'x');
    writeFileSync(
      join(dir, SPEECH_CACHE_INDEX_FILE),
      JSON.stringify({ version: 1, utterances: { [utteranceHashOf([keeper])]: { chunks: [keeper], touchedAt: 10 } } })
    );
    const cache = create();
    await cache.load();
    const names = readdirSync(dir);
    expect(names).toContain(`${keeper}.wav`);
    expect(names).not.toContain(`${orphan}.wav`);
    expect(names).not.toContain('not-a-chunk.wav');
    expect(names).not.toContain('short.wav');
    expect(await cache.lookup(keeper)).not.toBeNull();
    expect(await cache.stats()).toMatchObject({ utterances: 1, bytes: 32 });
  });

  it('treats a corrupt index as empty and drops unfingerprinted files', async () => {
    const key = 'c'.repeat(64);
    writeFileSync(join(dir, `${key}.wav`), Buffer.alloc(8, 1));
    writeFileSync(join(dir, SPEECH_CACHE_INDEX_FILE), '{not json');
    const cache = create();
    await cache.load();
    expect(readdirSync(dir)).not.toContain(`${key}.wav`);
    expect(await cache.stats()).toMatchObject({ utterances: 0, bytes: 0 });
  });

  it('reads a stored chunk and refuses a directory or a foreign name', async () => {
    const cache = create();
    const key = cache.keyOf(KEY_INPUT);
    await cache.store(key, audio(24));
    const file = await cache.read(`${key}.wav`);
    expect(file?.mime).toBe('audio/wav');
    expect(file?.data.length).toBe(24);
    expect(await cache.read(`${'d'.repeat(64)}.wav`)).toBeNull();
    expect(await cache.read('../escape.wav')).toBeNull();
    mkdirSync(join(dir, `${'e'.repeat(64)}.wav`));
    expect(await cache.read(`${'e'.repeat(64)}.wav`)).toBeNull();
  });
});

describe('speech cache encoding', () => {
  it('maps the audio mimes the providers return', () => {
    expect(extensionForMime('audio/wav')).toBe('wav');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('audio/weird')).toBe('bin');
    expect(SPEECH_CACHE_FILE_RE.test(`${'f'.repeat(64)}.wav`)).toBe(true);
    expect(SPEECH_CACHE_FILE_RE.test(`${'f'.repeat(63)}.wav`)).toBe(false);
    expect(SPEECH_CACHE_FILE_RE.test(`${'F'.repeat(64)}.wav`)).toBe(false);
  });

  it('persists only hashes in the index (no plaintext text)', async () => {
    const cache = create();
    await seed(cache, KEY_INPUT, [64]);
    const raw = readFileSync(join(dir, SPEECH_CACHE_INDEX_FILE), 'utf8');
    expect(raw).not.toContain(KEY_INPUT.text);
    expect(raw).toMatch(/[a-f0-9]{64}/);
  });
});

function createCountingFs(writes: string[]): SpeechCacheFileSystem {
  return {
    mkdir: async (path) => mkdirSync(path, { recursive: true }),
    readdir: async (path) => readdirSync(path),
    readFile: async (path) => readFileSync(path),
    writeFile: async (path, data) => {
      writes.push(path);
      const fs = await import('node:fs/promises');
      await fs.writeFile(path, data);
    },
    rename: async (from, to) => {
      const fs = await import('node:fs/promises');
      await fs.rename(from, to);
    },
    rm: async (path, options) => {
      const fs = await import('node:fs/promises');
      await fs.rm(path, options);
    },
    stat: async (path) => {
      const fs = await import('node:fs/promises');
      return fs.stat(path);
    },
    utimes: async (path, atime, mtime) => {
      const fs = await import('node:fs/promises');
      await fs.utimes(path, atime, mtime);
    },
  };
}

function createSlowWriteFs(gate: Promise<void>, slowKey: string): SpeechCacheFileSystem {
  const base = createCountingFs([]);
  return {
    ...base,
    mkdir: async (path) => {
      mkdirSync(path, { recursive: true });
    },
    writeFile: async (path, data) => {
      if (path.includes(slowKey) && path.endsWith('.tmp')) {
        await gate;
      }
      const fs = await import('node:fs/promises');
      await fs.writeFile(path, data);
    },
  };
}

function createRetryRenameFs(): SpeechCacheFileSystem & { renames: number } {
  const base = createCountingFs([]);
  let attempts = 0;
  return {
    ...base,
    get renames() {
      return attempts;
    },
    rename: async (from, to) => {
      if (to.endsWith(SPEECH_CACHE_INDEX_FILE)) {
        const fs = await import('node:fs/promises');
        await fs.rename(from, to);
        return;
      }
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('EPERM: operation not permitted') as Error & { code: string };
        error.code = 'EPERM';
        throw error;
      }
      const fs = await import('node:fs/promises');
      await fs.rename(from, to);
    },
  };
}

function createFailingRenameFs(): SpeechCacheFileSystem {
  const base = createCountingFs([]);
  return {
    ...base,
    rename: async () => {
      const error = new Error('EPERM: operation not permitted') as Error & { code: string };
      error.code = 'EPERM';
      throw error;
    },
  };
}

function createUnwritableFs(): SpeechCacheFileSystem {
  const base = createCountingFs([]);
  const deny = async () => {
    const error = new Error('EACCES: permission denied') as Error & { code: string };
    error.code = 'EACCES';
    throw error;
  };
  return {
    ...base,
    mkdir: deny,
    readdir: deny,
  };
}
