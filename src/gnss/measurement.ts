// Truth-side signal model: how long the signal actually travels and which errors
// end up in the pseudorange the receiver measures.
import { EARTH_ROTATION_RATE, SPEED_OF_LIGHT } from './constants';
import { norm, sub, type Vec3 } from './geodesy';
import { transmitPosition } from './pvt';

export interface SignalPath {
  /** Geometric distance from the transmit position to the receiver (m), including Earth rotation. */
  range: number;
  /** Signal travel time (s). */
  travelTime: number;
  /** Range change caused by Earth rotation during transit (Sagnac effect) (m). */
  sagnacM: number;
}

/** Solves the light-time equation |s(t − τ) − r| = c·τ by fixed-point iteration. */
export function signalPath(satPosition: Vec3, satVelocity: Vec3, receiver: Vec3): SignalPath {
  let tau = norm(sub(satPosition, receiver)) / SPEED_OF_LIGHT;
  let range = 0;
  for (let i = 0; i < 4; i++) {
    range = norm(sub(transmitPosition(satPosition, satVelocity, tau), receiver));
    tau = range / SPEED_OF_LIGHT;
  }
  const atTransmit: Vec3 = [
    satPosition[0] - satVelocity[0] * tau,
    satPosition[1] - satVelocity[1] * tau,
    satPosition[2] - satVelocity[2] * tau,
  ];
  return { range, travelTime: tau, sagnacM: range - norm(sub(atTransmit, receiver)) };
}

/**
 * Earth-rotation (Sagnac) range correction in closed form, ωe/c · (x_s·y_r − y_s·x_r).
 * Equivalent to the rotation applied in {@link signalPath}; exposed for checks and display.
 */
export function sagnacCorrection(satPosition: Vec3, receiver: Vec3): number {
  return (EARTH_ROTATION_RATE / SPEED_OF_LIGHT) * (satPosition[0] * receiver[1] - satPosition[1] * receiver[0]);
}

/** The error terms contained in one pseudorange, all in metres. */
export interface RangeErrors {
  receiverClock: number;
  interSystemBias: number;
  satelliteOrbitClock: number;
  /** Ionospheric delay actually experienced. */
  ionosphere: number;
  /** Ionospheric delay predicted by the receiver's broadcast model. */
  ionosphereModel: number;
  troposphere: number;
  troposphereModel: number;
  multipath: number;
  noise: number;
}

/** Error left after the receiver applies its models (excluding the receiver clock terms it solves for). */
export function residualError(e: RangeErrors): number {
  return (
    e.satelliteOrbitClock +
    (e.ionosphere - e.ionosphereModel) +
    (e.troposphere - e.troposphereModel) +
    e.multipath +
    e.noise
  );
}
