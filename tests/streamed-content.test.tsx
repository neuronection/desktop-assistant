// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StreamedContent } from '@renderer/chat-react/StreamedContent';

afterEach(cleanup);

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('StreamedContent', () => {
  it('reveals complete Greek words and buffers the partial tail', async () => {
    const { rerender } = render(<StreamedContent value="" streaming={true} />);
    rerender(<StreamedContent value="Καλη" streaming={true} />);
    rerender(<StreamedContent value="Καλημέρα" streaming={true} />);
    rerender(<StreamedContent value="Καλημέρα σε" streaming={true} />);
    await waitFor(() => expect(document.body.textContent).toContain('Καλημέρα '), { timeout: 3000 });
    await settle(250);
    expect(document.body.textContent).toContain('Καλημέρα ');
    expect(document.body.textContent).not.toContain('σε');

    rerender(<StreamedContent value="Καλημέρα σε όλους! " streaming={true} />);
    await waitFor(() => expect(document.body.textContent).toContain('όλους!'), { timeout: 3000 });
  });

  it('settles a completed markdown block into a rendered heading while the tail keeps streaming', async () => {
    const { rerender } = render(<StreamedContent value="" streaming={true} />);
    rerender(<StreamedContent value="## Τίτλος" streaming={true} />);
    rerender(<StreamedContent value={'## Τίτλος\n\n'} streaming={true} />);
    rerender(<StreamedContent value={'## Τίτλος\n\nΣώμα'} streaming={true} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Τίτλος' })).toBeTruthy(), { timeout: 3000 });
    await settle(250);
    expect(document.body.textContent).not.toContain('Σώμα');

    rerender(<StreamedContent value={'## Τίτλος\n\nΣώμα.'} streaming={false} />);
    expect(screen.getByRole('heading', { name: 'Τίτλος' })).toBeTruthy();
    expect(screen.getByText('Σώμα.')).toBeTruthy();
  });

  it('renders the full markdown value once streaming ends', async () => {
    const { rerender } = render(<StreamedContent value="Καλημέρα **κόσμε**" streaming={true} />);
    await settle(250);
    rerender(<StreamedContent value="Καλημέρα **κόσμε**" streaming={false} />);
    expect(document.body.querySelector('strong')?.textContent).toBe('κόσμε');
    expect(document.body.textContent).toContain('Καλημέρα');
  });

  it('recovers when the stream text is rewritten (regenerate path)', async () => {
    const { rerender } = render(<StreamedContent value="Παλιό κείμενο " streaming={true} />);
    await waitFor(() => expect(document.body.textContent).toContain('Παλιό'), { timeout: 3000 });
    rerender(<StreamedContent value="Νέο " streaming={true} />);
    await settle(250);
    expect(document.body.textContent).not.toContain('Παλιό');
    await waitFor(() => expect(document.body.textContent).toContain('Νέο'), { timeout: 3000 });
  });

  it('never loses committed units under StrictMode double-invocation', async () => {
    const { rerender } = render(
      <StrictMode>
        <StreamedContent value="" streaming={true} />
      </StrictMode>
    );
    rerender(
      <StrictMode>
        <StreamedContent value={'\n\nΚαλημέρα σε όλους! '} streaming={true} />
      </StrictMode>
    );
    await waitFor(() => expect(document.body.textContent).toContain('Καλημέρα σε όλους!'), { timeout: 3000 });
  });

  it('settles a heading at its line end even without a blank line', async () => {
    const { rerender } = render(<StreamedContent value="" streaming={true} />);
    rerender(<StreamedContent value={'## Τίτλος\nΣώμα κειμένου.'} streaming={true} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Τίτλος' })).toBeTruthy(), { timeout: 3000 });
  });

  it('settles list items one by one as their lines complete', async () => {
    const { rerender } = render(<StreamedContent value="" streaming={true} />);
    rerender(<StreamedContent value={'Στοιχεία:\n\n- ένα\n- δύο\n\n'} streaming={true} />);
    await waitFor(() => expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
  });

  it('uses markdown whitespace for prose tails instead of pre-wrapping soft breaks', async () => {
    const { rerender } = render(<StreamedContent value="" streaming={true} />);
    rerender(<StreamedContent value={'Μα ένα βράδυ,\nόσο κι αν γύρισε τον διακόπτη.'} streaming={true} />);
    await waitFor(() => expect(document.body.textContent).toContain('Μα ένα βράδυ,'), { timeout: 3000 });
    expect(document.querySelector('.da-stream-tail')?.classList.contains('da-stream-tail-code')).toBe(false);
  });

  it('keeps pre-wrapped whitespace while a code fence is still open', async () => {
    const { rerender } = render(<StreamedContent value="" streaming={true} />);
    rerender(<StreamedContent value={'```ts\nconst a = 1;\n  const b = 2;'} streaming={true} />);
    await waitFor(() => expect(document.body.textContent).toContain('const a = 1;'), { timeout: 3000 });
    expect(document.querySelector('.da-stream-tail')?.classList.contains('da-stream-tail-code')).toBe(true);
  });
});
