// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { CalendarTab } from '@renderer/settings-react/tabs/CalendarTab';
import type { CalendarCatalogView, ConnectorAccountView } from '@shared/connectors';
import { TEXT } from '@shared/constants/text';

// Consent honesty (ADR-0042 clause 4 / ADR-0052 §3): the bind surface shows
// the verbatim provider scope strings and destination domains; a re-bind
// shows scope growth AND removal; unbind copy never claims a revocation the
// provider cannot perform (Microsoft has no revoke URL).

afterEach(cleanup);

const catalog: CalendarCatalogView = {
  providers: [
    {
      id: 'google',
      label: 'Google',
      protocol: 'google-calendar',
      bindable: true,
      clientIdConfigured: true,
      clientIdEnv: 'DESKTOP_GOOGLE_CLIENT_ID',
      scopesRead: ['https://www.googleapis.com/auth/calendar.readonly'],
      scopesWrite: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
      domains: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
    },
    {
      id: 'microsoft',
      label: 'Microsoft 365',
      protocol: 'graph-calendar',
      bindable: true,
      clientIdConfigured: false,
      clientIdEnv: 'DESKTOP_MICROSOFT_CLIENT_ID',
      scopesRead: ['Calendars.Read'],
      scopesWrite: ['Calendars.ReadWrite'],
      domains: ['login.microsoftonline.com', 'graph.microsoft.com'],
    },
  ],
  upcoming: [
    { id: 'nextcloud', label: 'Nextcloud', protocol: 'caldav' },
    { id: 'ics', label: 'ICS subscription', protocol: 'ics' },
  ],
};

function account(overrides: Partial<ConnectorAccountView> = {}): ConnectorAccountView {
  return {
    id: 'acct-1',
    provider: 'google',
    providerLabel: 'Google',
    protocol: 'google-calendar',
    label: 'Personal',
    authKind: 'oauth',
    status: 'ok',
    expiresAt: new Date('2026-12-01T00:00:00Z').toISOString(),
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    consecutiveFailures: 0,
    revocable: true,
    ...overrides,
  };
}

function makeBridge() {
  return {
    getCalendarCatalog: vi.fn(async () => catalog),
    listCalendarAccounts: vi.fn(async () => [] as ConnectorAccountView[]),
    startCalendarBind: vi.fn(async () => ({ ok: true as const, accountId: 'acct-x' })),
    cancelCalendarBind: vi.fn(async () => true),
    getCalendarBindStatus: vi.fn(async () => ({ providerId: 'google', state: 'idle' as const, accountId: null, code: null, error: null })),
    unbindCalendarAccount: vi.fn(async () => true),
    testCalendarAccount: vi.fn(async () => ({ ok: true, latencyMs: 12, error: null })),
    writeToClipboard: vi.fn(async () => true),
    openExternal: vi.fn(async () => undefined),
  };
}

let bridge: ReturnType<typeof makeBridge>;

beforeEach(() => {
  bridge = makeBridge();
  (window as unknown as { electronAPI: unknown }).electronAPI = bridge;
});

