import { protocol } from 'electron';
import { SPEECH_CACHE_SCHEME } from '@shared/speech';
import { SPEECH_CACHE_FILE_RE, type SpeechCacheService } from '@main/services/SpeechCacheService';

export interface SpeechCacheProtocolTarget {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void;
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
}

export const SPEECH_CACHE_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
} as const;

export interface SpeechCacheReader {
  read(name: string): Promise<{ data: Buffer; mime: string } | null>;
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

/**
 * Total by contract (plan 58 §4.3): a thrown handler surfaces as
 * `net::ERR_FAILED`, which can fire no media event at all — the exact
 * silence the design fights. Traversal, a missing file and a directory
 * are all 404s.
 */
export function createSpeechCacheProtocolHandler(
  cache: SpeechCacheReader
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== `${SPEECH_CACHE_SCHEME}:`) {
        return notFound();
      }
      const name = decodeURIComponent(url.pathname).split('/').pop() ?? '';
      if (!SPEECH_CACHE_FILE_RE.test(name)) {
        return notFound();
      }
      const file = await cache.read(name);
      if (!file) {
        return notFound();
      }
      return new Response(new Uint8Array(file.data), {
        status: 200,
        headers: {
          'Content-Type': file.mime,
          'Content-Length': String(file.data.length),
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return notFound();
    }
  };
}

export function registerSpeechCacheScheme(target: SpeechCacheProtocolTarget = protocol): void {
  target.registerSchemesAsPrivileged([
    { scheme: SPEECH_CACHE_SCHEME, privileges: { ...SPEECH_CACHE_PRIVILEGES } },
  ]);
}

export function registerSpeechCacheProtocol(
  cache: SpeechCacheService,
  target: SpeechCacheProtocolTarget = protocol
): void {
  target.handle(SPEECH_CACHE_SCHEME, createSpeechCacheProtocolHandler(cache));
}
