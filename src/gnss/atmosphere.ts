import { DEG, F_L1, SPEED_OF_LIGHT } from './constants';

/** Broadcast Klobuchar coefficients: alpha (s, s/sc, s/sc², s/sc³), beta (s, s/sc, s/sc², s/sc³). */
export interface KlobucharCoefficients {
  alpha: [number, number, number, number];
  beta: [number, number, number, number];
}

/**
 * GPS single-frequency ionospheric model (IS-GPS-200, 20.3.3.5.2.5).
 * Returns the L1 group delay in seconds.
 *
 * @param latDeg, lonDeg  receiver geodetic position
 * @param elDeg, azDeg    satellite elevation / azimuth
 * @param gpsSecondsOfWeek GPS time
 */
export function klobucharDelay(
  coeffs: KlobucharCoefficients,
  latDeg: number,
  lonDeg: number,
  elDeg: number,
  azDeg: number,
  gpsSecondsOfWeek: number,
): number {
  // The algorithm works in semicircles.
  const E = elDeg / 180;
  const phiU = latDeg / 180;
  const lamU = lonDeg / 180;
  const A = azDeg * DEG;

  const psi = 0.0137 / (E + 0.11) - 0.022;
  const phiI = Math.max(-0.416, Math.min(0.416, phiU + psi * Math.cos(A)));
  const lamI = lamU + (psi * Math.sin(A)) / Math.cos(phiI * Math.PI);
  const phiM = phiI + 0.064 * Math.cos((lamI - 1.617) * Math.PI);

  let t = 4.32e4 * lamI + gpsSecondsOfWeek;
  t = ((t % 86_400) + 86_400) % 86_400;

  const F = 1 + 16 * (0.53 - E) ** 3;
  const { alpha, beta } = coeffs;
  let amp = alpha[0] + alpha[1] * phiM + alpha[2] * phiM ** 2 + alpha[3] * phiM ** 3;
  let per = beta[0] + beta[1] * phiM + beta[2] * phiM ** 2 + beta[3] * phiM ** 3;
  if (amp < 0) amp = 0;
  if (per < 72_000) per = 72_000;

  const x = (2 * Math.PI * (t - 50_400)) / per;
  if (Math.abs(x) >= 1.57) return F * 5e-9;
  return F * (5e-9 + amp * (1 - x ** 2 / 2 + x ** 4 / 24));
}

/** Converts an L1 ionospheric delay (s) to metres on another carrier (delay ∝ 1/f²). */
export function ionoDelayMeters(l1DelaySeconds: number, carrierHz: number): number {
  return SPEED_OF_LIGHT * l1DelaySeconds * (F_L1 / carrierHz) ** 2;
}

export interface Meteo {
  /** Total pressure (hPa). */
  pressure: number;
  /** Temperature (K). */
  temperature: number;
  /** Relative humidity (0-1). */
  humidity: number;
}

/** Standard atmosphere at height h (m) above sea level, with a given relative humidity. */
export function standardAtmosphere(heightM: number, humidity = 0.5): Meteo {
  const h = Math.max(heightM, -500);
  return {
    pressure: 1013.25 * (1 - 2.2557e-5 * h) ** 5.2568,
    temperature: 288.15 - 6.5e-3 * h,
    humidity,
  };
}

function waterVapourPressure(m: Meteo): number {
  const tc = m.temperature - 273.15;
  return m.humidity * 6.108 * Math.exp((17.15 * tc) / (234.7 + tc));
}

/** Saastamoinen zenith hydrostatic and wet delays (m). */
export function saastamoinenZenith(latDeg: number, heightM: number, m: Meteo): { zhd: number; zwd: number } {
  const zhd = (0.0022768 * m.pressure) / (1 - 0.00266 * Math.cos(2 * latDeg * DEG) - 0.00028 * (heightM / 1000));
  const zwd = 0.002277 * (1255 / m.temperature + 0.05) * waterVapourPressure(m);
  return { zhd, zwd };
}

/** Black & Eisner elevation mapping function (adequate above ~5°). */
export function tropoMapping(elDeg: number): number {
  const s = Math.sin(Math.max(elDeg, 2) * DEG);
  return 1.001 / Math.sqrt(0.002001 + s * s);
}
