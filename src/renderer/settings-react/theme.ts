import { ThemeManager } from '@renderer/managers/ThemeManager';
import { ThemeType, ThemeColors } from '@shared/constants/themes';

const TOKEN_MAP: Record<string, keyof ThemeColors> = {
  '--as-surface': 'bg_primary',
  '--as-surface-raised': 'bg_secondary',
  '--as-fg': 'text_primary',
  '--as-primary': 'brand_primary',
  '--as-primary-fg': 'text_on_primary',
  '--as-secondary': 'bg_tertiary',
  '--as-secondary-fg': 'text_primary',
  '--as-muted': 'bg_secondary',
  '--as-muted-fg': 'text_secondary',
  '--as-border': 'settings_input_border',
  '--as-danger': 'semantic_error',
  '--as-focus-ring': 'brand_primary',
};

export function applyTheme(themeType: ThemeType): void {
  const manager = ThemeManager.getInstance();
  manager.setTheme(themeType);
  document.body.className = document.body.className.replace(/theme-\w+/g, '');
  document.body.classList.add(`theme-${themeType.toLowerCase()}`);

  const colors = manager.getTheme(themeType);
  const root = document.documentElement;
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(`--${key.replace(/_/g, '-')}`, value as string);
  });
  Object.entries(TOKEN_MAP).forEach(([token, paletteKey]) => {
    const value = colors[paletteKey];
    if (value) {
      root.style.setProperty(token, value as string);
    }
  });
}
