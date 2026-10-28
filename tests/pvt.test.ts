import { describe, expect, it } from 'vitest';
import { SPEED_OF_LIGHT } from '../src/gnss/constants';
import { enuBasis, geodeticToEcef, lookAngles, norm, sub } from '../src/gnss/geodesy';
import { sagnacCorrection, signalPath } from '../src/gnss/measurement';
import { solvePvt, type PvtMeasurement } from '../src/gnss/pvt';
import { EPOCH, loadSatellites, propagate, RIYADH } from './helpers';

const rx = geodeticToEcef(RIYADH);
const basis = enuBasis(RIYADH.lat, RIYADH.lon);
const sats = loadSatellites();
propagate(sats, EPOCH);

function exactMeasurements(filter: (id: string) => boolean, clockS: Record<string, number>): PvtMeasurement[] {
  return sats
    .filter((s) => s.valid && filter(s.id) && lookAngles(rx, basis, s.position).el > 10)
    .map((s) => ({
      id: s.id,
      system: s.system.id,
      satPosition: s.position,
      satVelocity: s.velocity,
      pseudorange: signalPath(s.position, s.velocity, rx).range + SPEED_OF_LIGHT * (clockS[s.system.id] ?? 0),
      sigma: 1,
    }));
}

describe('light-time and Earth rotation', () => {
  it('signal travel time from medium Earth orbit is 64-100 ms', () => {
    for (const s of sats.filter((x) => x.info.orbit === 'MEO' && lookAngles(rx, basis, x.position).el > 5)) {
      const tau = signalPath(s.position, s.velocity, rx).travelTime;
      expect(tau).toBeGreaterThan(0.064);
      expect(tau).toBeLessThan(0.1);
    }
  });

  it('matches the closed-form Sagnac correction to a few centimetres', () => {
    for (const s of sats.filter((x) => lookAngles(rx, basis, x.position).el > 5).slice(0, 10)) {
      const p = signalPath(s.position, s.velocity, rx);
      expect(Math.abs(p.sagnacM - sagnacCorrection(s.position, rx))).toBeLessThan(0.05);
      expect(Math.abs(p.sagnacM)).toBeLessThan(40);
    }
  });
});

describe('position solution', () => {
  it('recovers position and clock exactly from error-free GPS pseudoranges', () => {
    const meas = exactMeasurements((id) => id.startsWith('G'), { GPS: 3.7e-4 });
    const sol = solvePvt(meas, { clock: 'estimate' })!;
    expect(sol.fixType).toBe('3D');
    expect(norm(sub(sol.position, rx))).toBeLessThan(1e-3);
    expect(sol.clockBiasM.GPS! / SPEED_OF_LIGHT).toBeCloseTo(3.7e-4, 12);
    expect(sol.dop!.hdop).toBeLessThan(sol.dop!.pdop);
    expect(sol.dop!.pdop).toBeLessThan(sol.dop!.gdop);
  });

  it('solves one clock per constellation', () => {
    const meas = exactMeasurements(() => true, { GPS: 2e-4, GAL: 2e-4 + 6e-9, GLO: 2e-4 + 4.5e-8, BDS: 2e-4 + 1.8e-8 });
    const sol = solvePvt(meas, { clock: 'estimate' })!;
    expect(norm(sub(sol.position, rx))).toBeLessThan(1e-3);
    expect((sol.clockBiasM.GLO! - sol.clockBiasM.GPS!) / SPEED_OF_LIGHT).toBeCloseTo(4.5e-8, 12);
  });

  it('needs four satellites for a single constellation, or three with altitude aiding', () => {
    const meas = exactMeasurements((id) => id.startsWith('G'), { GPS: 1e-4 }).slice(0, 3);
    expect(solvePvt(meas, { clock: 'estimate' })).toBeNull();
    const aided = solvePvt(meas, {
      clock: 'estimate',
      altitudeAiding: { heightM: RIYADH.h, sigmaM: 1 },
      initialPosition: geodeticToEcef({ ...RIYADH, lat: RIYADH.lat + 0.01 }),
    })!;
    expect(aided.fixType).toBe('2D');
    expect(norm(sub(aided.position, rx))).toBeLessThan(1);
  });

  it('is pulled hundreds of kilometres away when an uncorrected clock error is assumed zero', () => {
    const meas = exactMeasurements((id) => id.startsWith('G'), { GPS: 1e-3 }).slice(0, 3);
    const sol = solvePvt(meas, { clock: 'fixed', fixedClockBiasM: 0 })!;
    expect(norm(sub(sol.position, rx))).toBeGreaterThan(50_000);
  });
});
