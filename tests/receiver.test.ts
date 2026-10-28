import { describe, expect, it } from 'vitest';
import { CATALOG_ENTRIES } from '../src/gnss/catalogData';
import { GnssReceiver } from '../src/gnss/receiver';
import { SYSTEM_IDS } from '../src/gnss/systems';
import { EPOCH, loadSatellites, propagate, RIYADH } from './helpers';

const sats = loadSatellites();

function run(rx: GnssReceiver, seconds: number, step = 1, start = EPOCH): void {
  for (let t = 0; t <= seconds; t += step) {
    const now = new Date(start.getTime() + t * 1000);
    propagate(sats, now);
    rx.update(now, sats);
  }
}

describe('receiver', () => {
  it('catalogues every satellite in the snapshot', () => {
    const catalogued = new Set(CATALOG_ENTRIES.map((e) => e.norad));
    expect(sats.filter((s) => !catalogued.has(s.elements.norad)).map((s) => s.elements.name)).toEqual([]);
  });

  it('assigns unique PRNs to healthy satellites', () => {
    for (const id of SYSTEM_IDS) {
      const prns = sats.filter((s) => s.system.id === id && s.info.status === 'healthy').map((s) => s.info.prn);
      expect(new Set(prns).size).toBe(prns.length);
    }
  });

  it('gets an assisted multi-constellation fix in Riyadh within seconds', () => {
    const rx = new GnssReceiver(RIYADH);
    rx.powerOn(EPOCH);
    run(rx, 12);
    expect(rx.fix?.type).toBe('3D');
    expect(rx.ttff!).toBeLessThan(10);
    expect(rx.fix!.systemsUsed.length).toBe(4);
    expect(rx.fix!.error.horizontal).toBeLessThan(10);
  });

  it('needs tens of seconds for a standalone cold start', () => {
    const rx = new GnssReceiver(RIYADH);
    rx.config.assistance = 'standalone';
    rx.powerOn(EPOCH);
    run(rx, 90);
    expect(rx.ttff!).toBeGreaterThan(18);
    expect(rx.ttff!).toBeLessThan(70);
  });

  it('never uses unhealthy satellites', () => {
    const rx = new GnssReceiver(RIYADH);
    rx.powerOn(EPOCH);
    run(rx, 10);
    expect(rx.used.every((o) => o.sat.info.status === 'healthy')).toBe(true);
  });
});
