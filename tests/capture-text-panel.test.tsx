// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { CaptureTextPanel, type CaptureTextState } from '@renderer/chat-react/CaptureTextPanel';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

function state(overrides: Partial<CaptureTextState> = {}): CaptureTextState {
  return {
    label: 'Region 820×460',
    text: 'Error TS2345: type mismatch',
    engine: 'local',
    translated: null,
    failure: null,
    notice: null,
    ...overrides,
  };
}

describe('in-app extracted text panel', () => {
  it('shows the text, where it came from and the engine — no second window', () => {
    render(<CaptureTextPanel state={state()} busy={false} onAction={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Error TS2345: type mismatch')).toBeTruthy();
    expect(screen.getByText('Region 820×460')).toBeTruthy();
    expect(screen.getByText(/read on-device/)).toBeTruthy();
  });

  it('runs the four text actions in place', () => {
    const onAction = vi.fn();
    render(<CaptureTextPanel state={state()} busy={false} onAction={onAction} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle(TEXT.VIEWER_COPY_TEXT));
    expect(onAction).toHaveBeenCalledWith('copy', 'Error TS2345: type mismatch');
    fireEvent.click(screen.getByTitle(TEXT.VIEWER_INSERT));
    expect(onAction).toHaveBeenCalledWith('insert', 'Error TS2345: type mismatch');
    fireEvent.click(screen.getByTitle(TEXT.VIEWER_SEARCH));
    expect(onAction).toHaveBeenCalledWith('search', 'Error TS2345: type mismatch');
    fireEvent.click(screen.getByTitle(TEXT.VIEWER_TRANSLATE));
    expect(onAction).toHaveBeenCalledWith('translate', 'Error TS2345: type mismatch');
  });

  it('explains failures and hides the text actions', () => {
    render(
      <CaptureTextPanel
        state={state({ text: '', engine: null, failure: TEXT.VIEWER_OCR_BLOCKED })}
        busy={false}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(TEXT.VIEWER_OCR_BLOCKED)).toBeTruthy();
    expect(screen.queryByTitle(TEXT.VIEWER_COPY_TEXT)).toBeNull();
  });

  it('marks a slow model read as busy and offers a close action', () => {
    const onClose = vi.fn();
    render(<CaptureTextPanel state={state({ text: '' })} busy onAction={vi.fn()} onClose={onClose} />);
    expect(screen.getByTestId('capture-text-panel').getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByLabelText(TEXT.VIEWER_CLOSE_OCR));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is axe clean', async () => {
    const { container } = render(
      <CaptureTextPanel state={state()} busy={false} onAction={vi.fn()} onClose={vi.fn()} />
    );
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
