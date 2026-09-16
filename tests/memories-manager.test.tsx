// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoriesManager } from '@renderer/settings-react/tools/MemoriesManager';
import type { MemoryView } from '@shared/memory';

afterEach(cleanup);

function memory(overrides: Partial<MemoryView> = {}): MemoryView {
  return {
    id: 'mem_1',
    content: 'Deploy user is admin',
    source: 'user',
    tags: ['work'],
    conversationId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  };
}

function mockApi(overrides: Partial<Record<string, unknown>> = {}): void {
  window.electronAPI = {
    listMemories: vi.fn(async () => [memory()]),
    loadConfig: vi.fn(async () => ({ memory: { smartMerge: false } })),
    saveConfig: vi.fn(async () => true),
    consolidateMemories: vi.fn(async () => ({ checked: 0, merged: 0, kept: 0, skipped: false })),
    searchMemories: vi.fn(async () => [memory({ id: 'mem_2', content: 'Prefers concise answers', source: 'assistant', tags: [] })]),
    deleteMemory: vi.fn(async () => true),
    restoreMemory: vi.fn(async (input: { content: string }) => memory({ id: 'mem_9', content: input.content })),
    ...overrides,
  } as unknown as typeof window.electronAPI;
}

describe('MemoriesManager', () => {
  it('loads and renders memories with source badges and tags', async () => {
    mockApi();
    render(<MemoriesManager />);

    await screen.findByText('Deploy user is admin');
    expect(screen.getByText('you')).toBeTruthy();
    expect(screen.getByText('work')).toBeTruthy();
    expect(screen.getByText('1 memory stored')).toBeTruthy();
  });

  it('searches through the IPC when a query is typed', async () => {
    const searchMemories = vi.fn(async () => [memory({ id: 'mem_2', content: 'Prefers concise answers' })]);
    mockApi({ searchMemories });
    render(<MemoriesManager />);

    fireEvent.change(screen.getByLabelText('Search memories'), { target: { value: 'concise' } });
    await screen.findByText('Prefers concise answers');
    expect(searchMemories).toHaveBeenCalledWith('concise', 100);
  });

  it('shows the empty state when nothing is stored', async () => {
    mockApi({ listMemories: vi.fn(async () => []) });
    render(<MemoriesManager />);

    await screen.findByText('No memories yet');
  });

  it('deletes with an undo bar and restores on undo', async () => {
    const deleteMemory = vi.fn(async () => true);
    const restoreMemory = vi.fn(async (input: { content: string }) => memory({ id: 'mem_9', content: input.content }));
    mockApi({ deleteMemory, restoreMemory });
    render(<MemoriesManager />);
    await screen.findByText('Deploy user is admin');

    fireEvent.click(screen.getByLabelText('Forget memory: Deploy user is admin'));
    await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith('mem_1'));
    expect(screen.queryByText('Deploy user is admin')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText('Deploy user is admin');
    expect(restoreMemory).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Deploy user is admin', source: 'user', tags: ['work'] })
    );
  });

  it('shows an error state with retry when loading fails', async () => {
    const listMemories = vi.fn(async () => {
      throw new Error('db gone');
    });
    mockApi({ listMemories });
    render(<MemoriesManager />);

    await screen.findByText('Could not load memories.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listMemories).toHaveBeenCalledTimes(2));
  });
});

describe('MemoriesManager consolidation (plan 16 S2)', () => {
  it('shows merge provenance on cards that absorbed other memories', async () => {
    mockApi({
      listMemories: vi.fn(async () => [
        memory({ id: 'm9', mergedFrom: [{ id: 'old1', content: 'older merged row', source: 'user', mergedAt: '2026-09-10T10:00:00.000Z' }] }),
      ]),
    });
    render(<MemoriesManager />);
    await screen.findByText('Deploy user is admin');
    expect(screen.getByText('merged from 1')).toBeTruthy();
  });

  it('persists the smart-merge toggle through the config', async () => {
    const saveConfig = vi.fn(async () => true);
    mockApi({ saveConfig, loadConfig: vi.fn(async () => ({ memory: { smartMerge: false } })) });
    render(<MemoriesManager />);
    const toggle = await screen.findByRole('checkbox', { name: 'Smart merge' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ memory: { smartMerge: true } }));
    });
  });

  it('runs consolidation and surfaces the status line', async () => {
    mockApi({ listMemories: vi.fn(async () => [memory()]) });
    render(<MemoriesManager />);
    await screen.findByText('Deploy user is admin');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Smart merge' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Consolidate now' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('merged');
    expect(window.electronAPI.consolidateMemories).toHaveBeenCalled();
  });

  it('undoing a merged-row delete restores the winner and the absorbed rows (D9)', async () => {
    const merged = memory({
      id: 'm5',
      mergedFrom: [{ id: 'old1', content: 'the absorbed canary fact', source: 'assistant', mergedAt: '2026-09-10T10:00:00.000Z' }],
    });
    mockApi({
      listMemories: vi.fn(async () => [merged]),
      restoreMemory: vi.fn(async (input: { content: string }) => memory({ id: `r_${input.content}`, content: input.content })),
    });
    render(<MemoriesManager />);
    await screen.findByText('Deploy user is admin');
    fireEvent.click(screen.getByRole('button', { name: /Forget memory/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(window.electronAPI.restoreMemory).toHaveBeenCalledTimes(2);
    });
    expect(window.electronAPI.restoreMemory).toHaveBeenCalledWith(expect.objectContaining({ content: 'the absorbed canary fact' }));
  });
});
