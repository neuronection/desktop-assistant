// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshService() {
  vi.resetModules();
  const mod = await import('@renderer/services/NotificationService');
  return mod.NotificationService;
}

describe('NotificationService', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('shows an error toast without prior init (self-healing container, never alert)', async () => {
    const service = await freshService();
    service.showError('No default chat model is configured. Pick one in Settings → API Settings.');

    const container = document.getElementById('notification-container');
    expect(container).not.toBeNull();
    expect(container?.className).toContain('notification-container');

    const toast = container?.querySelector('.toast-notification.error');
    expect(toast?.textContent).toContain('No default chat model is configured');
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('adopts an existing #notification-container instead of creating a duplicate', async () => {
    const existing = document.createElement('div');
    existing.id = 'notification-container';
    existing.className = 'notification-container';
    document.body.appendChild(existing);

    const service = await freshService();
    service.showSuccess('Settings saved successfully!');

    expect(document.querySelectorAll('#notification-container')).toHaveLength(1);
    expect(existing.querySelector('.toast-notification.success')?.textContent).toContain('Settings saved');
  });

  it('renders into the element passed to init()', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host') as HTMLElement;

    const service = await freshService();
    service.init(host);
    service.showError('boom');

    expect(host.querySelector('.toast-notification.error')?.textContent).toContain('boom');
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('treats the message as text (no HTML injection)', async () => {
    const service = await freshService();
    service.showError('<img src=x onerror=alert(1)>');

    const toast = document.querySelector('.toast-notification.error');
    expect(toast?.querySelector('img')).toBeNull();
    expect(toast?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('NotificationService handler mode (compact launcher in-flow banner)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('routes notifications to the handler and suppresses DOM toasts', async () => {
    const service = await freshService();
    const seen: { message: string; type: string }[] = [];
    service.setHandler((message, type) => seen.push({ message, type }));

    service.showError('No default chat model is configured.');
    service.showSuccess('Deleted!');

    expect(seen).toEqual([
      { message: 'No default chat model is configured.', type: 'error' },
      { message: 'Deleted!', type: 'success' },
    ]);
    expect(document.getElementById('notification-container')).toBeNull();
  });

  it('clearing the handler restores toast rendering', async () => {
    const service = await freshService();
    service.setHandler(() => undefined);
    service.showError('routed');
    service.setHandler(null);
    service.showError('toasted');

    const toast = document.querySelector('.toast-notification.error');
    expect(toast?.textContent).toContain('toasted');
    expect(toast?.textContent).not.toContain('routed');
  });
});
