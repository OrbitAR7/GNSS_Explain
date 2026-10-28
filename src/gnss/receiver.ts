// Simulated smartphone GNSS receiver: signal acquisition and tracking, navigation
// data timing, pseudorange generation and the position/time solution.
import { klobucharDelay, ionoDelayMeters, saastamoinenZenith, standardAtmosphere, tropoMapping } from './atmosphere';
import type { KlobucharCoefficients, Meteo } from './atmosphere';
import { isUsable } from './catalog';
import { SPEED_OF_LIGHT } from './constants';
import { ENVIRONMENTS, type EnvironmentId, type Obstruction } from './environment';
import {
  dot,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  lookAngles,
  norm,
  skySeparation,
  sub,
  type EnuBasis,
  type Geodetic,
  type Vec3,
} from './geodesy';
import { requiredMeasurements, solvePvt, type Dop, type FixType, type PvtMeasurement } from './pvt';
import { GaussMarkov, gaussian, hashString } from './random';
import type { Satellite } from './satellite';
import { codeTrackingNoiseMeters, linkBudget, SMARTPHONE_FRONT_END, type FrontEnd, type LinkBudget } from './signal';
import { signalPath, type RangeErrors } from './measurement';
import { carrierFrequency, type NavMessageTiming, type SystemId } from './systems';
import { gpsSeconds, nextBoundary } from './time';
import { applyMeasurementThreats, applyObservationThreats, interferenceRiseDb } from '../threats';

/** C/N0 needed to acquire a signal (dB-Hz): with assistance data, and without. */
export const ACQUISITION_THRESHOLD = { assisted: 23, standalone: 30 } as const;
/** C/N0 below which the tracking loops lose lock (dB-Hz). */
export const TRACKING_THRESHOLD = 18;
/** C/N0 needed to demodulate navigation data bits reliably (dB-Hz). */
export const DATA_DEMODULATION_THRESHOLD = 25;
/** Broadcast ephemerides are used for up to 4 h after collection. */
const EPHEMERIS_VALIDITY_S = 4 * 3600;
const MAX_CHANNELS = 64;

/** Receiver inter-system biases relative to GPS (s): time-scale residuals plus receiver hardware delays. */
const INTER_SYSTEM_BIAS_S: Record<SystemId, number> = { GPS: 0, GAL: 6e-9, GLO: 45e-9, BDS: 18e-9 };
/** GLONASS inter-frequency bias per FDMA channel number (s). */
const GLONASS_IFB_PER_CHANNEL_S = 0.8e-9;

/**
 * Ionosphere used to generate the "true" delays: Klobuchar-shaped with solar-maximum
 * amplitudes. The receiver's broadcast model underestimates it, as the real Klobuchar
 * model does during high solar activity.
 */
export const IONOSPHERE_TRUTH: KlobucharCoefficients = {
  alpha: [3.26e-8, 2.24e-8, -1.79e-7, 1.19e-7],
  beta: [1.47e5, 0, -3.28e5, 1.97e5],
};
const BROADCAST_IONO_SCALE = 0.62;
/** Spatial irregularity of the true ionosphere relative to the smooth model (fraction). */
const IONO_IRREGULARITY = 0.2;

/** Weather at the receiver used for the true tropospheric delay (Riyadh, October afternoon). */
const TRUE_METEO_RELATIVE: Omit<Meteo, 'pressure'> = { temperature: 303.15, humidity: 0.2 };

export type AssistanceMode = 'assisted' | 'standalone';
export type Selection = 'strongest' | 'spread' | 'clustered';
export type ClockMode = 'estimate' | 'assume-perfect';

export interface ReceiverConfig {
  assistance: AssistanceMode;
  environment: EnvironmentId;
  elevationMaskDeg: number;
  systems: Record<SystemId, boolean>;
  /** Maximum satellites in the solution (0 = all usable). */
  maxSatellites: number;
  selection: Selection;
  clockMode: ClockMode;
  /** Restrict the solution to one constellation (null = all enabled). */
  solutionSystem: SystemId | null;
}

