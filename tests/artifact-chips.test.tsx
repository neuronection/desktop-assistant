// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { ArtifactChips } from '@renderer/chat-react/ArtifactChips';
import type { FileArtifact } from '@shared/artifacts';

beforeAll(() => {
  window.electronAPI = {
    openPath: vi.fn(async (path: string) => (path === '/broken/x.pdf' ? 'EACCES: permission denied' : null)),
    showItemInFolder: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI;
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

const file: FileArtifact = {
  kind: 'file',
  path: '/home/ilias/Downloads/sample.pdf',
  name: 'sample.pdf',
  sizeBytes: 13312,
};
const folder: FileArtifact = { kind: 'folder', path: '/home/ilias/Downloads/exports', name: 'exports' };

describe('ArtifactChips', () => {
  it('renders nothing without artifacts', () => {
    const { container } = render(<ArtifactChips artifacts={[]} />);
    expect(container.querySelector('ul')).toBeNull();
  });

  it('renders file and folder chips with size and path tooltip', () => {
    render(<ArtifactChips artifacts={[file, folder]} />);
    expect(screen.getByRole('list', { name: 'Files from this turn' })).toBeTruthy();
    expect(screen.getByText('sample.pdf')).toBeTruthy();
    expect(screen.getByText('13 KB')).toBeTruthy();
    expect(screen.getByText('folder', { selector: 'span' })).toBeTruthy();
    expect(screen.getByTitle('/home/ilias/Downloads/sample.pdf')).toBeTruthy();
  });

  it('opens the file through the sanctioned main-process IPC on click', async () => {
    render(<ArtifactChips artifacts={[file]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open sample.pdf' }));
    await waitFor(() => {
      expect(window.electronAPI.openPath).toHaveBeenCalledWith('/home/ilias/Downloads/sample.pdf');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a main-side open failure as an alert, never a crash', async () => {
    render(<ArtifactChips artifacts={[{ ...file, path: '/broken/x.pdf', name: 'x.pdf' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open x.pdf' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('EACCES');
  });

  it('reveals the item in the folder', () => {
    render(<ArtifactChips artifacts={[folder]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show exports in folder' }));
    expect(window.electronAPI.showItemInFolder).toHaveBeenCalledWith('/home/ilias/Downloads/exports');
  });

  it('is axe-clean for files and folders', async () => {
    const { container } = render(<ArtifactChips artifacts={[file, folder]} />);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
