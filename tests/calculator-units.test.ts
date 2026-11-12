import { describe, expect, it } from 'vitest';
import { evaluateCalculator } from '@packs/mini-calc/calculator';

function converted(input: string): { value: number; display: string } {
  const result = evaluateCalculator(input);
  if (!result.ok) {
    throw new Error(`${input} unexpectedly failed: ${result.error}`);
  }
  return { value: result.value, display: result.display };
}

describe('evaluateCalculator unit conversions', () => {
  it('converts length with words, symbols and arrows', () => {
    expect(converted('10 km to mi').value).toBeCloseTo(6.213711922, 9);
    expect(converted('10km in miles').value).toBeCloseTo(6.213711922, 9);
    expect(converted('1 m -> cm').display).toBe('100 cm');
    expect(converted('10 in to cm').value).toBeCloseTo(25.4, 9);
    expect(converted('10 in in cm').value).toBeCloseTo(25.4, 9);
    expect(converted('1 nmi to m').value).toBe(1852);
    expect(converted('3 nautical miles to km').value).toBeCloseTo(5.556, 9);
    expect(converted('1e3m to km').value).toBe(1);
    expect(converted('5 m² to ft²').value).toBeCloseTo(53.819552, 6);
    expect(converted('5 µm to mm').value).toBeCloseTo(0.005, 9);
  });

  it('handles multiword volume and speed units', () => {
    expect(converted('5 fl oz to ml').value).toBeCloseTo(147.867647813, 9);
    expect(converted('10 meters per second to kmh').value).toBe(36);
    expect(converted('60 miles per hour to kmh').value).toBeCloseTo(96.56064, 9);
  });

  it('evaluates an arithmetic amount before converting', () => {
    expect(converted('2 * 3 m to ft').value).toBeCloseTo(19.6850393701, 9);
    expect(converted('(1 + 1) h to min').value).toBe(120);
  });

  it('handles temperature as an affine conversion', () => {
    expect(converted('0 c to f').value).toBeCloseTo(32, 9);
    expect(converted('100 f in c').value).toBeCloseTo(37.777777778, 9);
    expect(converted('273.15 k to c').value).toBeCloseTo(0, 9);
    expect(converted('72 fahrenheit to celsius').display).toContain('°C');
    expect(converted('-40 c to f').value).toBe(-40);
    expect(converted('0 k to c').value).toBeCloseTo(-273.15, 9);
    expect(converted('20 c to c').value).toBe(20);
    expect(evaluateCalculator('-500 c to k')).toEqual({ ok: false, error: 'below absolute zero' });
  });

  it('converts mass, volume, data, speed, area, time and angle', () => {
    expect(converted('5 kg to lb').value).toBeCloseTo(11.023113109, 9);
    expect(converted('1 l to gal').value).toBeCloseTo(0.264172052, 9);
    expect(converted('1 gb to mb').display).toBe('1000 MB');
    expect(converted('1 gib to mib').display).toBe('1024 MiB');
    expect(converted('100 kph to mph').value).toBeCloseTo(62.137119224, 9);
    expect(converted('1 acre to m2').value).toBeCloseTo(4046.8564224, 6);
    expect(converted('2 h to min').display).toBe('120 min');
    expect(converted('180 deg to rad').value).toBeCloseTo(Math.PI, 9);
    expect(converted('90 ° to rad').value).toBeCloseTo(Math.PI / 2, 9);
    expect(converted('1 kn to mps').value).toBeCloseTo(1852 / 3600, 12);
  });

  it('does not silently treat a US ton as a metric tonne', () => {
    expect(evaluateCalculator('10 ton to kg').ok).toBe(false);
    expect(converted('1 tonne to kg').value).toBe(1000);
  });

  it('keeps plain arithmetic and its display unchanged', () => {
    const result = evaluateCalculator('2 + 3 * 4');
    expect(result).toEqual({ ok: true, value: 14, display: '14' });
    expect(evaluateCalculator('0.1 + 0.2').ok).toBe(true);
  });

  it('reports category mismatches and unknown units', () => {
    expect(evaluateCalculator('10 km to kg')).toEqual({
      ok: false,
      error: 'cannot convert length to mass',
    });
    expect(evaluateCalculator('10 km to xyz')).toEqual({
      ok: false,
      error: "unknown unit 'xyz'",
    });
    expect(evaluateCalculator('10 zzz to m').ok).toBe(false);
  });

  it('does not treat a bare word as a conversion', () => {
    expect(evaluateCalculator('abc').ok).toBe(false);
    expect(evaluateCalculator('10 km').ok).toBe(false);
  });
});