export type ObservationState = 'searching' | 'acquiring' | 'tracking' | 'ready' | 'used';

export interface Measurement {
  /** Raw pseudorange (m). */
  pseudorange: number;
  /** Pseudorange after the receiver's atmospheric model corrections (m). */
  corrected: number;
  travelTime: number;
  sagnacM: number;
  errors: RangeErrors;
  sigma: number;
  residual?: number;
}

export interface Observation {
  sat: Satellite;
  az: number;
  el: number;
  range: number;
  /** Line-of-sight range rate (m/s, positive receding). */
  rangeRate: number;
  carrierHz: number;
  dopplerHz: number;
  link: LinkBudget;
  obstruction: Obstruction;
  masked: boolean;
  excluded: boolean;
  /** Healthy and catalogued: may be used in a fix. */
  healthy: boolean;
  state: ObservationState;
  /** Progress (0-1) toward a usable measurement while acquiring / reading navigation data. */
  progress: number;
  hasEphemeris: boolean;
  measurement?: Measurement;
}

export interface Fix {
  type: FixType;
  position: Vec3;
  geodetic: Geodetic;
  dop: Dop | null;
  satellitesUsed: number;
  systemsUsed: SystemId[];
  /** Receiver clock bias relative to GPS time, as estimated (s). */
  clockBiasS: number;
  interSystemBiasS: Partial<Record<SystemId, number>>;
  /** Estimated 95 % horizontal accuracy (m): 2 · HDOP · σ_UERE. */
  accuracyH95: number | null;
  /** True error versus the simulated truth (m), east/north/up and magnitudes. */
  error: { e: number; n: number; u: number; horizontal: number; total: number };
  residualRms: number;
}

interface Channel {
  state: 'acquiring' | 'tracking' | 'ready';
  startedAt: number;
  lockAt: number;
  readyAt: number;
  needsEphemeris: boolean;
  /** Navigation data must be demodulated before the satellite is usable. */
  needsTimeTag: boolean;
}

interface SatelliteErrorState {
  orbitClock: GaussMarkov;
  multipath: GaussMarkov;
  multipathEnv: EnvironmentId;
  ionoPhase: number;
}

export class GnssReceiver {
  readonly frontEnd: FrontEnd = SMARTPHONE_FRONT_END;
  config: ReceiverConfig = {
    assistance: 'assisted',
    environment: 'open',
    elevationMaskDeg: 10,
    systems: { GPS: true, GAL: true, GLO: true, BDS: true },
    maxSatellites: 0,
    selection: 'strongest',
    clockMode: 'estimate',
    solutionSystem: null,
  };

  // Simulated truth
  position: Geodetic = { lat: 0, lon: 0, h: 0 };
  ecef: Vec3 = [0, 0, 0];
  basis: EnuBasis = enuBasis(0, 0);
  /** True receiver clock bias relative to GPS time (s). */
  clockBiasS = 0;
  /** True clock drift (s/s), from the oscillator frequency offset. */
  clockDriftS = 0;
  freezeClock = false;

  // Receiver state
  powered = false;
  powerOnAt = 0;
  firstFixAt: number | null = null;
  readonly excluded = new Set<string>();
  observations: Observation[] = [];
  used: Observation[] = [];
  fix: Fix | null = null;
  lastTime: number | null = null;
  interferenceDb = 0;

  private readonly channels = new Map<string, Channel>();
  private readonly ephemerisCollectedAt = new Map<string, number>();
  private readonly errorState = new Map<string, SatelliteErrorState>();
  private lastFix: Fix | null = null;
  private powerCycles = 0;

  constructor(position: Geodetic) {
    this.setPosition(position);
  }

  setPosition(position: Geodetic): void {
    this.position = { ...position };
    this.ecef = geodeticToEcef(position);
    this.basis = enuBasis(position.lat, position.lon);
    this.fix = null;
    this.lastFix = null;
  }

