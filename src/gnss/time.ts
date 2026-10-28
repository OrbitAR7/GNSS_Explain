import { GPS_EPOCH_MS, GPS_UTC_LEAP_SECONDS } from './constants';

const SECONDS_PER_WEEK = 604_800;

export interface GpsTime {
  week: number;
  /** Seconds of week. */
  tow: number;
}

/** Continuous GPS time in seconds since the GPS epoch. */
export function gpsSeconds(utc: Date): number {
  return (utc.getTime() - GPS_EPOCH_MS) / 1000 + GPS_UTC_LEAP_SECONDS;
}

export function toGpsTime(utc: Date): GpsTime {
  const s = gpsSeconds(utc);
  const week = Math.floor(s / SECONDS_PER_WEEK);
  return { week, tow: s - week * SECONDS_PER_WEEK };
}

/** GPS seconds of day, used for local-time dependent models. */
export function gpsSecondsOfDay(utc: Date): number {
  return ((gpsSeconds(utc) % 86_400) + 86_400) % 86_400;
}

/** Next time (GPS seconds) at or after `t` that is a multiple of `period`, plus `offset`. */
export function nextBoundary(t: number, period: number, offset = 0): number {
  return Math.ceil((t - offset) / period) * period + offset;
}
