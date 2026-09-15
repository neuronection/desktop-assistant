// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DownloadCard, findActiveDownload } from '@renderer/chat-react/DownloadCard';
import type { TurnStepProgress, TurnTraceStep } from '@shared/turns';

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

const active: TurnStepProgress = {
  downloadId: 'dl-1',
  destination: '/home/user/Downloads/report.pdf',
  loadedBytes: 524288,
  totalBytes: 1048576,
  status: 'active',
};

const unknownSize: TurnStepProgress = { ...active, totalBytes: null };

describe('DownloadCard', () => {
  it('renders the compact variant with percent and a cancel control', () => {
    const cancelled: string[] = [];
    render(<DownloadCard progress={active} onCancel={(id) => cancelled.push(id)} />);
    expect(screen.getByRole('status', { name: 'File download' })).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    expect(cancelled).toEqual(['dl-1']);
  });

  it('renders the rich variant with bytes, destination and speed', async () => {
    const { rerender } = render(
      <DownloadCard variant="rich" progress={{ ...active, loadedBytes: 262144 }} />
    );
    rerender(<DownloadCard variant="rich" progress={active} />);
    await waitFor(() => {
      expect(screen.getByText(/^50%/)).toBeTruthy();
    });
    expect(screen.getByText(/512 KB of 1\.0 MB/)).toBeTruthy();
    expect(screen.getByText('/home/user/Downloads/report.pdf')).toBeTruthy();
  });

  it('falls back to bytes only when the size is unknown (indeterminate)', () => {
    render(<DownloadCard progress={unknownSize} />);
    expect(screen.getByText('512 KB')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(document.querySelector('.da-download-indeterminate')).toBeTruthy();
  });

  it('animates the determinate fill via the shared motion token', () => {
    render(<DownloadCard progress={active} />);
    expect(document.querySelector('.da-download-fill')).toBeTruthy();
  });

  it('keeps the cancel button operable without a handler', () => {
    render(<DownloadCard progress={active} />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }))).not.toThrow();
  });

  it('is axe-clean in both variants', async () => {
    const { container: compact } = render(<DownloadCard progress={unknownSize} />);
    let results = await axe.run(compact);
    expect(results.violations).toEqual([]);
    cleanup();
    const { container: rich } = render(<DownloadCard variant="rich" progress={active} />);
    results = await axe.run(rich);
    expect(results.violations).toEqual([]);
  });
});

describe('findActiveDownload', () => {
  const steps: TurnTraceStep[] = [
    { id: 't1', phase: 'thinking', label: 'Thinking', startedAt: 1, endedAt: 2 },
    {
      id: 't2',
      phase: 'tool_call',
      label: 'download_file',
      toolName: 'download_file',
      startedAt: 2,
      endedAt: 3,
      progress: { ...active, status: 'done' },
    },
    {
      id: 't3',
      phase: 'tool_call',
      label: 'download_file',
      toolName: 'download_file',
      startedAt: 3,
      progress: { ...active, downloadId: 'dl-2' },
    },
  ];

  it('returns only the newest open active transfer', () => {
    expect(findActiveDownload(steps)?.downloadId).toBe('dl-2');
    expect(findActiveDownload(steps.slice(0, 2))).toBeNull();
    expect(findActiveDownload([])).toBeNull();
  });
});
