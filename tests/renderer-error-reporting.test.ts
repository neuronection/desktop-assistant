// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installErrorReporting } from '@renderer/shared/installErrorReporting';

const disposers: Array<() => void> = [];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function mockReporter(): { reportRendererError: ReturnType<typeof vi.fn> } {
  const reportRendererError = vi.fn(async () => undefined);
  window.electronAPI = { reportRendererError } as unknown as typeof window.electronAPI;
  return { reportRendererError };
}

describe('installErrorReporting (plan 46 S1)', () => {
  it('forwards window error events to the renderer crash seam', () => {
    const { reportRendererError } = mockReporter();
    disposers.push(installErrorReporting());
    const failure = new Error('window boom');
    window.dispatchEvent(new ErrorEvent('error', { error: failure, message: 'window boom' }));
    expect(reportRendererError).toHaveBeenCalledTimes(1);
    const payload = reportRendererError.mock.calls[0][0];
    expect(payload.source).toBe('error');
    expect(payload.message).toBe('window boom');
    expect(payload.stack).toContain('window boom');
  });

  it('forwards unhandled rejections with their reason', () => {
    const { reportRendererError } = mockReporter();
    disposers.push(installErrorReporting());
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
    Object.defineProperty(rejection, 'reason', { value: new Error('promise boom') });
    window.dispatchEvent(rejection);
    expect(reportRendererError).toHaveBeenCalledTimes(1);
    const payload = reportRendererError.mock.calls[0][0];
    expect(payload.source).toBe('unhandledrejection');
    expect(payload.message).toBe('promise boom');
  });

  it('caps oversized messages at the IPC contract limit', () => {
    const { reportRendererError } = mockReporter();
    disposers.push(installErrorReporting());
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('x'.repeat(5000)), message: 'x'.repeat(5000) }));
    const payload = reportRendererError.mock.calls[0][0];
    expect(payload.message.length).toBeLessThanOrEqual(2000);
  });

  it('stays silent and unthrowing when no bridge exists', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    disposers.push(installErrorReporting());
    expect(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('no bridge'), message: 'no bridge' }))).not.toThrow();
  });

  it('is idempotent: a second install never re-registers the listeners', () => {
    const { reportRendererError } = mockReporter();
    disposers.push(installErrorReporting());
    disposers.push(installErrorReporting());
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('once'), message: 'once' }));
    expect(reportRendererError).toHaveBeenCalledTimes(1);
  });
});
