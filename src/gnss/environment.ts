import { DEG } from './constants';
import { hashString } from './random';

export type EnvironmentId = 'open' | 'urban' | 'indoor';

export interface Obstruction {
  /** True when the direct (line-of-sight) path is blocked. */
  blocked: boolean;
  /** True when some signal still arrives (directly, through material, or reflected). */
  received: boolean;
  /** Attenuation applied to the received signal (dB). */
  lossDb: number;
  /** Excess path length of a reflected-only (NLOS) signal (m). */
  excessPathM: number;
}

export interface Environment {
  id: EnvironmentId;
  label: string;
  description: string;
  /** Elevation of the local skyline (degrees) toward an azimuth; 0 when unobstructed. */
  skyline(azDeg: number): number;
  assess(satKey: string, azDeg: number, elDeg: number): Obstruction;
  /** 1-sigma code multipath error on a line-of-sight signal (m). */
  multipathSigma(elDeg: number): number;
  /** Correlation time of multipath error (s). */
  multipathTau: number;
}

const CLEAR: Obstruction = { blocked: false, received: true, lossDb: 0, excessPathM: 0 };

/** Per-satellite deterministic value in [0, 1) so a given satellite behaves consistently. */
const unit = (key: string, salt: string): number => (hashString(`${key}:${salt}`) % 10_000) / 10_000;

const OPEN_SKY: Environment = {
  id: 'open',
  label: 'Open sky',
  description: 'Unobstructed view of the sky down to the horizon.',
  skyline: () => 0,
  assess: () => CLEAR,
  // A handheld phone's antenna sits next to the user's body and picks up reflections even in open sky.
  multipathSigma: (el) => 1.2 + 2.5 * Math.exp(-el / 20),
  // For a static antenna, multipath changes only as satellite geometry changes.
  multipathTau: 120,
};

/**
 * A straight street lined with buildings on both sides. The elevation of the roof
 * line seen from the middle of the street is atan(H / d), where d is the distance to
 * the façade in that direction. Satellites below the roof line have no direct path;
 * some still arrive by reflection off a façade (weaker, and with a longer path).
 */
function streetCanyon(axisDeg: number, buildingHeightM: number, streetWidthM: number, blockLengthM: number): Environment {
  const skyline = (az: number): number => {
    const across = Math.abs(Math.sin((az - axisDeg) * DEG));
    const distance = Math.min(blockLengthM, streetWidthM / 2 / Math.max(across, 1e-6));
    return Math.atan(buildingHeightM / distance) / DEG;
  };
  return {
    id: 'urban',
    label: 'Urban canyon',
    description: `Street running ${Math.round(axisDeg)}°/${Math.round(axisDeg + 180)}°, ${streetWidthM} m wide, ${buildingHeightM} m buildings.`,
    skyline,
    assess(key, az, el) {
      if (el >= skyline(az)) return CLEAR;
      const reflected = unit(key, 'reflect') < 0.55;
      if (!reflected) return { blocked: true, received: false, lossDb: Infinity, excessPathM: 0 };
      return {
        blocked: true,
        received: true,
        lossDb: 6 + 12 * unit(key, 'loss'),
        excessPathM: 8 + 70 * unit(key, 'path'),
      };
    },
    multipathSigma: (el) => 1.5 + 4 * Math.exp(-el / 20),
    multipathTau: 15,
  };
}

const INDOOR: Environment = {
  id: 'indoor',
  label: 'Indoors',
  description: 'Inside a building near a window: every signal passes through the roof or walls.',
  skyline: () => 0,
  assess(key, _az, el) {
    const throughWall = 8 + 8 * (1 - Math.sin(Math.max(el, 0) * DEG));
    const structure = unit(key, 'indoor') < 0.25 ? 12 : 0;
    return { blocked: true, received: true, lossDb: throughWall + structure + 4 * unit(key, 'var'), excessPathM: 0 };
  },
  multipathSigma: () => 8,
  multipathTau: 10,
};

export const ENVIRONMENTS: Record<EnvironmentId, Environment> = {
  open: OPEN_SKY,
  urban: streetCanyon(160, 45, 40, 350),
  indoor: INDOOR,
};
