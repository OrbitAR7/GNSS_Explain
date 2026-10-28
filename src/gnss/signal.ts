import { DEG, SPEED_OF_LIGHT, THERMAL_NOISE_DBW_HZ } from './constants';
import type { GnssSystem } from './systems';

const MEAN_EARTH_RADIUS = 6_371_000;

/** Radio front end and tracking-loop parameters of the simulated receiver. */
export interface FrontEnd {
  /** Low-noise amplifier / front-end noise figure (dB). */
  noiseFigureDb: number;
  /** Quantisation, filtering and correlation losses (dB). */
  implementationLossDb: number;
  /** Antenna gain toward zenith, including polarisation mismatch (dBic). */
  antennaZenithGainDbic: number;
  /** Antenna gain toward the horizon, including polarisation mismatch (dBic). */
  antennaHorizonGainDbic: number;
  /** Code tracking loop noise bandwidth (Hz). */
  dllBandwidthHz: number;
  /** Early-late correlator spacing (chips). */
  correlatorSpacingChips: number;
  /** Coherent integration time (s). */
  coherentIntegrationS: number;
  /** Front-end bandwidth used for the in-band noise power figure (Hz). */
  noiseBandwidthHz: number;
}

/** A smartphone-class front end: small linearly polarised antenna, low-cost LNA. */
export const SMARTPHONE_FRONT_END: FrontEnd = {
  noiseFigureDb: 2.5,
  implementationLossDb: 1.5,
  antennaZenithGainDbic: -5,
  antennaHorizonGainDbic: -11,
  dllBandwidthHz: 2,
  correlatorSpacingChips: 1,
  coherentIntegrationS: 0.02,
  noiseBandwidthHz: 2.046e6,
};

export interface LinkBudget {
  /** Free-space path loss (dB). */
  fsplDb: number;
  /** Power that would be received by a 0 dBic antenna (dBW). */
  isotropicPowerDbw: number;
  antennaGainDbic: number;
  /** Additional obstruction / building loss (dB). */
  obstructionLossDb: number;
  /** Signal power at the receiver input (dBW). */
  receivedPowerDbw: number;
  /** Effective noise density including noise figure, implementation loss and interference (dBW/Hz). */
  noiseDensityDbw: number;
  /** Carrier-to-noise density ratio (dB-Hz). */
  cn0: number;
}

export function freeSpacePathLossDb(rangeM: number, carrierHz: number): number {
  return 20 * Math.log10((4 * Math.PI * rangeM * carrierHz) / SPEED_OF_LIGHT);
}

function slantRange(elDeg: number, satRadius: number): number {
  const s = Math.sin(elDeg * DEG);
  const c = Math.cos(elDeg * DEG);
  return Math.sqrt(satRadius ** 2 - (MEAN_EARTH_RADIUS * c) ** 2) - MEAN_EARTH_RADIUS * s;
}

/**
 * Received power for a 0 dBic antenna. The interface specifications guarantee a
 * minimum power for users above 5° elevation; actual signals are typically a few dB
 * stronger. Satellite antennas are shaped (more gain toward the Earth's limb) so that
 * received power varies only a few dB with elevation; this is modelled by anchoring
 * the budget at 5° and applying the path-length change plus a limb-to-nadir gain taper.
 */
export function isotropicReceivedPowerDbw(
  system: GnssSystem,
  elDeg: number,
  rangeM: number,
  satRadiusM: number,
): number {
  const sig = system.signal;
  const pathGainDb = 20 * Math.log10(slantRange(5, satRadiusM) / rangeM);
  const limb = Math.asin(MEAN_EARTH_RADIUS / satRadiusM);
  const offNadir = Math.asin(Math.min(1, (MEAN_EARTH_RADIUS / satRadiusM) * Math.cos(elDeg * DEG)));
  const antennaTaperDb = -1.5 * (1 - offNadir / limb) ** 2;
  return sig.minReceivedPowerDbw + sig.typicalMarginDb + pathGainDb + antennaTaperDb;
}

export function receiverAntennaGainDbic(fe: FrontEnd, elDeg: number): number {
  const s = Math.sin(Math.max(elDeg, 0) * DEG);
  return fe.antennaHorizonGainDbic + (fe.antennaZenithGainDbic - fe.antennaHorizonGainDbic) * Math.sqrt(s);
}

export function noiseDensityDbw(fe: FrontEnd, interferenceRiseDb = 0): number {
  return THERMAL_NOISE_DBW_HZ + fe.noiseFigureDb + fe.implementationLossDb + interferenceRiseDb;
}

/** Total noise power in the front-end bandwidth (dBW). */
export function inBandNoisePowerDbw(fe: FrontEnd, interferenceRiseDb = 0): number {
  return (
    THERMAL_NOISE_DBW_HZ + fe.noiseFigureDb + interferenceRiseDb + 10 * Math.log10(fe.noiseBandwidthHz)
  );
}

export function linkBudget(
  system: GnssSystem,
  fe: FrontEnd,
  geometry: { elDeg: number; rangeM: number; satRadiusM: number; carrierHz: number },
  obstructionLossDb: number,
  interferenceRiseDb = 0,
): LinkBudget {
  const isotropicPowerDbw = isotropicReceivedPowerDbw(system, geometry.elDeg, geometry.rangeM, geometry.satRadiusM);
  const antennaGainDbic = receiverAntennaGainDbic(fe, geometry.elDeg);
  const receivedPowerDbw = isotropicPowerDbw + antennaGainDbic - obstructionLossDb;
  const n0 = noiseDensityDbw(fe, interferenceRiseDb);
  return {
    fsplDb: freeSpacePathLossDb(geometry.rangeM, geometry.carrierHz),
    isotropicPowerDbw,
    antennaGainDbic,
    obstructionLossDb,
    receivedPowerDbw,
    noiseDensityDbw: n0,
    cn0: receivedPowerDbw - n0,
  };
}

/**
 * Code-tracking thermal noise (1-sigma, metres) of a non-coherent early-minus-late
 * power delay-lock loop (Kaplan & Hegarty, Understanding GPS, eq. 8.38 form).
 */
export function codeTrackingNoiseMeters(system: GnssSystem, fe: FrontEnd, cn0DbHz: number): number {
  const c = 10 ** (cn0DbHz / 10);
  const d = fe.correlatorSpacingChips;
  const chips = Math.sqrt(
    ((fe.dllBandwidthHz * d) / (2 * c)) * (1 + 2 / (fe.coherentIntegrationS * c * (2 - d))),
  );
  const chipLength = SPEED_OF_LIGHT / system.signal.chipRate;
  return chips * chipLength * system.signal.trackingNoiseFactor;
}
