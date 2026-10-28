import { twoline2satrec } from 'satellite-js-dist/io.js';
import { propagate, gstime } from 'satellite-js-dist/propagation.js';
import type { SatRec } from 'satellite-js-dist/propagation/SatRec.js';
import { EARTH_ROTATION_RATE } from './constants';
import type { ElementSet } from './elements';
import type { Vec3 } from './geodesy';
import type { SatelliteInfo } from './catalog';
import type { GnssSystem } from './systems';

export { gstime };

/**
 * One GNSS satellite propagated with SGP4 from its element set.
 * Positions and velocities are Earth-fixed (ECEF, metres and m/s). SGP4 output is
 * in the TEME frame; it is rotated into the Earth-fixed frame with Greenwich mean
 * sidereal time (polar motion and UT1−UTC are neglected, < 15 m at GNSS altitude).
 */
export class Satellite {
  readonly id: string;
  readonly elements: ElementSet;
  readonly periodMinutes: number;
  /** ECEF position (m). */
  readonly position: Vec3 = [0, 0, 0];
  /** ECEF velocity (m/s), including the Earth-rotation term. */
  readonly velocity: Vec3 = [0, 0, 0];
  /** Inertial (TEME) speed (m/s). */
  inertialSpeed = 0;
  valid = false;

  private readonly satrec: SatRec;

  constructor(
    readonly system: GnssSystem,
    readonly info: SatelliteInfo,
    elements: ElementSet,
  ) {
    this.elements = elements;
    this.id = info.prn || `${system.letter}-${elements.norad}`;
    this.satrec = twoline2satrec(elements.line1, elements.line2);
    this.periodMinutes = (2 * Math.PI) / this.satrec.no;
  }

  /** PRN, or for a satellite without one (retired, reserve) its SVN in IGS style, e.g. R720. */
  get label(): string {
    if (this.info.prn) return this.info.prn;
    const svn = this.info.svn.replace(/^SVN/, '');
    if (!svn) return `${this.system.letter}-${this.elements.norad}`;
    return svn.startsWith(this.system.letter) ? svn : `${this.system.letter}${svn}`;
  }

  update(date: Date, gmst: number): void {
    const pv = propagate(this.satrec, date);
    if (!pv) {
      this.valid = false;
      return;
    }
    const c = Math.cos(gmst);
    const s = Math.sin(gmst);
    const { x, y, z } = pv.position;
    const v = pv.velocity;
    const px = (c * x + s * y) * 1000;
    const py = (-s * x + c * y) * 1000;
    this.position[0] = px;
    this.position[1] = py;
    this.position[2] = z * 1000;
    this.velocity[0] = (c * v.x + s * v.y) * 1000 + EARTH_ROTATION_RATE * py;
    this.velocity[1] = (-s * v.x + c * v.y) * 1000 - EARTH_ROTATION_RATE * px;
    this.velocity[2] = v.z * 1000;
    this.inertialSpeed = Math.hypot(v.x, v.y, v.z) * 1000;
    this.valid = true;
  }

  /**
   * One orbital period sampled in the inertial (TEME) frame, in metres. Rotating it by
   * −GMST gives the orbit as seen in the Earth-fixed frame at that instant.
   */
  sampleOrbitInertial(start: Date, steps = 160): Vec3[] {
    const points: Vec3[] = [];
    const periodMs = this.periodMinutes * 60_000;
    for (let i = 0; i <= steps; i++) {
      const pv = propagate(this.satrec, new Date(start.getTime() + (i / steps) * periodMs));
      if (!pv) continue;
      points.push([pv.position.x * 1000, pv.position.y * 1000, pv.position.z * 1000]);
    }
    return points;
  }
}
