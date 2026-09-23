import { fireEvent, screen } from '@testing-library/react';

/** Pick an option from a themed Combobox trigger by its accessible name. */
export function chooseOption(label: string | RegExp, option: string | RegExp): void {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

/** Open a themed Combobox by DOM id (for triggers without a unique name). */
export function openCombobox(id: string): void {
  const trigger = document.querySelector(`#${id}`);
  if (!trigger) {
    throw new Error(`Combobox trigger not found: #${id}`);
  }
  fireEvent.click(trigger);
}
