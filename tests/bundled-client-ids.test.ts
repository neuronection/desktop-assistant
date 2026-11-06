import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

const { clientIdFor, clientIdEnvFor } = await import('@main/services/cloud/ProviderCatalog');
const { BUNDLED_CLIENT_IDS } = await import('@main/services/cloud/bundledClientIds');

const row = { id: 'google' } as never;

describe('client id resolution (ADR-0042 §5 — the GNOME model)', () => {
  it('env wins (self-hosters and forks)', () => {
    expect(clientIdFor(row, { DESKTOP_GOOGLE_CLIENT_ID: 'from-env' } as never)).toBe('from-env');
  });

  it('falls back to the BUNDLED id — the shipped-build path', () => {
    // simulate a build that carries the family registration
    const original = BUNDLED_CLIENT_IDS.google;
    (BUNDLED_CLIENT_IDS as Record<string, string>).google = 'bundled-123';
    try {
      expect(clientIdFor(row, {} as never)).toBe('bundled-123');
    } finally {
      (BUNDLED_CLIENT_IDS as Record<string, string>).google = original;
    }
  });

  it('is null when neither is set — needs-config, never a crash', () => {
    expect(clientIdFor(row, {} as never)).toBeNull();
  });

  it('the env name is a convention over the provider id', () => {
    expect(clientIdEnvFor('microsoft')).toBe('DESKTOP_MICROSOFT_CLIENT_ID');
    expect(clientIdEnvFor('some-future-provider')).toBe('DESKTOP_SOME_FUTURE_PROVIDER_CLIENT_ID');
  });
});
