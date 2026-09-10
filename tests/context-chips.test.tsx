// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContextChips } from '@renderer/chat-react/ContextChips';

afterEach(cleanup);

function mockApi(overrides: Partial<Record<string, unknown>> = {}): { summon: () => void } {
  let listener: (() => void) | null = null;
  window.electronAPI = {
    selectionSupported: vi.fn(async () => true),
    onFocusInput: (cb: () => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    clipboardChanged: vi.fn(async () => ({ changed: false })),
    captureSelection: vi.fn(async () => ({ ok: true, text: 'selected text' })),
    ...overrides,
  } as unknown as typeof window.electronAPI;
  return {
    summon: () => listener?.(),
  };
}

describe('ContextChips', () => {
  it('shows the clipboard chip only when main reports a change', async () => {
    const onInsert = vi.fn();
    const api = mockApi({
      clipboardChanged: vi.fn(async () => ({ changed: true, text: 'copied article text', preview: 'copied article text' })),
    });
    render(<ContextChips onInsert={onInsert} />);
    api.summon();

    await screen.findByRole('button', { name: /Ask about clipboard/ });
    fireEvent.click(screen.getByRole('button', { name: /Ask about clipboard/ }));
    expect(onInsert).toHaveBeenCalledWith('copied article text');
  });

  it('renders nothing when the clipboard is unchanged', async () => {
    const api = mockApi();
    const { container } = render(<ContextChips onInsert={vi.fn()} />);
    api.summon();
    await waitFor(() => expect(container.querySelector('button')).toBeNull());
  });
});
