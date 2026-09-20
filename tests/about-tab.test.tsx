// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { AboutTab } from '@renderer/settings-react/tabs/AboutTab';

afterEach(cleanup);

describe('AboutTab', () => {
  it('renders the panel with version, license and sponsor channels', () => {
    render(<AboutTab version="0.7.0" />);
    expect(screen.getAllByText('Desktop Assistant').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.7.0').length).toBeGreaterThan(0);
    expect(screen.getByText(/Apache License 2\.0/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /buy me a coffee/i })).toBeTruthy();
  });

  it('presents desktop assistant as part of the neuronection family', () => {
    const { container } = render(<AboutTab version="0.7.0" />);
    const badge = container.querySelector('[data-as="family-badge"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('Health Assistant');
    expect(badge?.textContent).toContain('Career Assistant');
    expect(badge?.textContent).toContain('Study Assistant');
    expect(badge?.textContent).toContain('Desktop Assistant');
    const cta = screen.getByRole('link', { name: /visit neuronection\.com/i });
    expect(cta.getAttribute('href')).toBe('https://neuronection.com');
  });

  it('has no axe violations', async () => {
    const { container } = render(<AboutTab version="0.7.0" />);
    const results = await axe.run(container);
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });
});
