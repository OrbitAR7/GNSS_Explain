// Weighted least-squares position, velocity-free and time (PVT) solution from
// pseudoranges — the standard single-point positioning algorithm.
//
//   ρ_i = | R3(ωe·τ_i) · s_i(t − τ_i) − x | + b_sys(i) + ε_i
//
// Unknowns: receiver ECEF position x and one receiver clock bias b per constellation
// (constellations run on different time scales and the receiver has system-specific
// hardware delays). τ_i is the signal travel time; R3 rotates the satellite position
// for Earth rotation during transit (Sagnac effect).
import { EARTH_ROTATION_RATE, SPEED_OF_LIGHT } from './constants';
import { ecefToGeodetic, enuBasis, rotateZ, type Geodetic, type Vec3 } from './geodesy';
import { SYSTEM_IDS, type SystemId } from './systems';

export interface PvtMeasurement {
  id: string;
  system: SystemId;
  /** Satellite ECEF position at the receive epoch, from the broadcast ephemeris (m). */
  satPosition: Vec3;
  /** Satellite ECEF velocity at the receive epoch (m/s). */
  satVelocity: Vec3;
  /** Pseudorange after satellite clock, ionospheric and tropospheric model corrections (m). */
  pseudorange: number;
  /** Expected 1-sigma error of the pseudorange (m), used for weighting. */
  sigma: number;
}

export interface PvtOptions {
  /** 'estimate': solve the clock(s). 'fixed': trust the receiver clock (bias given in metres). */
  clock: 'estimate' | 'fixed';
  fixedClockBiasM?: number;
  /** Constrain the ellipsoidal height (altitude aiding) to allow a fix with one fewer satellite. */
  altitudeAiding?: { heightM: number; sigmaM: number };
  /** Linearisation point; required for altitude aiding. */
  initialPosition?: Vec3;
  maxIterations?: number;
}

export interface Dop {
  gdop: number;
  pdop: number;
  hdop: number;
  vdop: number;
  tdop: number | null;
}

export type FixType = '3D' | '2D' | 'clock-assumed';

export interface PvtSolution {
  fixType: FixType;
  position: Vec3;
  geodetic: Geodetic;
  /** Clock bias per constellation (m). */
  clockBiasM: Partial<Record<SystemId, number>>;
  referenceSystem: SystemId;
  dop: Dop | null;
  residuals: Map<string, number>;
  iterations: number;
  converged: boolean;
}

type Matrix = number[][];

