import type { Geodetic } from '../gnss/geodesy';

export interface Place {
  id: string;
  name: string;
  region: string;
  /** IANA time zone, for the phone's local clock. */
  timeZone: string;
  /** Position with ellipsoidal (WGS-84) height. */
  position: Geodetic;
}

// Ellipsoidal height = ground elevation above mean sea level + geoid undulation (EGM2008).
export const PLACES: Place[] = [
  { id: 'riyadh', name: 'Riyadh', region: 'Saudi Arabia', timeZone: 'Asia/Riyadh', position: { lat: 24.7136, lon: 46.6753, h: 600 } },
  { id: 'jeddah', name: 'Jeddah', region: 'Saudi Arabia', timeZone: 'Asia/Riyadh', position: { lat: 21.5433, lon: 39.1728, h: 0 } },
  { id: 'dammam', name: 'Dammam', region: 'Saudi Arabia', timeZone: 'Asia/Riyadh', position: { lat: 26.4207, lon: 50.0888, h: 0 } },
  { id: 'neom', name: 'NEOM', region: 'Saudi Arabia', timeZone: 'Asia/Riyadh', position: { lat: 27.9547, lon: 35.2924, h: 0 } },
  { id: 'abha', name: 'Abha', region: 'Saudi Arabia', timeZone: 'Asia/Riyadh', position: { lat: 18.2164, lon: 42.5053, h: 2270 } },
  { id: 'quito', name: 'Quito (equator)', region: 'Ecuador', timeZone: 'America/Guayaquil', position: { lat: -0.1807, lon: -78.4678, h: 2850 } },
  { id: 'svalbard', name: 'Longyearbyen (Arctic)', region: 'Svalbard', timeZone: 'Arctic/Longyearbyen', position: { lat: 78.2232, lon: 15.6267, h: 40 } },
];

export const DEFAULT_PLACE = PLACES[0]!;
