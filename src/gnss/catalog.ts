import type { SystemId } from './systems';
import { CATALOG_ENTRIES, CATALOG_AS_OF } from './catalogData';

export type SatelliteStatus =
  | 'healthy'
  | 'unhealthy'
  | 'testing'
  | 'spare'
  | 'maintenance'
  | 'decommissioned'
  | 'unknown';

export type OrbitClass = 'MEO' | 'IGSO' | 'GEO';

export interface SatelliteInfo {
  norad: number;
  system: SystemId;
  /** PRN / SVID with system letter (G05, E11, R07, C19); empty when not assigned. */
  prn: string;
  svn: string;
  block: string;
  orbit: OrbitClass;
  plane: string;
  slot: string;
  /** GLONASS FDMA frequency channel number k (0 for CDMA systems). */
  freqChannel: number;
  status: SatelliteStatus;
  /** Open-service signals broadcast in the L1/E1/B1 band. */
  signals: string;
  notes: string;
}

export { CATALOG_AS_OF };

const BY_NORAD = new Map<number, SatelliteInfo>(CATALOG_ENTRIES.map((e) => [e.norad, e]));

/** Catalog record for a satellite, or a placeholder marked "unknown" if it is not catalogued. */
export function lookupSatellite(norad: number, system: SystemId, name: string): SatelliteInfo {
  const known = BY_NORAD.get(norad);
  if (known) return known;
  return {
    norad,
    system,
    prn: '',
    svn: '',
    block: '',
    orbit: 'MEO',
    plane: '',
    slot: '',
    freqChannel: 0,
    status: 'unknown',
    signals: '',
    notes: `Not in the catalogue (${name}); treated as unusable.`,
  };
}

/** Satellites the receiver may use in a position fix. */
export function isUsable(info: SatelliteInfo): boolean {
  return info.status === 'healthy' && info.prn !== '';
}