  powerOn(utc: Date): void {
    const t = gpsSeconds(utc);
    this.powered = true;
    this.powerCycles++;
    this.powerOnAt = t;
    this.firstFixAt = null;
    this.fix = null;
    this.channels.clear();
    if (!this.freezeClock) {
      // An oscillator that has been off starts with an arbitrary offset and frequency error.
      this.clockBiasS = (Math.random() * 1.6 - 0.8) * 1e-3;
      this.clockDriftS = gaussian() * 0.25e-6;
    }
  }

  powerOff(): void {
    this.powered = false;
    this.channels.clear();
    this.fix = null;
    this.used = [];
  }

  /** Time to first fix (s) for the current power cycle. */
  get ttff(): number | null {
    return this.firstFixAt === null ? null : this.firstFixAt - this.powerOnAt;
  }

  get environment() {
    return ENVIRONMENTS[this.config.environment];
  }

  update(utc: Date, satellites: Satellite[]): void {
    const t = gpsSeconds(utc);
    const dt = this.lastTime === null ? 0 : Math.max(0, t - this.lastTime);
    this.lastTime = t;
    this.advanceClock(dt);
    this.interferenceDb = interferenceRiseDb({ utc, receiver: this });

    const observations = this.observe(satellites, utc);
    if (this.powered) this.track(observations, t);
    else this.channels.clear();

    const candidates = observations.filter(
      (o) =>
        o.state === 'ready' &&
        o.healthy &&
        !o.masked &&
        !o.excluded &&
        (this.config.solutionSystem === null || o.sat.system.id === this.config.solutionSystem),
    );
    const chosen = this.config.maxSatellites > 0 ? this.selectSubset(candidates, this.config.maxSatellites) : candidates;
    for (const o of chosen) o.measurement = this.measure(o, t, dt);

    let pvtInput: PvtMeasurement[] = chosen.map((o) => ({
      id: o.sat.id,
      system: o.sat.system.id,
      satPosition: o.sat.position,
      satVelocity: o.sat.velocity,
      pseudorange: o.measurement!.corrected,
      sigma: o.measurement!.sigma,
    }));
    pvtInput = applyMeasurementThreats(pvtInput, { utc, receiver: this });

    this.observations = observations;
    this.used = chosen;
    this.fix = this.powered ? this.solve(pvtInput, t) : null;
    if (this.fix) for (const o of chosen) o.state = 'used';
  }

  private advanceClock(dt: number): void {
    if (this.freezeClock || dt === 0) return;
    this.clockBiasS += this.clockDriftS * dt;
    // Receivers keep their clock within ±0.5 ms of GNSS time by 1 ms steps.
    while (Math.abs(this.clockBiasS) > 0.5e-3) this.clockBiasS -= Math.sign(this.clockBiasS) * 1e-3;
  }

  private observe(satellites: Satellite[], utc: Date): Observation[] {
    const env = this.environment;
    const out: Observation[] = [];
    for (const sat of satellites) {
      if (!sat.valid || !this.config.systems[sat.system.id]) continue;
      const look = lookAngles(this.ecef, this.basis, sat.position);
      if (look.el <= 0) continue;
      const obstruction = env.assess(sat.id, look.az, look.el);
      const carrierHz = carrierFrequency(sat.system, sat.info.freqChannel);
      const link = linkBudget(
        sat.system,
        this.frontEnd,
        { elDeg: look.el, rangeM: look.range, satRadiusM: norm(sat.position), carrierHz },
        obstruction.received ? obstruction.lossDb : 0,
        this.interferenceDb,
      );
      if (!obstruction.received) link.cn0 = -Infinity;
      const rangeRate = dot(sat.velocity, look.los);
      const o: Observation = {
        sat,
        az: look.az,
        el: look.el,
        range: look.range,
        rangeRate,
        carrierHz,
        dopplerHz: (-rangeRate * carrierHz) / SPEED_OF_LIGHT,
        link,
        obstruction,
        masked: look.el < this.config.elevationMaskDeg,
        excluded: this.excluded.has(sat.id),
        healthy: isUsable(sat.info),
        state: 'searching',
        progress: 0,
        hasEphemeris: false,
      };
      applyObservationThreats(o, { utc, receiver: this });
      out.push(o);
    }
    return out;
  }

