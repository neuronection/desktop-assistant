import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SPEECH_CACHE_PRIVILEGES,
  createSpeechCacheProtocolHandler,
  registerSpeechCacheProtocol,
  registerSpeechCacheScheme,
  type SpeechCacheProtocolTarget,
  type SpeechCacheReader,
} from '@main/services/SpeechCacheProtocol';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

const KEY = 'a'.repeat(64);

function target(): SpeechCacheProtocolTarget & {
  registerSchemesAsPrivileged: ReturnType<typeof vi.fn>;
  handle: ReturnType<typeof vi.fn>;
} {
  return { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() };
}

function reader(result: { data: Buffer; mime: string } | null): SpeechCacheReader {
  return { read: vi.fn(async () => result) };
}

const request = (url: string): Request => ({ url }) as Request;

describe('speech-cache scheme registration (plan 58 §4.3)', () => {
  it('declares the scheme privileged for streaming media', () => {
    const sink = target();
    registerSpeechCacheScheme(sink);
    expect(sink.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'speech-cache', privileges: { ...SPEECH_CACHE_PRIVILEGES } },
    ]);
    expect(SPEECH_CACHE_PRIVILEGES).toMatchObject({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    });
  });

  it('binds the handler to the scheme', () => {
    const sink = target();
    registerSpeechCacheProtocol({ read: async () => null }, sink);
    expect(sink.handle).toHaveBeenCalledWith('speech-cache', expect.any(Function));
  });

  it('registers the scheme before app.whenReady in the boot module', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/main.ts'), 'utf8');
    const scheme = source.indexOf('registerSpeechCacheScheme()');
    const ready = source.indexOf('app.whenReady()');
    expect(scheme).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(-1);
    expect(scheme).toBeLessThan(ready);
  });
});

describe('speech-cache protocol handler is total (plan 58 race 1)', () => {
  it('serves a cached chunk with its content type', async () => {
    const handler = createSpeechCacheProtocolHandler(reader({ data: Buffer.from('abc'), mime: 'audio/wav' }));
    const response = await handler(request(`speech-cache://chunk/${KEY}.wav`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/wav');
    expect(response.headers.get('Content-Length')).toBe('3');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('abc');
  });

  it('answers 404 for a non-hex key (traversal proof)', async () => {
    const cache = reader({ data: Buffer.from('x'), mime: 'audio/wav' });
    const handler = createSpeechCacheProtocolHandler(cache);
    for (const url of [
      'speech-cache://chunk/nothex.wav',
      'speech-cache://chunk/..%2F..%2Fetc%2Fpasswd',
      `speech-cache://chunk/${KEY.slice(1)}.wav`,
      `speech-cache://chunk/${KEY.toUpperCase()}.wav`,
      `speech-cache://chunk/${KEY}.wav/../../x`,
    ]) {
      expect((await handler(request(url))).status, url).toBe(404);
    }
    expect(cache.read).not.toHaveBeenCalled();
  });

  it('answers 404 for a well-formed key with no file or a directory', async () => {
    const handler = createSpeechCacheProtocolHandler(reader(null));
    expect((await handler(request(`speech-cache://chunk/${KEY}.wav`))).status).toBe(404);
  });

  it('never throws — a reader failure, malformed URL or foreign scheme is a 404', async () => {
    const failing: SpeechCacheReader = {
      read: async () => {
        throw new Error('boom');
      },
    };
    const handler = createSpeechCacheProtocolHandler(failing);
    expect((await handler(request(`speech-cache://chunk/${KEY}.wav`))).status).toBe(404);
    expect((await handler(request('speech-cache://'))).status).toBe(404);
    expect((await handler(request('not a url'))).status).toBe(404);
    expect((await handler(request(`file:///tmp/${KEY}.wav`))).status).toBe(404);
    expect((await handler(request(`speech-cache://chunk/${KEY}%ZZ.wav`))).status).toBe(404);
  });
});
