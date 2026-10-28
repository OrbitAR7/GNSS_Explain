// Constellation and open-signal parameters. Values are taken from the public
// interface specifications cited on each entry; "typical" values are labelled.

export type SystemId = 'GPS' | 'GAL' | 'GLO' | 'BDS';

export interface NavMessageTiming {
  /** Message name, e.g. LNAV. */
  name: string;
  /** Data rate (bit/s). */
  bitRate: number;
  /** Interval at which a time tag (time of week) can be read (s). */
  timeTagPeriodS: number;
  /** Repetition period of the ephemeris data (s). */
  ephemerisPeriodS: number;
  /** Time needed, from the start of a repetition period, to collect the full ephemeris (s). */
  ephemerisSpanS: number;
}

export interface OpenSignal {
  name: string;
  /** Carrier frequency (Hz). For GLONASS FDMA this is the channel-0 frequency. */
  carrierHz: number;
  /** GLONASS FDMA channel spacing (Hz). */
  channelSpacingHz?: number;
  /** Ranging-code chipping rate (chip/s). */
  chipRate: number;
  codeLength: number;
  modulation: string;
  /** Specified minimum received power at the user antenna (dBW). */
  minReceivedPowerDbw: number;
  /** Typical excess of actual received power above the specified minimum (dB). */
  typicalMarginDb: number;
  /** Code-tracking noise relative to a BPSK signal of the same chip rate. */
  trackingNoiseFactor: number;
  nav: NavMessageTiming;
  /** Interface specification that defines the signal. */
  reference: string;
}

export interface GnssSystem {
  id: SystemId;
  name: string;
  operator: string;
  /** RINEX system letter. */
  letter: 'G' | 'E' | 'R' | 'C';
  color: string;
  timeScale: string;
  signal: OpenSignal;
  /** Signal-in-space range error, 1-sigma (m). */
  sisreM: number;
  /** Broadcast ionospheric model the receiver applies. */
  ionoModel: string;
  /** Fraction of the ionospheric delay removed by that model (typical). */
  ionoCorrectionEfficiency: number;
  /** File name of the bundled element sets and CelesTrak group. */
  elementsFile: string;
  celestrakGroup: string;
}

export const SYSTEMS: Record<SystemId, GnssSystem> = {
  GPS: {
    id: 'GPS',
    name: 'GPS',
    operator: 'United States Space Force',
    letter: 'G',
    color: '#4da3ff',
    timeScale: 'GPST',
    signal: {
      name: 'L1 C/A',
      carrierHz: 1575.42e6,
      chipRate: 1.023e6,
      codeLength: 1023,
      modulation: 'BPSK(1)',
      minReceivedPowerDbw: -158.5,
      typicalMarginDb: 3,
      trackingNoiseFactor: 1,
      nav: { name: 'LNAV', bitRate: 50, timeTagPeriodS: 6, ephemerisPeriodS: 30, ephemerisSpanS: 18 },
      reference: 'IS-GPS-200',
    },
    sisreM: 0.6,
    ionoModel: 'Klobuchar',
    ionoCorrectionEfficiency: 0.5,
    elementsFile: 'gps',
    celestrakGroup: 'gps-ops',
  },
  GAL: {
    id: 'GAL',
    name: 'Galileo',
    operator: 'European Union (EUSPA / ESA)',
    letter: 'E',
    color: '#ff9f43',
    timeScale: 'GST',
    signal: {
      name: 'E1 OS',
      carrierHz: 1575.42e6,
      chipRate: 1.023e6,
      codeLength: 4092,
      modulation: 'CBOC(6,1,1/11)',
      minReceivedPowerDbw: -157.25,
      typicalMarginDb: 2,
      trackingNoiseFactor: 0.6,
      nav: { name: 'I/NAV', bitRate: 125, timeTagPeriodS: 2, ephemerisPeriodS: 30, ephemerisSpanS: 30 },
      reference: 'Galileo OS SIS ICD',
    },
    sisreM: 0.25,
    ionoModel: 'NeQuick-G',
    ionoCorrectionEfficiency: 0.7,
    elementsFile: 'galileo',
    celestrakGroup: 'galileo',
  },
  GLO: {
    id: 'GLO',
    name: 'GLONASS',
    operator: 'Roscosmos',
    letter: 'R',
    color: '#ff6b9d',
    timeScale: 'GLONASST',
    signal: {
      name: 'L1OF',
      carrierHz: 1602e6,
      channelSpacingHz: 0.5625e6,
      chipRate: 0.511e6,
      codeLength: 511,
      modulation: 'BPSK(0.5)',
      minReceivedPowerDbw: -161,
      typicalMarginDb: 3,
      trackingNoiseFactor: 1,
      nav: { name: 'GLONASS nav', bitRate: 50, timeTagPeriodS: 2, ephemerisPeriodS: 30, ephemerisSpanS: 8 },
      reference: 'GLONASS ICD L1/L2 FDMA',
    },
    sisreM: 1.5,
    ionoModel: 'Klobuchar (from GPS)',
    ionoCorrectionEfficiency: 0.5,
    elementsFile: 'glonass',
    celestrakGroup: 'glo-ops',
  },
  BDS: {
    id: 'BDS',
    name: 'BeiDou',
    operator: 'China Satellite Navigation Office',
    letter: 'C',
    color: '#34d399',
    timeScale: 'BDT',
    signal: {
      name: 'B1I',
      carrierHz: 1561.098e6,
      chipRate: 2.046e6,
      codeLength: 2046,
      modulation: 'BPSK(2)',
      minReceivedPowerDbw: -163,
      typicalMarginDb: 4,
      trackingNoiseFactor: 1,
      nav: { name: 'D1', bitRate: 50, timeTagPeriodS: 6, ephemerisPeriodS: 30, ephemerisSpanS: 18 },
      reference: 'BDS-SIS-ICD-B1I',
    },
    sisreM: 0.6,
    ionoModel: 'Klobuchar (BDS)',
    ionoCorrectionEfficiency: 0.6,
    elementsFile: 'beidou',
    celestrakGroup: 'beidou',
  },
};

export const SYSTEM_IDS: SystemId[] = ['GPS', 'GAL', 'GLO', 'BDS'];

/** Carrier frequency (Hz) for a satellite, including the GLONASS FDMA channel offset. */
export function carrierFrequency(system: GnssSystem, freqChannel = 0): number {
  return system.signal.carrierHz + (system.signal.channelSpacingHz ?? 0) * freqChannel;
}
