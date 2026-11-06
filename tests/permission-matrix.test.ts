import { describe, it, expect } from 'vitest';
import { resolvePermissionRequest, isAppOrigin } from '@main/security/permissions';

const PROD_FILE_URL = 'file:///opt/desktop-assistant/dist/renderer/index.html';
const DEV_URL = 'http://localhost:3300/index.html';
const DEV_127_URL = 'http://127.0.0.1:3300/index.html';
const EVIL_URL = 'https://evil.example/payload.html';

describe('isAppOrigin (plan 46 S1)', () => {
  it('accepts the packaged file:// bundle in production', () => {
    expect(isAppOrigin(PROD_FILE_URL, false)).toBe(true);
  });

  it('accepts the dev server origin only in dev', () => {
    expect(isAppOrigin(DEV_URL, true)).toBe(true);
    expect(isAppOrigin(DEV_127_URL, true)).toBe(true);
    expect(isAppOrigin(DEV_URL, false)).toBe(false);
  });

  it('rejects remote and unparseable origins', () => {
    expect(isAppOrigin(EVIL_URL, true)).toBe(false);
    expect(isAppOrigin(EVIL_URL, false)).toBe(false);
    expect(isAppOrigin('not a url', true)).toBe(false);
  });
});

describe('resolvePermissionRequest — the permission matrix (plan 46 S1)', () => {
  it('grants the microphone (audio media) on the packaged app origin', () => {
    expect(resolvePermissionRequest({ url: PROD_FILE_URL, permission: 'media', mediaTypes: ['audio'], isDev: false })).toBe('granted');
  });

  it('grants the legacy media shape with no media types on the app origin', () => {
    expect(resolvePermissionRequest({ url: PROD_FILE_URL, permission: 'media', isDev: false })).toBe('granted');
  });

  it('denies camera-carrying media requests on the app origin', () => {
    expect(resolvePermissionRequest({ url: PROD_FILE_URL, permission: 'media', mediaTypes: ['video'], isDev: false })).toBe('denied');
    expect(resolvePermissionRequest({ url: PROD_FILE_URL, permission: 'media', mediaTypes: ['audio', 'video'], isDev: false })).toBe('denied');
  });

  it('grants the microphone on the dev server origin', () => {
    expect(resolvePermissionRequest({ url: DEV_URL, permission: 'media', mediaTypes: ['audio'], isDev: true })).toBe('granted');
    expect(resolvePermissionRequest({ url: DEV_127_URL, permission: 'media', mediaTypes: ['audio'], isDev: true })).toBe('granted');
  });

  it('denies everything but media on the app origin', () => {
    for (const permission of ['geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'camera']) {
      expect(resolvePermissionRequest({ url: PROD_FILE_URL, permission, isDev: false }), permission).toBe('denied');
    }
  });

  it('denies the microphone on any non-app origin, in dev and production', () => {
    expect(resolvePermissionRequest({ url: EVIL_URL, permission: 'media', mediaTypes: ['audio'], isDev: true })).toBe('denied');
    expect(resolvePermissionRequest({ url: EVIL_URL, permission: 'media', mediaTypes: ['audio'], isDev: false })).toBe('denied');
  });

  it('denies media on unparseable URLs', () => {
    expect(resolvePermissionRequest({ url: 'not a url', permission: 'media', mediaTypes: ['audio'], isDev: true })).toBe('denied');
  });
});
