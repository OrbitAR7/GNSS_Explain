import { describe, expect, it } from 'vitest';
import { codeTrackingNoiseMeters, freeSpacePathLossDb, inBandNoisePowerDbw, linkBudget, SMARTPHONE_FRONT_END } from '../src/gnss/signal';
import { SYSTEMS } from '../src/gnss/systems';

const GPS_RADIUS = 26_560_000;

describe('link budget', () => {
  it('free-space loss at L1 over 20,200 km is about 182.5 dB', () => {
    expect(freeSpacePathLossDb(20_200_000, 1575.42e6)).toBeCloseTo(182.5, 0);
  });

  it('meets the specified minimum power at 5° elevation for a 0 dBic antenna', () => {
    const range = 25_240_000;
    const lb = linkBudget(SYSTEMS.GPS, { ...SMARTPHONE_FRONT_END, antennaHorizonGainDbic: 0, antennaZenithGainDbic: 0 }, { elDeg: 5, rangeM: range, satRadiusM: GPS_RADIUS, carrierHz: 1575.42e6 }, 0);
    expect(lb.isotropicPowerDbw).toBeGreaterThanOrEqual(SYSTEMS.GPS.signal.minReceivedPowerDbw);
  });

  it('keeps received power within a few dB from horizon to zenith', () => {
    const at = (el: number, range: number) =>
      linkBudget(SYSTEMS.GPS, SMARTPHONE_FRONT_END, { elDeg: el, rangeM: range, satRadiusM: GPS_RADIUS, carrierHz: 1575.42e6 }, 0).isotropicPowerDbw;
    expect(Math.abs(at(90, 20_190_000) - at(5, 25_240_000))).toBeLessThan(3);
  });

  it('gives smartphone-class C/N0 in open sky', () => {
    const lb = linkBudget(SYSTEMS.GPS, SMARTPHONE_FRONT_END, { elDeg: 60, rangeM: 20_800_000, satRadiusM: GPS_RADIUS, carrierHz: 1575.42e6 }, 0);
    expect(lb.cn0).toBeGreaterThan(33);
    expect(lb.cn0).toBeLessThan(45);
  });

  it('places the signal below the in-band thermal noise', () => {
    const lb = linkBudget(SYSTEMS.GPS, SMARTPHONE_FRONT_END, { elDeg: 90, rangeM: 20_190_000, satRadiusM: GPS_RADIUS, carrierHz: 1575.42e6 }, 0);
    expect(lb.receivedPowerDbw).toBeLessThan(inBandNoisePowerDbw(SMARTPHONE_FRONT_END));
  });
});

describe('code tracking noise', () => {
  it('falls as C/N0 rises and is metre-level for a phone', () => {
    const at = (cn0: number) => codeTrackingNoiseMeters(SYSTEMS.GPS, SMARTPHONE_FRONT_END, cn0);
    expect(at(25)).toBeGreaterThan(at(35));
    expect(at(35)).toBeGreaterThan(at(45));
    expect(at(40)).toBeGreaterThan(0.3);
    expect(at(40)).toBeLessThan(5);
  });

  it('is lower for BeiDou B1I (twice the chip rate) than GPS C/A', () => {
    expect(codeTrackingNoiseMeters(SYSTEMS.BDS, SMARTPHONE_FRONT_END, 40)).toBeLessThan(
      codeTrackingNoiseMeters(SYSTEMS.GPS, SMARTPHONE_FRONT_END, 40),
    );
  });
});
