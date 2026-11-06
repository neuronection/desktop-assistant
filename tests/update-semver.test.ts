import { describe, expect, it } from 'vitest';
import { channelOf, compareSemver, parseSemver } from '@main/services/updates';

describe('semver law (ADR-0048 clause 2)', () => {
  it('ranks a release above its own prereleases', () => {
    expect(compareSemver(parseSemver('1.0.0')!, parseSemver('1.0.0-rc.1')!)).toBe(1);
    expect(compareSemver(parseSemver('1.0.0-rc.1')!, parseSemver('1.0.0')!)).toBe(-1);
  });

  it('compares numeric prerelease identifiers numerically', () => {
    expect(compareSemver(parseSemver('1.0.0-rc.2')!, parseSemver('1.0.0-rc.1')!)).toBe(1);
    expect(compareSemver(parseSemver('1.0.0-rc.10')!, parseSemver('1.0.0-rc.9')!)).toBe(1);
  });

  it('ranks numeric identifiers below alphanumeric ones', () => {
    expect(compareSemver(parseSemver('1.0.0-1')!, parseSemver('1.0.0-alpha')!)).toBe(-1);
  });

  it('ranks a longer identifier list above its shared prefix', () => {
    expect(compareSemver(parseSemver('1.0.0-rc.1')!, parseSemver('1.0.0-rc.1.1')!)).toBe(-1);
  });

  it('compares version segments numerically, not lexically', () => {
    expect(compareSemver(parseSemver('0.10.0')!, parseSemver('0.9.0')!)).toBe(1);
    expect(compareSemver(parseSemver('1.2.3')!, parseSemver('1.2.3'))).toBe(0);
  });

  it('parses v-prefixed tags and rejects garbage', () => {
    expect(parseSemver('v0.10.0')).toEqual({ major: 0, minor: 10, patch: 0, prerelease: [] });
    expect(parseSemver('v0.4.1-rc.1')?.prerelease).toEqual(['rc', '1']);
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('01.2.3')).toBeNull();
  });

  it('classifies channels from the prerelease suffix', () => {
    expect(channelOf('v0.4.1-rc.1')).toBe('beta');
    expect(channelOf('v0.4.1-beta.2')).toBe('beta');
    expect(channelOf('v0.8.0')).toBe('stable');
    expect(channelOf('garbage')).toBeNull();
  });
});
