export type PermissionDecision = 'granted' | 'denied';

export interface PermissionRequestContext {
  url: string;
  permission: string;
  mediaTypes?: readonly string[];
  isDev: boolean;
}

/** The app origins a permission request may come from: the packaged
 * `file://` bundle, or the vite dev server (localhost/127.0.0.1) in dev. */
export function isAppOrigin(url: string, isDev: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:') {
    return true;
  }
  if (!isDev) {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
}

/**
 * Permission matrix (plan 46 S1): microphone only, on the app origin.
 * `media` requests grant audio-only captures (or a request carrying no
 * media types at all); anything carrying video — and every other
 * permission (geolocation, notifications, clipboard-read, …) — is
 * denied until a feature explicitly asks for it.
 */
export function resolvePermissionRequest(context: PermissionRequestContext): PermissionDecision {
  if (!isAppOrigin(context.url, context.isDev)) {
    return 'denied';
  }
  if (context.permission === 'media') {
    const video = context.mediaTypes?.includes('video') ?? false;
    return video ? 'denied' : 'granted';
  }
  return 'denied';
}
