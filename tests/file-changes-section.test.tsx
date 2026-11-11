// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { ElectronAPI, FileSnapshotListEntry } from '@shared/types';
import { FileChangesSection } from '@renderer/settings-react/tools/FileChangesSection';

afterEach(cleanup);

const rows: FileSnapshotListEntry[] = [
  {
    id: 'snap-1',
    path: '/home/me/notes.txt',
    size: 42,
    existed: true,
    createdAt: new Date('2026-11-11T09:00:00Z').toISOString(),
    available: true,
    allowed: true,
  },
];

describe('FileChangesSection', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      listFileSnapshots: vi.fn(async () => rows),
      revertFileSnapshot: vi.fn(async () => ({ ok: true, path: '/home/me/notes.txt' })),
    };
  });

  it('confirms before reverting and refreshes the list', async () => {
    render(<FileChangesSection />);
    expect(await screen.findByText('/home/me/notes.txt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(window.electronAPI.revertFileSnapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revert' }));
    await waitFor(() => expect(window.electronAPI.revertFileSnapshot).toHaveBeenCalledWith('snap-1'));
    expect(window.electronAPI.listFileSnapshots).toHaveBeenCalledTimes(2);
  });

  it('has no axe violations', async () => {
    const { container } = render(<FileChangesSection />);
    await screen.findByText('/home/me/notes.txt');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
