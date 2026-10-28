import { readFileSync } from 'node:fs';
import { lookupSatellite } from '../src/gnss/catalog';
import { parseElementSets } from '../src/gnss/elements';
import { gstime, Satellite } from '../src/gnss/satellite';
import { SYSTEM_IDS, SYSTEMS } from '../src/gnss/systems';

export const RIYADH = { lat: 24.7136, lon: 46.6753, h: 600 };
export const EPOCH = new Date('2026-10-18T13:00:00Z');

export function loadSatellites(): Satellite[] {
  return SYSTEM_IDS.flatMap((id) => {
    const system = SYSTEMS[id];
    const text = readFileSync(`public/data/elements/${system.elementsFile}.tle`, 'utf8');
    return parseElementSets(text).map((e) => new Satellite(system, lookupSatellite(e.norad, id, e.name), e));
  });
}

export function propagate(satellites: Satellite[], date: Date): void {
  const g = gstime(date);
  for (const s of satellites) s.update(date, g);
}