function solveLinear(A: Matrix, b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const rowC = M[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = M[r]!;
      const f = row[col]! / rowC[col]!;
      for (let k = col; k <= n; k++) row[k]! -= f * rowC[k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function invert(A: Matrix): Matrix | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let i = 0; i < n; i++) {
    const col = solveLinear(
      A,
      Array.from({ length: n }, (_, k) => (k === i ? 1 : 0)),
    );
    if (!col) return null;
    cols.push(col);
  }
  return A.map((_, r) => cols.map((c) => c[r]!));
}

function normalMatrix(H: Matrix, w: number[]): Matrix {
  const nu = H[0]?.length ?? 0;
  const N: Matrix = Array.from({ length: nu }, () => new Array<number>(nu).fill(0));
  H.forEach((row, i) => {
    const wi = w[i]!;
    for (let a = 0; a < nu; a++) {
      const ra = row[a]! * wi;
      if (ra === 0) continue;
      for (let b = 0; b < nu; b++) N[a]![b]! += ra * row[b]!;
    }
  });
  return N;
}

/** Satellite position at transmit time, rotated into the ECEF frame at receive time. */
export function transmitPosition(satPosition: Vec3, satVelocity: Vec3, travelTime: number): Vec3 {
  const p: Vec3 = [
    satPosition[0] - satVelocity[0] * travelTime,
    satPosition[1] - satVelocity[1] * travelTime,
    satPosition[2] - satVelocity[2] * travelTime,
  ];
  return rotateZ(p, EARTH_ROTATION_RATE * travelTime);
}

/** Number of measurements needed for a fix with the given constellations. */
export function requiredMeasurements(systems: number, opts: Pick<PvtOptions, 'clock' | 'altitudeAiding'>): number {
  const unknowns = 3 + (opts.clock === 'estimate' ? systems : 0);
  return opts.altitudeAiding ? unknowns - 1 : unknowns;
}

export function solvePvt(meas: PvtMeasurement[], opts: PvtOptions): PvtSolution | null {
  const systems = SYSTEM_IDS.filter((s) => meas.some((m) => m.system === s));
  const estimateClock = opts.clock === 'estimate';
  const clockIndex = new Map(systems.map((s, i) => [s, 3 + i]));
  const nu = 3 + (estimateClock ? systems.length : 0);
  const aiding = opts.altitudeAiding && opts.initialPosition ? opts.altitudeAiding : undefined;
  if (meas.length + (aiding ? 1 : 0) < nu || systems.length === 0) return null;
  const fixType: FixType = !estimateClock ? 'clock-assumed' : meas.length >= nu ? '3D' : '2D';
  const useAiding = fixType === '2D' ? aiding : undefined;

  const x = new Array<number>(nu).fill(0);
  if (opts.initialPosition) [x[0], x[1], x[2]] = opts.initialPosition;
  const fixedClock = opts.fixedClockBiasM ?? 0;
  const clockOf = (s: SystemId): number => (estimateClock ? x[clockIndex.get(s)!]! : fixedClock);

  let H: Matrix = [];
  let converged = false;
  let iterations = 0;
  const residuals = new Map<string, number>();
  const maxIter = opts.maxIterations ?? 20;

  for (; iterations < maxIter; iterations++) {
    H = [];
    const res: number[] = [];
    const w: number[] = [];
    const pos: Vec3 = [x[0]!, x[1]!, x[2]!];
    for (const m of meas) {
      const clock = clockOf(m.system);
      const tau = Math.max(0, (m.pseudorange - clock) / SPEED_OF_LIGHT);
      const s = transmitPosition(m.satPosition, m.satVelocity, tau);
      const dx = s[0] - pos[0];
      const dy = s[1] - pos[1];
      const dz = s[2] - pos[2];
      const r = Math.hypot(dx, dy, dz);
      const row = new Array<number>(nu).fill(0);
      row[0] = -dx / r;
      row[1] = -dy / r;
      row[2] = -dz / r;
      if (estimateClock) row[clockIndex.get(m.system)!] = 1;
      H.push(row);
      const v = m.pseudorange - (r + clock);
      res.push(v);
      residuals.set(m.id, v);
      w.push(1 / (m.sigma * m.sigma));
    }
    if (useAiding) {
      const geo = ecefToGeodetic(pos);
      const up = enuBasis(geo.lat, geo.lon).u;
      const row = new Array<number>(nu).fill(0);
      [row[0], row[1], row[2]] = up;
      H.push(row);
      res.push(useAiding.heightM - geo.h);
      w.push(1 / (useAiding.sigmaM * useAiding.sigmaM));
    }

    const N = normalMatrix(H, w);
    const g = new Array<number>(nu).fill(0);
    H.forEach((row, i) => {
      for (let a = 0; a < nu; a++) g[a]! += row[a]! * w[i]! * res[i]!;
    });
    const delta = solveLinear(N, g);
    if (!delta) return null;
    for (let k = 0; k < nu; k++) x[k]! += delta[k]!;
    if (Math.hypot(delta[0]!, delta[1]!, delta[2]!) < 1e-4) {
      converged = true;
      iterations++;
      break;
    }
  }

  const position: Vec3 = [x[0]!, x[1]!, x[2]!];
  if (!position.every(Number.isFinite)) return null;
  const geodetic = ecefToGeodetic(position);
  const clockBiasM: Partial<Record<SystemId, number>> = {};
  for (const s of systems) clockBiasM[s] = clockOf(s);

  return {
    fixType,
    position,
    geodetic,
    clockBiasM,
    referenceSystem: systems[0]!,
    dop: dilutionOfPrecision(H, geodetic, estimateClock),
    residuals,
    iterations,
    converged,
  };
}

/** DOP from the geometry matrix (unit weights), rotated into local east/north/up. */
function dilutionOfPrecision(H: Matrix, at: Geodetic, withClock: boolean): Dop | null {
  const Q = invert(normalMatrix(H, H.map(() => 1)));
  if (!Q) return null;
  const { e, n, u } = enuBasis(at.lat, at.lon);
  const R = [e, n, u];
  const qEnu = (a: number, b: number): number => {
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += R[a]![i]! * Q[i]![j]! * R[b]![j]!;
    return s;
  };
  const pos2 = Q[0]![0]! + Q[1]![1]! + Q[2]![2]!;
  const t2 = withClock ? Q[3]![3]! : 0;
  return {
    gdop: Math.sqrt(pos2 + t2),
    pdop: Math.sqrt(pos2),
    hdop: Math.sqrt(qEnu(0, 0) + qEnu(1, 1)),
    vdop: Math.sqrt(qEnu(2, 2)),
    tdop: withClock ? Math.sqrt(t2) : null,
  };
}
