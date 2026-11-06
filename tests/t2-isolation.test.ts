import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSION_CHARTER, desktopHostProfileView, t2IsolationForPlatform } from '@shared/app-pack';
import { desktopT2Isolation } from '@main/apps/isolation';

const DESKTOP_PROFILE = (
  EXTENSION_CHARTER.hostProfiles.profiles as readonly {
    product: string;
    t2IsolationByPlatform?: Readonly<Record<string, string>>;
  }[]
).find((profile) => profile.product === 'desktop-assistant');
const PLATFORM_KEY = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const CHARTER_GRADE = DESKTOP_PROFILE?.t2IsolationByPlatform?.[PLATFORM_KEY] ?? 'none';

describe('T2 isolation grade is charter data (plan 47 D2/D3)', () => {
  it('the host-grade reader resolves the running platform to the charter value', () => {
    expect(t2IsolationForPlatform(process.platform)).toBe(CHARTER_GRADE);
    expect(desktopT2Isolation()).toBe(CHARTER_GRADE);
  });

  it('the host-profile view serves the grade verbatim', () => {
    expect(desktopHostProfileView(CHARTER_GRADE).t2Isolation).toBe(CHARTER_GRADE);
  });

  it('the shared mapping never reaches for process.platform', () => {
    const source = readFileSync(join(process.cwd(), 'src/shared/app-pack/mapping.ts'), 'utf8');
    expect(source).not.toMatch(/process\.platform/);
  });

  it('the safety doc states the actual grade and no longer claims files/environment isolation', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/user/mini-apps-safety.md'), 'utf8');
    expect(doc).toContain(`“${CHARTER_GRADE}”`);
    expect(doc).not.toContain('no access to your files, your environment');
  });
});
