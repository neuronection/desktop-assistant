import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { resolveVerification } from '@main/ai/tools/policy';

describe('default tool verification (Trusted workspace)', () => {
  it('ships the Trusted workspace preset as the class default', () => {
    expect(DEFAULT_CONFIG.tools.classDefaults).toEqual({ stateChanging: 'never' });
  });

  it('resolves built-in state-changing tools to auto-run by default', () => {
    const { settings } = resolveVerification('some_state_tool', 'state-changing', {
      toolSettings: {},
      classDefaults: DEFAULT_CONFIG.tools.classDefaults,
    });
    expect(settings.mode).toBe('never');
  });

  it('leaves destructive tools on the standard (always-confirm) path', () => {
    const { settings } = resolveVerification('some_destructive_tool', 'destructive', {
      toolSettings: {},
      classDefaults: DEFAULT_CONFIG.tools.classDefaults,
    });
    expect(settings.mode).toBe('standard');
  });
});