  private navTiming(o: Observation): NavMessageTiming {
    // BeiDou GEO satellites broadcast the D2 message: 500 bit/s, 0.6 s subframes, ephemeris over 30 s.
    if (o.sat.system.id === 'BDS' && o.sat.info.orbit === 'GEO') {
      return { name: 'D2', bitRate: 500, timeTagPeriodS: 0.6, ephemerisPeriodS: 30, ephemerisSpanS: 30 };
    }
    return o.sat.system.signal.nav;
  }

  private hasValidEphemeris(id: string, t: number): boolean {
    const at = this.ephemerisCollectedAt.get(id);
    return at !== undefined && t - at < EPHEMERIS_VALIDITY_S;
  }

  private track(observations: Observation[], t: number): void {
    const visible = new Set(observations.map((o) => o.sat.id));
    for (const id of this.channels.keys()) if (!visible.has(id)) this.channels.delete(id);

    const assisted = this.config.assistance === 'assisted';
    const positionKnown = assisted || this.lastFix !== null;
    const acqThreshold = assisted ? ACQUISITION_THRESHOLD.assisted : ACQUISITION_THRESHOLD.standalone;

    for (const o of observations) {
      const id = o.sat.id;
      o.hasEphemeris = assisted || this.hasValidEphemeris(id, t);
      let ch = this.channels.get(id);
      if (ch && o.link.cn0 < TRACKING_THRESHOLD) {
        this.channels.delete(id);
        ch = undefined;
      }
      if (!ch) {
        if (o.link.cn0 < acqThreshold || this.channels.size >= MAX_CHANNELS) continue;
        // Search time: with a known position and time the receiver predicts code phase and
        // Doppler and finds a signal in about a second; a cold receiver must search blindly.
        const r = (hashString(`${id}:${this.powerCycles}`) % 1000) / 1000;
        const weak = Math.max(0, 45 - o.link.cn0);
        const searchTime = positionKnown ? 0.4 + 0.06 * weak + 0.8 * r : 3 + 0.2 * weak + 9 * r;
        ch = {
          state: 'acquiring',
          startedAt: t,
          lockAt: t + searchTime,
          readyAt: Infinity,
          needsEphemeris: !o.hasEphemeris,
          needsTimeTag: !assisted,
        };
        this.channels.set(id, ch);
      }
      if (ch.state === 'acquiring' && t >= ch.lockAt) {
        const nav = this.navTiming(o);
        ch.needsEphemeris = !o.hasEphemeris;
        ch.needsTimeTag = !assisted;
        if (assisted) {
          // Assistance supplies ephemerides and time accurate enough to resolve the code
          // ambiguity, so no navigation data has to be decoded (only the loops settle).
          ch.readyAt = ch.lockAt + 0.5;
        } else {
          // Bit and frame synchronisation, then a time tag; without a stored ephemeris the
          // receiver must also collect the full ephemeris, which starts at the next frame.
          const synced = ch.lockAt + 1;
          ch.readyAt = ch.needsEphemeris
            ? nextBoundary(synced, nav.ephemerisPeriodS) + nav.ephemerisSpanS
            : nextBoundary(synced, nav.timeTagPeriodS) + Math.min(1, nav.timeTagPeriodS);
        }
        ch.state = 'tracking';
      }
      if (ch.state === 'tracking' && t >= ch.readyAt) {
        if (ch.needsTimeTag && o.link.cn0 < DATA_DEMODULATION_THRESHOLD) {
          // Too weak to read the data: wait for the next repetition.
          ch.readyAt += ch.needsEphemeris ? this.navTiming(o).ephemerisPeriodS : this.navTiming(o).timeTagPeriodS;
        } else {
          ch.state = 'ready';
          if (!this.hasValidEphemeris(id, t)) this.ephemerisCollectedAt.set(id, t);
        }
      }
      o.state = ch.state === 'acquiring' ? 'acquiring' : ch.state === 'tracking' ? 'tracking' : 'ready';
      o.hasEphemeris = o.hasEphemeris || this.hasValidEphemeris(id, t);
      o.progress =
        ch.state === 'acquiring'
          ? (t - ch.startedAt) / Math.max(1e-6, ch.lockAt - ch.startedAt)
          : ch.state === 'tracking'
            ? (t - ch.lockAt) / Math.max(1e-6, ch.readyAt - ch.lockAt)
            : 1;
      o.progress = Math.max(0, Math.min(1, o.progress));
    }
  }

