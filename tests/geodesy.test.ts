import { describe, expect, it } from 'vitest';
import { dot, ecefToGeodetic, enuBasis, geodeticToEcef, lookAngles, norm, rotateZ } from '../src/gnss/geodesy';
import { RIYADH } from './helpers';

describe('geodesy', () => {
  it('round-trips geodetic ↔ ECEF to sub-millimetre precision', () => {
    for (const p of [RIYADH, { lat: -33.9, lon: 151.2, h: 40 }, { lat: 78.2, lon: 15.6, h: 10 }, { lat: 0, lon: -78.5, h: 2850 }]) {
      const back = ecefToGeodetic(geodeticToEcef(p));
      expect(back.lat).toBeCloseTo(p.lat, 9);
      expect(back.lon).toBeCloseTo(p.lon, 9);
      expect(back.h).toBeCloseTo(p.h, 3);
    }
  });

  it('places the equator/prime meridian point on the semi-major axis', () => {
    const p = geodeticToEcef({ lat: 0, lon: 0, h: 0 });
    expect(p[0]).toBeCloseTo(6_378_137, 3);
    expect(p[1]).toBeCloseTo(0, 6);
  });

  it('builds an orthonormal east/north/up frame', () => {
    const { e, n, u } = enuBasis(RIYADH.lat, RIYADH.lon);
    expect(dot(e, n)).toBeCloseTo(0, 12);
    expect(dot(n, u)).toBeCloseTo(0, 12);
    expect(norm(u)).toBeCloseTo(1, 12);
  });

  it('computes 90° elevation for a point straight up', () => {
    const rx = geodeticToEcef(RIYADH);
    const above = geodeticToEcef({ ...RIYADH, h: RIYADH.h + 20_000_000 });
    expect(lookAngles(rx, enuBasis(RIYADH.lat, RIYADH.lon), above).el).toBeCloseTo(90, 6);
  });

  it('rotates about Z as a frame rotation', () => {
    const r = rotateZ([1, 0, 0], Math.PI / 2);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(-1, 12);
  });
});
