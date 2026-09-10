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