  private errorStateFor(o: Observation): SatelliteErrorState {
    const env = this.config.environment;
    let s = this.errorState.get(o.sat.id);
    if (!s || s.multipathEnv !== env) {
      s = {
        orbitClock: s?.orbitClock ?? new GaussMarkov(o.sat.system.sisreM, 3600),
        multipath: new GaussMarkov(1, this.environment.multipathTau),
        multipathEnv: env,
        ionoPhase: (hashString(o.sat.id) % 6283) / 1000,
      };
      this.errorState.set(o.sat.id, s);
    }
    return s;
  }

  private measure(o: Observation, t: number, dt: number): Measurement {
    const sat = o.sat;
    const state = this.errorStateFor(o);
    const path = signalPath(sat.position, sat.velocity, this.ecef);
    const tow = t % 604_800;

    const smoothIono = klobucharDelay(IONOSPHERE_TRUTH, this.position.lat, this.position.lon, o.el, o.az, tow);
    const irregularity = 1 + IONO_IRREGULARITY * Math.sin(o.az * 0.05 + o.el * 0.09 + state.ionoPhase);
    const ionosphere = ionoDelayMeters(smoothIono * irregularity, o.carrierHz);
    const ionosphereModel =
      sat.system.id === 'GAL'
        ? ionosphere * sat.system.ionoCorrectionEfficiency
        : ionoDelayMeters(smoothIono * BROADCAST_IONO_SCALE, o.carrierHz);

    const mapping = tropoMapping(o.el);
    const trueMeteo: Meteo = { ...TRUE_METEO_RELATIVE, pressure: standardAtmosphere(this.position.h).pressure };
    const truthZenith = saastamoinenZenith(this.position.lat, this.position.h, trueMeteo);
    const modelZenith = saastamoinenZenith(this.position.lat, this.position.h, standardAtmosphere(this.position.h));
    const troposphere = (truthZenith.zhd + truthZenith.zwd) * mapping;
    const troposphereModel = (modelZenith.zhd + modelZenith.zwd) * mapping;

    const noiseSigma = codeTrackingNoiseMeters(sat.system, this.frontEnd, o.link.cn0);
    const multipathSigma = this.environment.multipathSigma(o.el);
    const errors: RangeErrors = {
      receiverClock: SPEED_OF_LIGHT * this.clockBiasS,
      interSystemBias:
        SPEED_OF_LIGHT *
        (INTER_SYSTEM_BIAS_S[sat.system.id] + (sat.system.id === 'GLO' ? GLONASS_IFB_PER_CHANNEL_S * sat.info.freqChannel : 0)),
      satelliteOrbitClock: state.orbitClock.step(dt),
      ionosphere,
      ionosphereModel,
      troposphere,
      troposphereModel,
      multipath: state.multipath.step(dt) * multipathSigma + o.obstruction.excessPathM,
      noise: gaussian() * noiseSigma,
    };
    const pseudorange =
      path.range +
      errors.receiverClock +
      errors.interSystemBias +
      errors.satelliteOrbitClock +
      errors.ionosphere +
      errors.troposphere +
      errors.multipath +
      errors.noise;
    const corrected = pseudorange - ionosphereModel - troposphereModel;
    const sigma = Math.hypot(
      noiseSigma,
      sat.system.sisreM,
      0.4 * ionosphereModel,
      0.05 * troposphereModel,
      multipathSigma,
      o.obstruction.blocked ? 20 : 0,
    );
    return {
      pseudorange,
      corrected,
      travelTime: path.travelTime,
      sagnacM: path.sagnacM,
      errors,
      sigma,
    };
  }

