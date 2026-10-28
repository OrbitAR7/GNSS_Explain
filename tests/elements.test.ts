import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseElementSets, tleChecksumValid } from '../src/gnss/elements';
import { SYSTEM_IDS, SYSTEMS } from '../src/gnss/systems';

const ISS_L1 = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927';
const ISS_L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';

describe('two-line elements', () => {
  it('validates the reference checksum example', () => {
    expect(tleChecksumValid(ISS_L1)).toBe(true);
    expect(tleChecksumValid(ISS_L2)).toBe(true);
    expect(tleChecksumValid(ISS_L1.slice(0, 68) + '0')).toBe(false);
  });

  it('parses the epoch', () => {
    const [set] = parseElementSets(`ISS\n${ISS_L1}\n${ISS_L2}\n`);
    expect(set?.norad).toBe(25544);
    expect(set?.epoch.toISOString().slice(0, 16)).toBe('2008-09-20T12:25');
  });

  it('rejects corrupted element sets', () => {
    expect(() => parseElementSets(`ISS\n${ISS_L1.slice(0, 68)}5\n${ISS_L2}\n`)).toThrow(/checksum/);
  });

  it.each(SYSTEM_IDS)('bundled %s snapshot is complete and valid', (id) => {
    const text = readFileSync(`public/data/elements/${SYSTEMS[id].elementsFile}.tle`, 'utf8');
    const sets = parseElementSets(text);
    expect(sets.length).toBeGreaterThan(20);
    expect(new Set(sets.map((s) => s.norad)).size).toBe(sets.length);
  });
});
