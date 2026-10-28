import { describe, expect, it } from 'vitest';
import type { EnvironmentId } from '../src/gnss/environment';
import { GnssReceiver } from '../src/gnss/receiver';
import { EPOCH, loadSatellites, propagate, RIYADH } from './helpers';

const sats = loadSatellites();

/** Horizontal RMS error over five minutes of 2 s epochs after the first fix. */
function horizontalRms(environment: EnvironmentId): { rms: number; used: number } {
  const rx = new GnssReceiver(RIYADH);
  rx.config.environment = environment;
  rx.powerOn(EPOCH);
  const errors: number[] = [];
  let used = 0;
  for (let t = 0; t < 300; t += 2) {
    const now = new Date(EPOCH.getTime() + t * 1000);
    propagate(sats, now);
    rx.update(now, sats);
    if (rx.fix && t > 20) {
      errors.push(rx.fix.error.horizontal);
      used += rx.fix.satellitesUsed;
    }
  }
  return {
    rms: Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length),
    used: used / errors.length,
  };
}

describe('position accuracy (smartphone, single frequency)', () => {
  const open = horizontalRms('open');
  const urban = horizontalRms('urban');
  const indoor = horizontalRms('indoor');

  it('is metre-level in open sky with all constellations', () => {
    expect(open.used).toBeGreaterThan(25);
    expect(open.rms).toBeGreaterThan(0.5);
    expect(open.rms).toBeLessThan(5);
  });

  it('degrades in an urban canyon and indoors', () => {
    expect(urban.used).toBeLessThan(open.used);
    expect(urban.rms).toBeGreaterThan(2 * open.rms);
    expect(indoor.rms).toBeGreaterThan(2 * open.rms);
    expect(urban.rms).toBeLessThan(60);
  });
});
