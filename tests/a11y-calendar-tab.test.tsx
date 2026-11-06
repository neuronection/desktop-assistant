// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { CalendarTab } from '@renderer/settings-react/tabs/CalendarTab';
import type { CalendarCatalogView, ConnectorAccountView } from '@shared/connectors';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

const catalog: CalendarCatalogView = {
  providers: [
    {
      id: 'google',
      label: 'Google',
      protocol: 'google-calendar',
      bindable: true,
      clientIdConfigured: false,
      clientIdEnv: 'DESKTOP_GOOGLE_CLIENT_ID',
      scopesRead: ['https://www.googleapis.com/auth/calendar.readonly'],
      scopesWrite: ['https://www.googleapis.com/auth/calendar.events'],
      domains: ['accounts.google.com', 'www.googleapis.com'],
    },
  ],
  upcoming: [{ id: 'nextcloud', label: 'Nextcloud', protocol: 'caldav' }],
};

const account: ConnectorAccountView = {
  id: 'acct-1',
  provider: 'google',
  providerLabel: 'Google',
  protocol: 'google-calendar',
  label: 'Personal',
  authKind: 'oauth',
  status: 'needs-auth',
  expiresAt: null,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  consecutiveFailures: 1,
  revocable: true,
};

beforeEach(() => {
  window.electronAPI = {
    getCalendarCatalog: vi.fn(async () => catalog),
    listCalendarAccounts: vi.fn(async () => [account]),
    startCalendarBind: vi.fn(async () => ({ ok: true as const, accountId: 'acct-1' })),
    cancelCalendarBind: vi.fn(async () => true),
    getCalendarBindStatus: vi.fn(async () => ({ providerId: 'google', state: 'idle' as const, accountId: null, code: null, error: null })),
    unbindCalendarAccount: vi.fn(async () => true),
    testCalendarAccount: vi.fn(async () => ({ ok: true, latencyMs: 12, error: null })),
    writeToClipboard: vi.fn(async () => true),
    openExternal: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI;
});

describe('Settings → Calendar accessibility', () => {
  it('is axe-clean with an unconfigured provider and a needs-auth account', async () => {
    const { container } = render(<CalendarTab />);
    await screen.findByText(TEXT.CALENDAR_TITLE);
    await screen.findByText('Personal');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => `${violation.id} (${violation.impact})`)).toEqual([]);
  });
});
