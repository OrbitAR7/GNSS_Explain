// Extension point for interference scenarios (jamming, spoofing, meaconing).
//
// The receiver calls these hooks on every update. A threat implements only the hooks
// it needs:
//   noiseRiseDb      raises the effective noise floor (jamming): C/N0 falls on every
//                    satellite, weak ones are lost first, and eventually the fix.
//   adjustObservation modifies one satellite's observation (e.g. attenuate or block it).
//   adjustMeasurements rewrites the pseudoranges entering the position solution
//                    (spoofing: consistent counterfeit ranges that pull the fix elsewhere).
import type { PvtMeasurement } from '../gnss/pvt';
import type { GnssReceiver, Observation } from '../gnss/receiver';

export interface ThreatContext {
  utc: Date;
  receiver: GnssReceiver;
}

export interface Threat {
  id: string;
  label: string;
  noiseRiseDb?(ctx: ThreatContext): number;
  adjustObservation?(obs: Observation, ctx: ThreatContext): void;
  adjustMeasurements?(meas: PvtMeasurement[], ctx: ThreatContext): PvtMeasurement[];
}

const threats = new Map<string, Threat>();

export function registerThreat(threat: Threat): void {
  threats.set(threat.id, threat);
}

export function removeThreat(id: string): void {
  threats.delete(id);
}

export function activeThreats(): Threat[] {
  return [...threats.values()];
}

/** Combined rise of the noise floor above thermal noise (dB). */
export function interferenceRiseDb(ctx: ThreatContext): number {
  let interferenceToNoise = 0;
  for (const t of threats.values()) {
    if (t.noiseRiseDb) interferenceToNoise += 10 ** (t.noiseRiseDb(ctx) / 10);
  }
  return interferenceToNoise > 0 ? 10 * Math.log10(1 + interferenceToNoise) : 0;
}

export function applyObservationThreats(obs: Observation, ctx: ThreatContext): void {
  for (const t of threats.values()) t.adjustObservation?.(obs, ctx);
}

export function applyMeasurementThreats(meas: PvtMeasurement[], ctx: ThreatContext): PvtMeasurement[] {
  let out = meas;
  for (const t of threats.values()) if (t.adjustMeasurements) out = t.adjustMeasurements(out, ctx);
  return out;
}
