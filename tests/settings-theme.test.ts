// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyTheme } from '@renderer/settings-react/theme';
import { ThemeManager } from '@renderer/managers/ThemeManager';
import { ThemeType } from '@shared/constants/themes';

describe('settings theme token mapping', () => {
  it('maps raised surfaces to an opaque palette color', () => {
    for (const themeType of Object.values(ThemeType)) {
      applyTheme(themeType);
      const raised = document.documentElement.style.getPropertyValue('--as-surface-raised');
      expect(raised).not.toMatch(/rgba\(/);
      expect(raised).toBe(ThemeManager.getInstance().getTheme(themeType).bg_secondary);
    }
  });
});
