/** Speed of light in vacuum (m/s), the value fixed in every GNSS interface specification. */
export const SPEED_OF_LIGHT = 299_792_458;

/** WGS-84 Earth rotation rate (rad/s). */
export const EARTH_ROTATION_RATE = 7.2921151467e-5;

/** WGS-84 ellipsoid. */
export const WGS84 = {
  a: 6_378_137,
  f: 1 / 298.257223563,
} as const;

export const DEG = Math.PI / 180;

/** GPS L1 / Galileo E1 carrier (Hz); the reference frequency for ionospheric scaling. */
export const F_L1 = 1_575.42e6;

/**
 * GPS time − UTC in seconds (leap seconds introduced since the GPS epoch).
 * 18 s since 2017-01-01; no leap second has been added since.
 */
export const GPS_UTC_LEAP_SECONDS = 18;

/** GPS time epoch, 1980-01-06T00:00:00 (UTC and GPS time coincided then). */
export const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);

/** Thermal noise power spectral density kT at T0 = 290 K (dBW/Hz). */
export const THERMAL_NOISE_DBW_HZ = -203.98;
