// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeAll, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { LanguagePicker } from '@renderer/shared/LanguagePicker';
import { TEXT } from '@shared/constants/text';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

function Harness(props: {
  initial?: string;
  withAuto?: boolean;
  allowCustom?: boolean;
  onAddCustom?: (code: string) => Promise<{ code: string; name: string } | null>;
  onValue?: (value: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(props.initial ?? '');
  const [open, setOpen] = useState(false);
  return (
    <>
      <LanguagePicker
        idPrefix="picker"
        value={value}
        withAuto={props.withAuto}
        allowCustom={props.allowCustom}
        open={open}
        onOpenChange={setOpen}
        customLanguages={[{ code: 'grc', name: 'Ancient Greek', nativeName: 'ἀρχαία ἑλληνικὴ' }]}
        {...(props.onAddCustom !== undefined ? { onAddCustom: props.onAddCustom } : {})}
        onChange={(next) => {
          setValue(next);
          props.onValue?.(next);
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('LanguagePicker — in-flow language browser (plan 69)', () => {
  it('opens in flow, lists the family catalog with flags and native names, and picks', () => {
    const onValue = vi.fn();
    render(<Harness initial="en" withAuto onValue={onValue} />);
    expect(screen.getByTestId('picker-trigger').textContent).toContain('English');
    expect(screen.queryByTestId('picker-list')).toBeNull();
    fireEvent.click(screen.getByTestId('picker-trigger'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByTestId('picker-option-el').textContent).toContain('🇬🇷');
    expect(screen.getByTestId('picker-option-el').textContent).toContain('Greek');
    expect(screen.getByTestId('picker-option-el').textContent).toContain('Ελληνικά');
    expect(screen.getByTestId('picker-option-auto').textContent).toContain('Automatic');
    expect(screen.getByTestId('picker-option-grc').textContent).toContain(TEXT.LANGUAGE_PICKER_CUSTOM);
    fireEvent.click(screen.getByTestId('picker-option-el'));
    expect(onValue).toHaveBeenCalledWith('el');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by name, native name and code', () => {
    render(<Harness initial="en" />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'griech' } });
    expect(screen.queryByTestId('picker-option-de')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'el' } });
    expect(screen.getByTestId('picker-option-el')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ελληνικά' } });
    expect(screen.getByTestId('picker-option-el')).toBeTruthy();
  });

  it('closes on an outside pointerdown', async () => {
    render(<Harness initial="en" />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('Escape closes only the picker — the pane-level capture ladder never sees it', () => {
    const paneLadder = vi.fn();
    document.addEventListener('keydown', paneLadder, true);
    render(<Harness initial="en" />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    fireEvent.keyDown(document, { key: 'Escape' });
    document.removeEventListener('keydown', paneLadder, true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(paneLadder).not.toHaveBeenCalled();
  });

  it('offers a typed custom code and stores it before selecting', async () => {
    const onAddCustom = vi.fn(async (code: string) => ({ code, name: 'Klingon' }));
    const onValue = vi.fn();
    render(<Harness initial="en" allowCustom onAddCustom={onAddCustom} onValue={onValue} />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tlh' } });
    expect(screen.getByTestId('picker-create').textContent).toContain('tlh');
    fireEvent.click(screen.getByTestId('picker-create'));
    await waitFor(() => expect(onAddCustom).toHaveBeenCalledWith('tlh'));
    await waitFor(() => expect(onValue).toHaveBeenCalledWith('tlh'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps the picker open with an alert when the custom code cannot be stored', async () => {
    const onAddCustom = vi.fn(async () => null);
    render(<Harness initial="en" allowCustom onAddCustom={onAddCustom} />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tlh' } });
    fireEvent.click(screen.getByTestId('picker-create'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('degrades to the catalog when no persistence path is wired', () => {
    render(<Harness initial="en" allowCustom />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tlh' } });
    expect(screen.queryByTestId('picker-create')).toBeNull();
  });

  it('shows Automatic for an empty value when the source allows it', () => {
    render(<Harness initial="" withAuto />);
    expect(screen.getByTestId('picker-trigger').textContent).toContain(TEXT.LANGUAGE_PICKER_AUTO_SHORT);
    expect(screen.getByTestId('picker-trigger').textContent).not.toContain(TEXT.LANGUAGE_PICKER_CUSTOM);
  });

  it('shows an unknown stored code verbatim instead of pretending it is a known language', () => {
    render(<Harness initial="xx" />);
    expect(screen.getByTestId('picker-trigger').textContent).toContain('xx');
    expect(screen.getByTestId('picker-trigger').textContent).toContain(TEXT.LANGUAGE_PICKER_CUSTOM);
  });

  it('is axe-clean while open', { timeout: 30_000 }, async () => {
    const { container } = render(<Harness initial="en" withAuto allowCustom />);
    fireEvent.click(screen.getByTestId('picker-trigger'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gre' } });
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id).join(',')).toBe('');
  });
});
