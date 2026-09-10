// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Composer } from '@renderer/chat-react/Composer';
import type { Attachment } from '@shared/types';

afterEach(cleanup);

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}): void {
  render(
    <Composer
      value=""
      onValueChange={() => undefined}
      onSubmit={() => undefined}
      sending={false}
      attachments={[] as Attachment[]}
      onRemoveAttachment={() => undefined}
      onAttachFiles={() => undefined}
      onPickScreen={() => undefined}
      onToggleRecording={() => undefined}
      voiceState="idle"
      voiceLevel={0}
      {...overrides}
    />
  );
}

describe('Composer selection button (opt-in)', () => {
  it('hides the selection button when the feature is off or unsupported', () => {
    renderComposer();
    expect(screen.queryByLabelText('Insert my selection')).toBeNull();
  });

  it('shows the selection button next to the mic when wired', () => {
    renderComposer({ onInsertSelection: () => Promise.resolve(null) });
    expect(screen.getByLabelText('Insert my selection')).toBeTruthy();
  });

  it('inserts the captured selection into the composer input', async () => {
    const onValueChange = vi.fn();
    const onInsertSelection = vi.fn(async () => {
      onValueChange('selected text');
      return null;
    });
    renderComposer({ onValueChange, onInsertSelection });
    fireEvent.click(screen.getByLabelText('Insert my selection'));
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('selected text'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('surfaces a transient hint when there is nothing to capture', async () => {
    renderComposer({ onInsertSelection: () => Promise.resolve('No selection was captured.') });
    fireEvent.click(screen.getByLabelText('Insert my selection'));
    await screen.findByRole('status');
    expect(screen.getByText('No selection was captured.')).toBeTruthy();
    await waitFor(
      () => expect(screen.queryByText('No selection was captured.')).toBeNull(),
      { timeout: 4500 }
    );
  });
});
