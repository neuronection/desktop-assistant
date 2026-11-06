// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationsTab } from '@renderer/settings-react/tabs/NotificationsTab';
import { TEXT } from '@shared/constants/text';
import type { NotificationRecordView } from '@shared/notifications';

afterEach(cleanup);

function record(overrides: Partial<NotificationRecordView> = {}): NotificationRecordView {
  return {
    id: 'n-1',
    kind: 'schedule',
    severity: 'warn',
    title: 'Run failed',
    body: 'The nightly assessment did not finish.',
    payload: {},
    sourceRef: null,
    clickAction: 'none',
    dedupeKey: 'k',
    readAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function mockApi(records: NotificationRecordView[], listeners: ((change: unknown) => void)[] = []): void {
  window.electronAPI = {
    listNotifications: vi.fn(async () => records),
    markNotificationRead: vi.fn(async () => true),
    markAllNotificationsRead: vi.fn(async () => records.length),
    clearNotifications: vi.fn(async () => records.length),
    clickNotification: vi.fn(async () => true),
    onNotificationsChanged: vi.fn((callback: (change: unknown) => void) => {
      listeners.push(callback);
      return () => {};
    }),
  } as unknown as typeof window.electronAPI;
}

describe('NotificationsTab inbox (plan 42 S2)', () => {
  it('renders a record as a list item with severity, count and unread mark', async () => {
    mockApi([record({ payload: { count: 3 } })]);
    render(<NotificationsTab />);
    expect(await screen.findByText('Run failed')).toBeTruthy();
    expect(screen.getByText(TEXT.NOTIFICATIONS_SEVERITY_WARN)).toBeTruthy();
    expect(screen.getByText(TEXT.NOTIFICATIONS_TIMES.replace('{count}', '3'))).toBeTruthy();
    expect(screen.getAllByText(TEXT.NOTIFICATIONS_UNREAD).length).toBeGreaterThan(1);
  });

  it('filters to unread only', async () => {
    mockApi([record({ id: 'a', title: 'Unread one' }), record({ id: 'b', title: 'Read one', readAt: 5 })]);
    render(<NotificationsTab />);
    await screen.findByText('Unread one');
    fireEvent.click(screen.getByRole('button', { name: TEXT.NOTIFICATIONS_FILTER_UNREAD }));
    expect(screen.queryByText('Read one')).toBeNull();
    expect(screen.getByText('Unread one')).toBeTruthy();
  });

  it('marks one record read and routes a click through the shared router', async () => {
    mockApi([record({ clickAction: 'open-conversation', sourceRef: 'conv-1' })]);
    render(<NotificationsTab />);
    await screen.findByText('Run failed');
    fireEvent.click(screen.getByRole('button', { name: `${TEXT.NOTIFICATIONS_MARK_READ}: Run failed` }));
    await waitFor(() => expect(window.electronAPI.markNotificationRead).toHaveBeenCalledWith('n-1'));
    fireEvent.click(screen.getByRole('button', { name: TEXT.NOTIFICATIONS_ACTION_OPEN_CONVERSATION }));
    await waitFor(() => expect(window.electronAPI.clickNotification).toHaveBeenCalledWith('n-1'));
  });

  it('marks all read and clears the inbox after confirmation', async () => {
    mockApi([record()]);
    render(<NotificationsTab />);
    await screen.findByText('Run failed');
    fireEvent.click(screen.getByRole('button', { name: TEXT.NOTIFICATIONS_MARK_ALL_READ }));
    await waitFor(() => expect(window.electronAPI.markAllNotificationsRead).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: TEXT.NOTIFICATIONS_CLEAR }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(withinDialog(dialog, TEXT.NOTIFICATIONS_CLEAR));
    await waitFor(() => expect(window.electronAPI.clearNotifications).toHaveBeenCalled());
  });

  it('re-lists when main pushes a change', async () => {
    const listeners: ((change: unknown) => void)[] = [];
    mockApi([record()], listeners);
    render(<NotificationsTab />);
    await screen.findByText('Run failed');
    expect(window.electronAPI.listNotifications).toHaveBeenCalledTimes(1);
    listeners[0]?.({ reason: 'created', record: record({ id: 'n-2', title: 'Second' }) });
    await waitFor(() => expect(window.electronAPI.listNotifications).toHaveBeenCalledTimes(2));
  });
});

function withinDialog(dialog: HTMLElement, label: string): HTMLElement {
  const buttons = Array.from(dialog.querySelectorAll('button')).filter((button) => button.textContent === label);
  return buttons[buttons.length - 1] as HTMLElement;
}
