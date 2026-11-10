// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { ViewSwitcher } from '@renderer/shared/ViewSwitcher';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

describe('ViewSwitcher — one control for the three views (plan 73)', () => {
  it('shows the current view, lists the three as a radio menu, and hands off', () => {
    const onSelect = vi.fn();
    render(<ViewSwitcher current="desktop" onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA });
    expect(trigger.textContent).toContain(TEXT.VIEW_DESKTOP);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const options = screen.getAllByRole('menuitemradio');
    expect(options).toHaveLength(3);
    expect(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_DESKTOP) }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_COMPACT) }));
    expect(onSelect).toHaveBeenCalledWith('compact');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('reports the current view too, so the host can close its menu', () => {
    const onSelect = vi.fn();
    render(<ViewSwitcher current="expanded" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_EXPANDED) }));
    expect(onSelect).toHaveBeenCalledWith('expanded');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape closes the menu only — the app-level ladder never sees it', () => {
    const ladder = vi.fn();
    document.addEventListener('keydown', ladder, true);
    render(<ViewSwitcher current="compact" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA }));
    fireEvent.keyDown(document, { key: 'Escape' });
    document.removeEventListener('keydown', ladder, true);
    expect(ladder).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside pointerdown', async () => {
    render(<ViewSwitcher current="compact" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA }));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('shows the configured accelerator hints in the inline grid too', () => {
    render(
      <ViewSwitcher
        current="compact"
        variant="inline"
        hints={{ expanded: 'Ctrl+E', desktop: 'Ctrl+D' }}
        onSelect={vi.fn()}
      />
    );
    const expanded = screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_EXPANDED) });
    const desktop = screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_DESKTOP) });
    const compact = screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_COMPACT) });
    expect(expanded.querySelector('kbd')?.textContent).toBe('Ctrl+E');
    expect(desktop.querySelector('kbd')?.textContent).toBe('Ctrl+D');
    expect(compact.querySelector('kbd')).toBeNull();
  });

  it('renders inline as a radiogroup for the compact launcher menu', () => {
    const onSelect = vi.fn();
    render(<ViewSwitcher current="compact" variant="inline" onSelect={onSelect} />);
    expect(screen.getByRole('group', { name: TEXT.SWITCH_VIEW_ARIA })).toBeTruthy();
    expect(screen.queryByRole('button', { name: TEXT.SWITCH_VIEW_ARIA })).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_COMPACT) }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_DESKTOP) }));
    expect(onSelect).toHaveBeenCalledWith('desktop');
  });

  it('walks the grid with the arrow keys, one card per press', () => {
    render(<ViewSwitcher current="compact" variant="inline" onSelect={vi.fn()} />);
    const compact = screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_COMPACT) });
    compact.focus();
    fireEvent.keyDown(compact, { key: 'ArrowDown' });
    const expanded = screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_EXPANDED) });
    expect(document.activeElement).toBe(expanded);
    fireEvent.keyDown(expanded, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_DESKTOP) }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(expanded);
  });

  it('is axe-clean while open', { timeout: 30_000 }, async () => {
    const { container } = render(<ViewSwitcher current="desktop" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA }));
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id).join(',')).toBe('');
  });
});