  private solve(meas: PvtMeasurement[], t: number): Fix | null {
    if (meas.length === 0) return null;
    const systems = new Set(meas.map((m) => m.system)).size;
    const assumePerfect = this.config.clockMode === 'assume-perfect';
    let solution = null;
    if (assumePerfect) {
      solution = solvePvt(meas, { clock: 'fixed', fixedClockBiasM: 0 });
    } else if (meas.length >= requiredMeasurements(systems, { clock: 'estimate' })) {
      solution = solvePvt(meas, { clock: 'estimate' });
    } else {
      // One measurement short: hold the altitude from the last fix (or the assistance data).
      const prior = this.lastFix?.position ?? (this.config.assistance === 'assisted' ? this.coarsePosition() : null);
      if (prior) {
        const heightM = ecefToGeodetic(prior).h;
        solution = solvePvt(meas, {
          clock: 'estimate',
          altitudeAiding: { heightM, sigmaM: 30 },
          initialPosition: prior,
        });
      }
    }
    if (!solution || !solution.converged) return null;

    const d = sub(solution.position, this.ecef);
    const e = dot(d, this.basis.e);
    const n = dot(d, this.basis.n);
    const u = dot(d, this.basis.u);
    const reference = solution.clockBiasM.GPS ?? solution.clockBiasM[solution.referenceSystem] ?? 0;
    const isb: Partial<Record<SystemId, number>> = {};
    for (const [s, b] of Object.entries(solution.clockBiasM) as [SystemId, number][]) {
      if (s !== 'GPS' && solution.clockBiasM.GPS !== undefined) isb[s] = (b - reference) / SPEED_OF_LIGHT;
    }
    const residuals = [...solution.residuals.values()];
    const residualRms = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / Math.max(1, residuals.length));
    for (const o of this.used) {
      if (o.measurement) o.measurement.residual = solution.residuals.get(o.sat.id);
    }
    const uere = Math.sqrt(meas.reduce((a, m) => a + m.sigma * m.sigma, 0) / meas.length);
    const fix: Fix = {
      type: solution.fixType,
      position: solution.position,
      geodetic: solution.geodetic,
      dop: solution.dop,
      satellitesUsed: meas.length,
      systemsUsed: [...new Set(meas.map((m) => m.system))],
      clockBiasS: reference / SPEED_OF_LIGHT,
      interSystemBiasS: isb,
      accuracyH95: solution.dop ? 2 * solution.dop.hdop * uere : null,
      error: { e, n, u, horizontal: Math.hypot(e, n), total: Math.hypot(e, n, u) },
      residualRms,
    };
    if (fix.type !== 'clock-assumed') {
      if (this.firstFixAt === null) this.firstFixAt = t;
      this.lastFix = fix;
    }
    return fix;
  }

  /** Approximate position delivered with assistance data (network cell location, ~1 km). */
  private coarsePosition(): Vec3 {
    return geodeticToEcef({ lat: this.position.lat + 0.006, lon: this.position.lon - 0.005, h: this.position.h + 40 });
  }

  private selectSubset(list: Observation[], n: number): Observation[] {
    if (list.length <= n) return list;
    if (this.config.selection === 'strongest') return [...list].sort((a, b) => b.link.cn0 - a.link.cn0).slice(0, n);
    if (this.config.selection === 'clustered') {
      const seed = [...list].sort((a, b) => b.el - a.el)[0]!;
      return [...list].sort((a, b) => skySeparation(a, seed) - skySeparation(b, seed)).slice(0, n);
    }
    // Spread: start mid-sky, then repeatedly add the satellite farthest from those already chosen.
    const pool = [...list].sort((a, b) => Math.abs(a.el - 45) - Math.abs(b.el - 45));
    const picked = [pool.shift()!];
    while (picked.length < n && pool.length > 0) {
      let best = 0;
      let bestSeparation = -1;
      pool.forEach((o, i) => {
        const sep = Math.min(...picked.map((p) => skySeparation(o, p)));
        if (sep > bestSeparation) {
          bestSeparation = sep;
          best = i;
        }
      });
      picked.push(pool.splice(best, 1)[0]!);
    }
    return picked;
  }
}
