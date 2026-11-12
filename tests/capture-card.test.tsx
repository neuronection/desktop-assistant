// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { CaptureCard, type CaptureCardProps } from '@renderer/chat-react/CaptureCard';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

function props(overrides: Partial<CaptureCardProps> = {}): CaptureCardProps {
  return {
    card: {
      index: 0,
      dataUrl: 'data:image/jpeg;base64,AAAA',
      meta: { kind: 'window', label: 'Firefox — GitHub', width: 1280, height: 740 },
    },
    ocr: null,
    busy: false,
    translated: null,
    onOcr: vi.fn(),
    onCopyImage: vi.fn(),
    onTextAction: vi.fn(),
    onEdit: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

const ocrText = {
  ok: true as const,
  text: 'Error TS2345: type mismatch',
  engine: 'local' as const,
  chars: 28,
};

describe('capture result card', () => {
  it('names the capture and offers the no-text actions', () => {
    const p = props();
    render(<CaptureCard {...p} />);
    expect(screen.getByText('Firefox — GitHub')).toBeTruthy();
    expect(screen.getByText('1280 × 740')).toBeTruthy();

    fireEvent.click(screen.getByTitle(TEXT.CAPTURE_CARD_OCR));
    expect(p.onOcr).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle(TEXT.CAPTURE_CARD_COPY_IMAGE));
    expect(p.onCopyImage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle(TEXT.VIEWER_EDIT));
    expect(p.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(TEXT.CAPTURE_CARD_DISMISS));
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle(TEXT.CAPTURE_CARD_COPY_TEXT)).toBeNull();
  });

  it('shows the extracted text, the engine, and the text actions', () => {
    const p = props({ ocr: ocrText });
    render(<CaptureCard {...p} />);
    expect(screen.getByText('Error TS2345: type mismatch')).toBeTruthy();
    expect(screen.getByText(/on-device/)).toBeTruthy();

    fireEvent.click(screen.getByTitle(TEXT.CAPTURE_CARD_COPY_TEXT));
    expect(p.onTextAction).toHaveBeenCalledWith('copy', ocrText.text);
    fireEvent.click(screen.getByTitle(TEXT.CAPTURE_CARD_INSERT));
    expect(p.onTextAction).toHaveBeenCalledWith('insert', ocrText.text);
    fireEvent.click(screen.getByTitle(TEXT.CAPTURE_CARD_SEARCH));
    expect(p.onTextAction).toHaveBeenCalledWith('search', ocrText.text);
    fireEvent.click(screen.getByTitle(TEXT.CAPTURE_CARD_TRANSLATE));
    expect(p.onTextAction).toHaveBeenCalledWith('translate', ocrText.text);
  });

  it('names the provider when the model read the text', () => {
    render(<CaptureCard {...props({ ocr: { ...ocrText, engine: 'model', provider: 'OpenAI' } })} />);
    expect(screen.getByText(/sent to OpenAI/)).toBeTruthy();
  });

  it('explains blocked and empty results instead of failing silently', () => {
    render(
      <CaptureCard
        {...props({ ocr: { ok: false, reason: 'blocked', message: 'blocked by strict-local' } })}
      />
    );
    expect(screen.getByText('blocked by strict-local')).toBeTruthy();

    cleanup();
    render(<CaptureCard {...props({ ocr: { ok: false, reason: 'empty' } })} />);
    expect(screen.getByText(TEXT.CAPTURE_CARD_OCR_EMPTY)).toBeTruthy();
    expect(screen.queryByTitle(TEXT.CAPTURE_CARD_INSERT)).toBeNull();
  });

  it('disables search when the text has no usable line', () => {
    render(<CaptureCard {...props({ ocr: { ...ocrText, text: '   ' } })} />);
    const search = screen.getByTitle(TEXT.CAPTURE_CARD_OCR_EMPTY) as HTMLButtonElement;
    expect(search.disabled).toBe(true);
  });

  it('is axe clean with text and without it', async () => {
    const { container, rerender } = render(<CaptureCard {...props({ ocr: ocrText })} />);
    expect((await axe.run(container)).violations).toEqual([]);
    rerender(<CaptureCard {...props()} />);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
