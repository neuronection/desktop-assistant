// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { BetaTag } from '@renderer/shared/BetaTag';
import { betaFeatureForPack, isBetaFeature } from '@shared/beta';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

describe('beta feature tags (plan 71)', () => {
  it('keeps one namespaced registry and resolves packs by id', () => {
    expect(isBetaFeature('mini-app:file-deletion-review')).toBe(true);
    expect(isBetaFeature('file-deletion-review')).toBe(false);
    expect(isBetaFeature('mini-app:mini-translate')).toBe(false);
    expect(betaFeatureForPack('file-deletion-review')).toBe('mini-app:file-deletion-review');
    expect(betaFeatureForPack('mini-translate')).toBeNull();
  });

  it('renders the one chip with its explanation and no axe violations', { timeout: 30_000 }, async () => {
    const { container } = render(<BetaTag />);
    expect(screen.getByTestId('beta-tag').textContent).toContain(TEXT.BETA_TAG);
    expect(screen.getByTestId('beta-tag').getAttribute('title')).toBe(TEXT.BETA_TAG_HINT);
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id).join(',')).toBe('');
  });
});
