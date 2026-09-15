// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { AutomationTab } from '@renderer/settings-react/tabs/AutomationTab';
import type { ScheduleView } from '@shared/schedules';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

function view(overrides: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id: 's1',
    name: 'Morning briefing',
    prompt: 'Summarize my calendar and inbox.',
    spec: { kind: 'daily', time: '09:00' },
    specLabel: 'daily at 09:00',
    timezone: 'America/New_York',
    enabled: true,
    lastRunAt: '2026-09-14T13:00:00.000Z',
    lastOutcome: 'ok',
    nextRunAt: '2026-09-15T13:00:00.000Z',
    conversationId: 'conv_1',
    ...overrides,
  };
}

function mockApi(overrides: Record<string, unknown> = {}): void {
  window.electronAPI = {
    listSchedules: vi.fn(async () => [view()]),
    createSchedule: vi.fn(async () => view({ id: 's2' })),
    updateSchedule: vi.fn(async () => view()),
    deleteSchedule: vi.fn(async () => true),
    runScheduleNow: vi.fn(async () => true),
    ...overrides,
  } as unknown as typeof window.electronAPI;
}

describe('AutomationTab', () => {
  it('renders loading then empty state', async () => {
    mockApi();
    let resolveRows: (rows: ScheduleView[]) => void = () => {};
    window.electronAPI.listSchedules = vi.fn(
      () =>
        new Promise<ScheduleView[]>((resolve) => {
          resolveRows = resolve;
        })
    );
    render(<AutomationTab />);
    expect(screen.getByRole('status')).toBeTruthy();
    resolveRows([]);
    await screen.findByText('No schedules yet. Create one to have a prompt run on a rhythm.');
  });

  it('validates through the wizard with an inline alert, then recovers', async () => {
    mockApi({ listSchedules: vi.fn(async () => []) });
    render(<AutomationTab />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'New schedule' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('check the highlighted fields');
    expect(window.electronAPI.createSchedule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the error state with a working retry', async () => {
    let calls = 0;
    mockApi({
      listSchedules: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('boom');
        }
        return [view()];
      }),
    });
    render(<AutomationTab />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Schedules could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Morning briefing');
  });

  it('lists schedules with next-run relative time, spec label and timezone', async () => {
    mockApi();
    render(<AutomationTab />);
    await screen.findByText('Morning briefing');
    expect(screen.getByText('daily at 09:00')).toBeTruthy();
    expect(screen.getByText(/America\/New_York/)).toBeTruthy();
    expect(screen.getByText(/Next run/)).toBeTruthy();
  });

  it('toggles a schedule through the update channel', async () => {
    const updateSchedule = vi.fn(async () => view());
    mockApi({ updateSchedule });
    render(<AutomationTab />);
    await screen.findByText('Morning briefing');
    fireEvent.click(screen.getByRole('switch', { name: 'Morning briefing — Enabled' }));
    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith('s1', { enabled: false });
    });
  });

  it('runs a schedule now with an inline queued status', async () => {
    mockApi();
    render(<AutomationTab />);
    await screen.findByText('Morning briefing');
    fireEvent.click(screen.getByRole('button', { name: 'Run now — Morning briefing' }));
    await screen.findByRole('status');
    expect(window.electronAPI.runScheduleNow).toHaveBeenCalledWith('s1');
  });

  it('deletes through the confirmation modal', async () => {
    mockApi();
    render(<AutomationTab />);
    await screen.findByText('Morning briefing');
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule — Morning briefing' }));
    const confirm = await screen.findByRole('button', { name: 'Delete schedule' });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(window.electronAPI.deleteSchedule).toHaveBeenCalledWith('s1');
    });
  });

  it('creates a schedule via the wizard (interval preset)', async () => {
    mockApi();
    render(<AutomationTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }));
    fireEvent.change(screen.getByPlaceholderText('What should the assistant do each time this fires?'), {
      target: { value: 'Check the build' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Every N minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => {
      expect(window.electronAPI.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Check the build',
          spec: { kind: 'interval', minutes: 30 },
          timezone: expect.any(String),
        })
      );
    });
  });

  it('blocks saving an invalid cron with an inline alert', async () => {
    mockApi();
    render(<AutomationTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }));
    fireEvent.change(screen.getByPlaceholderText('What should the assistant do each time this fires?'), {
      target: { value: 'Check the build' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Advanced cron' }));
    const cronInput = screen.getByLabelText('Advanced cron');
    fireEvent.change(cronInput, { target: { value: 'not a cron' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('check the highlighted fields');
    expect(window.electronAPI.createSchedule).not.toHaveBeenCalled();
  });

  it('is axe-clean with a loaded list', async () => {
    mockApi();
    const { container } = render(<AutomationTab />);
    await screen.findByText('Morning briefing');
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('is axe-clean in the empty state and wizard', async () => {
    mockApi({ listSchedules: vi.fn(async () => []) });
    const { container } = render(<AutomationTab />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'New schedule' }))[0]);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
