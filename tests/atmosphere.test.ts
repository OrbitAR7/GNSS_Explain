import { describe, expect, it } from 'vitest';
import {
  ionoDelayMeters,
  klobucharDelay,
  saastamoinenZenith,
  standardAtmosphere,
  tropoMapping,
  type KlobucharCoefficients,
} from '../src/gnss/atmosphere';
import { SPEED_OF_LIGHT } from '../src/gnss/constants';

const COEFFS: KlobucharCoefficients = {
  alpha: [1.1176e-8, 2.2352e-8, -5.9605e-8, -1.1921e-7],
  beta: [9.0112e4, 1.6384e4, -1.9661e5, -6.5536e4],
};

describe('Klobuchar ionosphere model', () => {
  it('returns the 5 ns night-time floor (scaled by the obliquity factor)', () => {
    // 03:00 local at the receiver longitude.
    const lon = 0;
    const night = klobucharDelay(COEFFS, 0, lon, 90, 0, 3 * 3600);
    expect(night).toBeCloseTo(5e-9 * (1 + 16 * (0.53 - 0.5) ** 3), 12);
  });

  it('peaks in the early afternoon local time', () => {
    const at = (hour: number) => klobucharDelay(COEFFS, 20, 0, 90, 0, hour * 3600);
    expect(at(14)).toBeGreaterThan(at(10));
    expect(at(14)).toBeGreaterThan(at(18));
  });

  it('grows toward the horizon', () => {
    expect(klobucharDelay(COEFFS, 20, 0, 10, 0, 14 * 3600)).toBeGreaterThan(2.5 * klobucharDelay(COEFFS, 20, 0, 90, 0, 14 * 3600));
  });

  it('scales with 1/f² between carriers', () => {
    const l1 = ionoDelayMeters(10e-9, 1575.42e6);
    expect(l1).toBeCloseTo(10e-9 * SPEED_OF_LIGHT, 9);
    expect(ionoDelayMeters(10e-9, 1561.098e6) / l1).toBeCloseTo((1575.42 / 1561.098) ** 2, 9);
  });
});

describe('troposphere', () => {
  it('gives about 2.3 m zenith hydrostatic delay at sea level', () => {
    const { zhd, zwd } = saastamoinenZenith(45, 0, standardAtmosphere(0, 0.5));
    expect(zhd).toBeGreaterThan(2.28);
    expect(zhd).toBeLessThan(2.33);
    expect(zwd).toBeGreaterThan(0.05);
    expect(zwd).toBeLessThan(0.3);
  });

  it('decreases with altitude', () => {
    expect(saastamoinenZenith(25, 600, standardAtmosphere(600)).zhd).toBeLessThan(saastamoinenZenith(25, 0, standardAtmosphere(0)).zhd);
  });

  it('maps to about 1 at zenith and about 10 at 5° elevation', () => {
    expect(tropoMapping(90)).toBeCloseTo(1, 2);
    expect(tropoMapping(5)).toBeGreaterThan(9.5);
    expect(tropoMapping(5)).toBeLessThan(11);
  });
});
