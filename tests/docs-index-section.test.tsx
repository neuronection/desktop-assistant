// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DocsIndexSection } from '@renderer/settings-react/tabs/ToolsTab';
import type { DocsRootView } from '@shared/docs';

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

const rows: DocsRootView[] = [
  { root: '/home/ilias/docs', indexed: true, files: 12, chunks: 140 },
  { root: '/home/ilias/notes', indexed: false, files: 0, chunks: 0 },
];

function setup(overrides: Partial<Parameters<typeof DocsIndexSection>[0]> = {}): {
  onToggle: ReturnType<typeof vi.fn>;
  onReindex: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn(async () => undefined);
  const onReindex = vi.fn(async () => undefined);
  render(
    <main>
      <DocsIndexSection rows={rows} busyRoot={null} onToggle={onToggle} onReindex={onReindex} {...overrides} />
    </main>
  );
  return { onToggle, onReindex };
}

describe('DocsIndexSection', () => {
  it('renders null without rows', () => {
    const { container } = render(
      <DocsIndexSection rows={[]} busyRoot={null} onToggle={vi.fn()} onReindex={vi.fn()} />
    );
    expect(container.querySelector('div')).toBeNull();
  });

  it('shows per-root counts for indexed folders and a switch for all', () => {
    setup();
    expect(screen.getByText('Document index')).toBeTruthy();
    expect(screen.getByText('12 files · 140 passages')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('toggles indexing per root', async () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getAllByRole('switch')[1]);
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith('/home/ilias/notes', true);
    });
  });

  it('offers re-index only for indexed roots', async () => {
    const { onReindex } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Re-index — /home/ilias/docs' }));
    await waitFor(() => {
      expect(onReindex).toHaveBeenCalledWith('/home/ilias/docs');
    });
    expect(screen.queryByRole('button', { name: 'Re-index — /home/ilias/notes' })).toBeNull();
  });

  it('shows the busy state while indexing', () => {
    setup({ busyRoot: '/home/ilias/docs' });
    expect(screen.getByRole('status', { name: '' })).toBeTruthy();
    expect(screen.getByText('Indexing…')).toBeTruthy();
  });

  it('is axe-clean', async () => {
    const { container } = setup();
    const results = await axe.run(container);
    // Document-level artifacts of the jsdom fragment harness (the full
    // app sets title/lang; see settings-commands-tab.test.tsx).
    const componentViolations = results.violations.filter(
      (violation) => !['document-title', 'html-has-lang'].includes(violation.id)
    );
    expect(componentViolations).toEqual([]);
  });
});
