import { DEG, WGS84 } from './constants';

export type Vec3 = [number, number, number];

const E2 = WGS84.f * (2 - WGS84.f);

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export interface Geodetic {
  /** Geodetic latitude, degrees. */
  lat: number;
  /** Longitude, degrees east. */
  lon: number;
  /** Height above the WGS-84 ellipsoid, metres. */
  h: number;
}

export interface EnuBasis {
  e: Vec3;
  n: Vec3;
  u: Vec3;
}

export interface LookAngles {
  /** Azimuth from true north, degrees [0, 360). */
  az: number;
  /** Elevation above the local horizon, degrees. */
  el: number;
  /** Straight-line distance, metres. */
  range: number;
  /** Unit line-of-sight vector from receiver to satellite (ECEF). */
  los: Vec3;
}

export function geodeticToEcef({ lat, lon, h }: Geodetic): Vec3 {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const N = WGS84.a / Math.sqrt(1 - E2 * s * s);
  return [(N + h) * c * Math.cos(lam), (N + h) * c * Math.sin(lam), (N * (1 - E2) + h) * s];
}

/** ECEF to geodetic by fixed-point iteration (converges to < 1 mm in a few steps for terrestrial points). */
export function ecefToGeodetic([x, y, z]: Vec3): Geodetic {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  if (p < 1e-3) {
    const b = WGS84.a * (1 - WGS84.f);
    return { lat: Math.sign(z) * 90, lon: 0, h: Math.abs(z) - b };
  }
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(lat);
    const N = WGS84.a / Math.sqrt(1 - E2 * s * s);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - (E2 * N) / (N + h)));
  }
  return { lat: lat / DEG, lon: lon / DEG, h };
}

export function enuBasis(lat: number, lon: number): EnuBasis {
  const sp = Math.sin(lat * DEG);
  const cp = Math.cos(lat * DEG);
  const sl = Math.sin(lon * DEG);
  const cl = Math.cos(lon * DEG);
  return {
    e: [-sl, cl, 0],
    n: [-sp * cl, -sp * sl, cp],
    u: [cp * cl, cp * sl, sp],
  };
}

export function lookAngles(receiver: Vec3, basis: EnuBasis, target: Vec3): LookAngles {
  const d = sub(target, receiver);
  const range = norm(d);
  const los = scale(d, 1 / range);
  const e = dot(los, basis.e);
  const n = dot(los, basis.n);
  const u = dot(los, basis.u);
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, u))) / DEG, range, los };
}

/** Angle between two sky directions (degrees). */
export function skySeparation(a: { az: number; el: number }, b: { az: number; el: number }): number {
  const v = (o: { az: number; el: number }): Vec3 => [
    Math.cos(o.el * DEG) * Math.sin(o.az * DEG),
    Math.cos(o.el * DEG) * Math.cos(o.az * DEG),
    Math.sin(o.el * DEG),
  ];
  return Math.acos(Math.max(-1, Math.min(1, dot(v(a), v(b))))) / DEG;
}

/** Rotates an ECEF vector about the Z axis by `angle` radians (frame rotation, as in the Sagnac correction). */
export function rotateZ([x, y, z]: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x + s * y, -s * x + c * y, z];
}