describe('Settings → Calendar consent honesty (plan 52 H)', () => {
  it('renders the catalog: providers from data, upcoming without adapters', async () => {
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Google')).toBeTruthy());
    expect(screen.getByText('Microsoft 365')).toBeTruthy();
    // Upcoming comes from the catalog view, not from hand-written copy.
    expect(bridge.getCalendarCatalog).toHaveBeenCalled();
  });

  it('an unconfigured provider explains the env var and disables Connect', async () => {
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Microsoft 365')).toBeTruthy());
    const microsoft = screen.getByText('Microsoft 365').closest('li') as HTMLElement;
    expect(within(microsoft).getByText(/Register a desktop OAuth client/)).toBeTruthy();
    expect(within(microsoft).getByText('DESKTOP_MICROSOFT_CLIENT_ID')).toBeTruthy();
    expect((within(microsoft).getByRole('button', { name: /connect/i }) as HTMLButtonElement).disabled).toBe(true);

    const google = screen.getByText('Google').closest('li') as HTMLElement;
    expect(within(google).queryByText(/Register a desktop OAuth client/)).toBeNull();
    expect((within(google).getByRole('button', { name: /connect/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('copies the env var name and opens the setup guide', async () => {
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Microsoft 365')).toBeTruthy());
    const microsoft = screen.getByText('Microsoft 365').closest('li') as HTMLElement;
    fireEvent.click(within(microsoft).getByRole('button', { name: TEXT.CALENDAR_COPY_ENV }));
    await waitFor(() => expect(bridge.writeToClipboard).toHaveBeenCalledWith('DESKTOP_MICROSOFT_CLIENT_ID'));
    expect(within(microsoft).getByText(TEXT.CALENDAR_COPIED)).toBeTruthy();

    fireEvent.click(within(microsoft).getByRole('button', { name: TEXT.CALENDAR_SETUP_GUIDE }));
    await waitFor(() => expect(bridge.openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/user/calendar.md')));
  });

  it('the consent modal shows verbatim scope strings and verbatim destination domains', async () => {
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Google')).toBeTruthy());
    const google = screen.getByText('Google').closest('li') as HTMLElement;
    fireEvent.click(within(google).getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.getByText(/exactly these permissions/i)).toBeTruthy());
    // Verbatim — the full https URLs, never paraphrased.
    expect(screen.getByText('https://www.googleapis.com/auth/calendar.readonly')).toBeTruthy();
    expect(screen.getByText('https://www.googleapis.com/auth/calendar.events')).toBeTruthy();
    expect(screen.getByText('accounts.google.com')).toBeTruthy();
    expect(screen.getByText('www.googleapis.com')).toBeTruthy();
  });

  it('a re-bind shows scope growth against the stored grant', async () => {
    bridge.listCalendarAccounts.mockResolvedValue([account({ status: 'needs-auth', revocable: true })]);
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Personal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(screen.getByText(/exactly these permissions/i)).toBeTruthy());
    // Growth: calendar.events is requested but not yet granted.
    expect(screen.getByText(/New permissions being added:/)).toBeTruthy();
    expect(screen.getByText('+ https://www.googleapis.com/auth/calendar.events')).toBeTruthy();
    expect(screen.queryByText(/Permissions being dropped:/)).toBeNull();
  });

  it('a re-bind reuses the account instead of creating a duplicate', async () => {
    bridge.listCalendarAccounts.mockResolvedValue([account({ status: 'needs-auth', revocable: true })]);
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Personal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(screen.getByText(/exactly these permissions/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: TEXT.CALENDAR_CONSENT_START }));
    await waitFor(() =>
      expect(bridge.startCalendarBind).toHaveBeenCalledWith('google', 'Personal', 'acct-1')
    );
  });

  it('shows a failed bind instead of silently returning to idle', async () => {
    bridge.getCalendarBindStatus.mockResolvedValue({
      providerId: 'google',
      state: 'failed',
      accountId: null,
      code: 'cancelled',
      error: 'Consent was not granted.',
    });
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Google')).toBeTruthy());
    const google = screen.getByText('Google').closest('li') as HTMLElement;
    fireEvent.click(within(google).getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.getByText(/exactly these permissions/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: TEXT.CALENDAR_CONSENT_START }));
    expect(
      await screen.findByText(/Bind failed: Consent was not granted\./, undefined, { timeout: 5000 })
    ).toBeTruthy();
  });

  it('a re-bind shows scope removal — never a silent drop', async () => {
    // The catalog row narrowed (simulated by a narrower catalog view): the
    // stored grant holds calendar.events, the new consent no longer asks
    // for it — the removal must be shown, never silent.
    const narrowed: CalendarCatalogView = {
      ...catalog,
      providers: [
        {
          ...catalog.providers[0],
          scopesWrite: ['https://www.googleapis.com/auth/calendar.readonly'],
        },
      ],
    };
    bridge.getCalendarCatalog.mockResolvedValue(narrowed);
    bridge.listCalendarAccounts.mockResolvedValue([
      account({
        status: 'needs-auth',
        scopes: [
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.events',
        ],
      }),
    ]);
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Personal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(screen.getByText(/exactly these permissions/i)).toBeTruthy());
    expect(screen.getByText(/Permissions being dropped:/)).toBeTruthy();
    expect(screen.getByText('− https://www.googleapis.com/auth/calendar.events')).toBeTruthy();
  });

  it('unbind copy claims revocation only when the provider has a revoke URL', async () => {
    bridge.listCalendarAccounts.mockResolvedValue([account({ revocable: true })]);
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Personal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /disconnect — personal/i }));
    await waitFor(() => expect(screen.getByText(/Disconnect account\?/)).toBeTruthy());
    expect(screen.getByText(/revoked at the provider/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }).length ? screen.getByRole('button', { name: /^Cancel$/i }) : screen.getAllByRole('button').find((b) => b.textContent === 'Cancel')!);
  });

  it('a provider without a revoke URL never claims revocation happened', async () => {
    bridge.listCalendarAccounts.mockResolvedValue([account({ provider: 'microsoft', providerLabel: 'Microsoft 365', protocol: 'graph-calendar', revocable: false })]);
    render(<CalendarTab />);
    await waitFor(() => expect(screen.getByText('Personal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /disconnect — personal/i }));
    await waitFor(() => expect(screen.getByText(/Disconnect account\?/)).toBeTruthy());
    expect(screen.getByText(/no revoke endpoint/i)).toBeTruthy();
    expect(screen.queryByText(/revoked at the provider/i)).toBeNull();
  });
});
