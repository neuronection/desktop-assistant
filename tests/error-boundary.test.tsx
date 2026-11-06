// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import axe from 'axe-core';
import { Component, type ReactNode } from 'react';
import { ErrorBoundary } from '@renderer/shared/ErrorBoundary';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

class Bomb extends Component {
  render(): ReactNode {
    throw new Error('deliberate test crash');
  }
}

describe('ErrorBoundary (plan 46 S1)', () => {
  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p data-testid="fine">all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('fine')).toBeTruthy();
  });

  it('shows the TEXT-keyed failure card with a reload action when a child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).queryByText(TEXT.ERROR_BOUNDARY_TITLE)).not.toBeNull();
    expect(within(alert).queryByText(TEXT.ERROR_BOUNDARY_BODY)).not.toBeNull();
    expect(within(alert).queryByText('deliberate test crash')).not.toBeNull();
    expect(within(alert).queryByRole('button', { name: TEXT.ERROR_BOUNDARY_RELOAD })).not.toBeNull();
    consoleError.mockRestore();
  });

  it('the reload action calls window.location.reload', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: TEXT.ERROR_BOUNDARY_RELOAD }));
    expect(reload).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('reports the caught error through the renderer crash seam', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reportRendererError = vi.fn(async () => undefined);
    window.electronAPI = { reportRendererError } as unknown as typeof window.electronAPI;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(reportRendererError).toHaveBeenCalledTimes(1);
    const payload = reportRendererError.mock.calls[0][0];
    expect(payload.source).toBe('boundary');
    expect(payload.message).toBe('deliberate test crash');
    expect(payload.stack).toContain('deliberate test crash');
    consoleError.mockRestore();
  });

  it('the failure card is axe-clean (exclusion-free scan)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    const results = await axe.run(container);
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
    consoleError.mockRestore();
  });
});
