// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Inspector, type InspectorProps } from '@renderer/chat-react/Inspector';
import { modelSelectionKey } from '@shared/ai/tasks';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

it('shows one selected provider and emits the other provider when choosing an identical model ID', () => {
  const ollama = modelSelectionKey('ollama', 'qwen3:8b');
  const openjarvis = modelSelectionKey('openjarvis', 'qwen3:8b');
  const onModelChange = vi.fn();
  const props: InspectorProps = {
    live: null,
    liveTrace: { phase: null, startedAt: null, steps: [] },
    lastAssistant: null,
    lastUserAttachments: [],
    activeModel: ollama,
    activeModelLabel: 'Ollama Local · qwen3:8b',
    modelProviders: [
      { id: 'ollama', name: 'Ollama Local', models: [{ id: ollama, name: 'qwen3:8b' }] },
      { id: 'openjarvis', name: 'OpenJarvis Local', models: [{ id: openjarvis, name: 'qwen3:8b' }] },
    ],
    onModelChange,
    onExport: vi.fn(),
  };
  const { rerender } = render(<Inspector {...props} />);

  fireEvent.click(screen.getByLabelText(TEXT.INSPECTOR_MODEL_LABEL));
  let options = screen.getAllByRole('option', { name: 'qwen3:8b' });
  expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  fireEvent.click(options[1]);
  expect(onModelChange).toHaveBeenLastCalledWith(openjarvis);

  rerender(<Inspector {...props} activeModel={openjarvis} activeModelLabel="OpenJarvis Local · qwen3:8b" />);
  fireEvent.click(screen.getByLabelText(TEXT.INSPECTOR_MODEL_LABEL));
  options = screen.getAllByRole('option', { name: 'qwen3:8b' });
  expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  fireEvent.click(screen.getByRole('option', { name: TEXT.INSPECTOR_CLEAR_MODEL_LABEL }));
  expect(onModelChange).toHaveBeenLastCalledWith(null);

  onModelChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: TEXT.INSPECTOR_CLEAR_MODEL_LABEL }));
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith(null);
});

it('flags a saved model that no longer resolves and clears the override', () => {
  const onModelChange = vi.fn();
  const stale = modelSelectionKey('retired', 'qwen2:7b');
  const props: InspectorProps = {
    live: null,
    liveTrace: { phase: null, startedAt: null, steps: [] },
    lastAssistant: null,
    lastUserAttachments: [],
    activeModel: null,
    savedModelId: stale,
    modelProviders: [
      { id: 'ollama', name: 'Ollama Local', models: [{ id: modelSelectionKey('ollama', 'qwen3:8b'), name: 'qwen3:8b' }] },
    ],
    onModelChange,
    onExport: vi.fn(),
  };
  const { rerender } = render(<Inspector {...props} />);

  expect(screen.getByRole('status').textContent).toBe(TEXT.INSPECTOR_MODEL_STALE);
  fireEvent.click(screen.getByRole('button', { name: TEXT.INSPECTOR_CLEAR_MODEL_LABEL }));
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith(null);

  const resolved = modelSelectionKey('ollama', 'qwen3:8b');
  rerender(
    <Inspector
      {...props}
      activeModel={resolved}
      activeModelLabel="Ollama Local · qwen3:8b"
      savedModelId={resolved}
    />
  );
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not flag a conversation that never saved a model', () => {
  render(
    <Inspector
      live={null}
      liveTrace={{ phase: null, startedAt: null, steps: [] }}
      lastAssistant={null}
      lastUserAttachments={[]}
      activeModel={null}
      modelProviders={[]}
      onModelChange={vi.fn()}
      onExport={vi.fn()}
    />
  );
  expect(screen.queryByRole('status')).toBeNull();
});
