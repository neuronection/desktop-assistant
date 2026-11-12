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

  it('shows a reading status instead of empty chrome while OCR runs', () => {
    const onClose = vi.fn();
    render(
      <CaptureTextPanel
        state={state({ text: '', engine: null })}
        busy
        onAction={vi.fn()}
        onClose={onClose}
      />
    );
    const panel = screen.getByTestId('capture-text-panel');
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText(TEXT.VIEWER_OCR_RUNNING)).toBeTruthy();
    // No empty text box and no dead action row while there is nothing to act on.
    expect(panel.querySelector('pre')).toBeNull();
    expect(screen.queryByTitle(TEXT.VIEWER_COPY_TEXT)).toBeNull();
    fireEvent.click(screen.getByLabelText(TEXT.VIEWER_CLOSE_OCR));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the text visible when a later request is busy', () => {
    render(<CaptureTextPanel state={state()} busy onAction={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Error TS2345: type mismatch')).toBeTruthy();
    expect(screen.queryByText(TEXT.VIEWER_OCR_RUNNING)).toBeNull();
  });

  it('opts out of the window drag region so the text can scroll and be selected', () => {
    render(<CaptureTextPanel state={state()} busy={false} onAction={vi.fn()} onClose={vi.fn()} />);
    const panel = screen.getByTestId('capture-text-panel');
    expect(panel.hasAttribute('data-no-drag')).toBe(true);
    const pre = panel.querySelector('pre') as HTMLPreElement;
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.className).toContain('overscroll-contain');
  });

  it('is axe clean', async () => {
    const { container } = render(
      <CaptureTextPanel state={state()} busy={false} onAction={vi.fn()} onClose={vi.fn()} />
    );
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
