import type { App, Scenario } from '../../app/App';
import { SPEED_OF_LIGHT } from '../../gnss/constants';
import { ACQUISITION_THRESHOLD } from '../../gnss/receiver';
import { inBandNoisePowerDbw } from '../../gnss/signal';
import { SYSTEM_IDS, SYSTEMS } from '../../gnss/systems';
import { distance, interval, num } from '../format';

export type ChapterControl = 'power' | 'assistance' | 'clock' | 'satellites' | 'geometry' | 'environment';

export interface ReadoutRow {
  label: string;
  value: string;
  color?: string;
}

export interface Chapter {
  id: string;
  title: string;
  /** Paragraph HTML (only <b>, <i>, <sub> markup). */
  body: string[];
  controls?: ChapterControl[];
  scenario: Partial<Scenario>;
  readout?(app: App): ReadoutRow[];
}

const usedObservations = (app: App) => app.receiver.used;

function positionRows(app: App): ReadoutRow[] {
  const fix = app.receiver.fix;
  if (!fix) return [{ label: 'Computed position', value: 'none' }];
  return [
    { label: 'Satellites in solution', value: String(fix.satellitesUsed) },
    { label: 'Position error (true)', value: distance(fix.error.total) },
  ];
}

function rangeRows(app: App): ReadoutRow[] {
  const used = usedObservations(app);
  if (used.length === 0) return [{ label: 'Status', value: 'waiting for a usable satellite' }];
  return used.map((o) => ({
    label: `${o.sat.label}  ${num(o.el, 0)}° elevation`,
    value: `${interval(o.measurement!.travelTime)}  ·  ${distance(o.range)}`,
    color: o.sat.system.color,
  }));
}

const meoAltitudeKm = (app: App, id: (typeof SYSTEM_IDS)[number]): number => {
  const meo = app.satellites.filter((s) => s.system.id === id && s.info.orbit === 'MEO' && s.info.status === 'healthy' && s.valid);
  if (meo.length === 0) return NaN;
  return meo.reduce((a, s) => a + Math.hypot(...s.position), 0) / meo.length / 1000 - 6371;
};

const meoPeriod = (app: App, id: (typeof SYSTEM_IDS)[number]): string => {
  const meo = app.satellites.filter((s) => s.system.id === id && s.info.orbit === 'MEO' && s.info.status === 'healthy');
  if (meo.length === 0) return '—';
  const minutes = meo.reduce((a, s) => a + s.periodMinutes, 0) / meo.length;
  return `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, '0')} min`;
};

const GPS_ONLY = { GPS: true, GAL: false, GLO: false, BDS: false };

const SINGLE_SYSTEM_GEOMETRY: Partial<Scenario> = {
  powered: true,
  systems: GPS_ONLY,
  solutionSystem: 'GPS',
  selection: 'spread',
  clockMode: 'assume-perfect',
  clockErrorS: 0,
  onlyUsedSignals: true,
};

export const CHAPTERS: Chapter[] = [
  {
    id: 'overview',
    title: 'Positioning, navigation and timing from space',
    body: [
      'Global navigation satellite systems (GNSS) broadcast precisely timed radio signals from orbit. A receiver that hears four or more of them can determine its position anywhere on Earth, in any weather, and recover time to within tens of nanoseconds.',
      'Four global systems are operational: <b>GPS</b> (United States), <b>Galileo</b> (European Union), <b>GLONASS</b> (Russia) and <b>BeiDou</b> (China). Together they provide positioning, navigation and timing (<b>PNT</b>) to billions of devices, and the time reference for telecommunications networks, power grids and financial systems.',
      'Each satellite shown is at its actual position, propagated from today’s published orbital elements. Drag to rotate the globe; scroll to zoom.',
    ],
    scenario: { rate: 60, camera: 'overview' },
    readout: (app) =>
      SYSTEM_IDS.map((id) => {
        const all = app.satellites.filter((s) => s.system.id === id);
        const healthy = all.filter((s) => s.info.status === 'healthy').length;
        return { label: `${SYSTEMS[id].name} · ${SYSTEMS[id].operator}`, value: `${healthy} healthy / ${all.length} tracked`, color: SYSTEMS[id].color };
      }),
  },
  {
    id: 'space-segment',
    title: 'The space segment',
    body: [
      'GPS, Galileo, GLONASS and most BeiDou satellites fly in <b>medium Earth orbit</b>, 19,100 to 23,200 km up, and circle the Earth roughly twice a day. Their orbits lie in several inclined planes (six for GPS, three for the others) so that at least four satellites are in view from anywhere on Earth at any time.',
      'BeiDou also operates <b>geostationary</b> satellites, which stay fixed in the sky (from Riyadh, those at 80° E and 110.5° E are always in view), and <b>inclined geosynchronous</b> satellites that trace figure-of-eight paths over Asia.',
      'Every satellite carries atomic frequency standards (rubidium, caesium, or passive hydrogen masers on Galileo) and continuously transmits a ranging code together with a <b>navigation message</b>: its own orbit (ephemeris), the offset of its clock, and the time of transmission. Ground control segments monitor the satellites and upload these parameters.',
    ],
    scenario: { rate: 600, camera: 'overview' },
    readout: (app) =>
      SYSTEM_IDS.map((id) => ({
        label: `${SYSTEMS[id].name} medium Earth orbit`,
        value: `${num(meoAltitudeKm(app, id))} km · ${meoPeriod(app, id)}`,
        color: SYSTEMS[id].color,
      })),
  },
  {
    id: 'acquisition',
    title: 'Signal acquisition',
    body: [
      'A GNSS receiver is passive: it only listens. To find a satellite it generates a replica of that satellite’s ranging code and searches for the code delay and the Doppler shift (up to about ±5 kHz from the satellite’s motion) at which the replica matches the incoming signal.',
      'A receiver on its own must then read part of the navigation message before it can use the satellite: a time stamp and, if it has none stored, the ephemeris. GPS repeats its ephemeris every 30 seconds, so a standalone cold start typically takes 30 to 60 seconds.',
      'Phones avoid that wait with <b>assistance data</b> (A-GNSS) from the mobile network: ephemerides, accurate time and an approximate position. The receiver knows where to search and can use each satellite as soon as it locks on. <b>Switch on location on the phone</b> to watch it acquire satellites, then compare a standalone start.',
    ],
    controls: ['power', 'assistance'],
    scenario: { powered: false, camera: 'sky', phoneTab: 'status' },
    readout: (app) => {
      const rx = app.receiver;
      if (!rx.powered) return [{ label: 'Receiver', value: 'off' }];
      const count = (s: string) => rx.observations.filter((o) => o.state === s).length;
      return [
        { label: 'Searching / acquiring', value: `${count('searching')} / ${count('acquiring')}` },
        { label: 'Reading navigation data', value: String(count('tracking')) },
        { label: 'Usable / used', value: `${count('ready') + count('used')} / ${count('used')}` },
        {
          label: 'Acquisition threshold',
          value: `${rx.config.assistance === 'assisted' ? ACQUISITION_THRESHOLD.assisted : ACQUISITION_THRESHOLD.standalone} dB-Hz`,
        },
        { label: 'Time to first fix', value: rx.ttff === null ? 'no fix yet' : `${num(rx.ttff, 1)} s` },
      ];
    },
  },
  {
    id: 'ranging',
    title: 'Ranging by time of flight',
    body: [
      'Each signal carries the time at which it left the satellite. The receiver measures when it arrived; the difference multiplied by the speed of light, 299,792,458 m/s, is the distance to the satellite. From medium Earth orbit the signal travels for 64 to 97 milliseconds.',
      'The timing must be extremely precise: <b>one microsecond of error is 300 metres</b> of distance, and one nanosecond is 30 centimetres.',
      'A single distance places the receiver somewhere on a sphere centred on the satellite. Where that sphere meets the Earth’s surface it traces a circle: the receiver is somewhere on that line.',
    ],
    scenario: { ...SINGLE_SYSTEM_GEOMETRY, maxSatellites: 1, display: { spheres: true, circles: true }, camera: 'spheres' },
    readout: (app) => {
      const o = usedObservations(app)[0];
      if (!o?.measurement) return [{ label: 'Status', value: 'waiting for a usable satellite' }];
      return [
        { label: 'Satellite', value: `${o.sat.label} (${o.sat.info.block || o.sat.system.name})`, color: o.sat.system.color },
        { label: 'Signal travel time', value: interval(o.measurement.travelTime) },
        { label: '× speed of light', value: distance(o.measurement.travelTime * SPEED_OF_LIGHT) },
        { label: '1 µs timing error', value: distance(1e-6 * SPEED_OF_LIGHT) },
      ];
    },
  },
  {
    id: 'two-ranges',
    title: 'Two ranges',
    body: [
      'A second satellite adds a second sphere. The receiver must lie on both, so on the ground it is at one of the two points where the circles cross.',
    ],
    scenario: { ...SINGLE_SYSTEM_GEOMETRY, maxSatellites: 2, display: { orbits: false, spheres: true, circles: true }, camera: 'sky' },
    readout: rangeRows,
  },
  {
    id: 'three-ranges',
    title: 'Three ranges',
    body: [
      'Three spheres intersect at two points. One of them lies far out in space and is discarded, leaving the receiver’s position.',
      'This works only if every distance is correct, which requires the receiver to know the exact time of arrival. Here the phone’s clock is assumed to be perfect: the three circles meet at the receiver.',
    ],
    scenario: { ...SINGLE_SYSTEM_GEOMETRY, maxSatellites: 3, display: { orbits: false, circles: true }, camera: 'region' },
    readout: (app) => [...rangeRows(app), ...positionRows(app)],
  },
  {
    id: 'receiver-clock',
    title: 'The receiver clock problem',
    body: [
      'The satellites’ atomic clocks are kept within nanoseconds of system time. A phone’s quartz oscillator is not: after power-on its clock can easily be wrong by a fraction of a millisecond, and it drifts.',
      'Because distance is computed from time, a receiver clock error adds the same amount to every measurement: <b>1 millisecond is 300 km</b>. Move the slider and watch the circles separate and the computed position move away from the receiver.',
    ],
    controls: ['clock'],
    scenario: { ...SINGLE_SYSTEM_GEOMETRY, maxSatellites: 3, clockErrorS: 400e-6, display: { orbits: false, circles: true }, camera: 'sky' },
    readout: (app) => [
      { label: 'Receiver clock error', value: interval(app.receiver.clockBiasS) },
      { label: 'Added to every range', value: distance(app.receiver.clockBiasS * SPEED_OF_LIGHT) },
      ...positionRows(app),
    ],
  },
  {
    id: 'four-measurements',
    title: 'Four measurements: position and time',
    body: [
      'The solution is to treat the receiver clock error as a <b>fourth unknown</b> alongside the three coordinates. Four measurements, from four satellites, determine all four. The measured distances are called <b>pseudoranges</b> because each contains this common clock error.',
      'The clock slider no longer moves the position: the receiver solves for the error instead. As a by-product it now knows GPS time to within tens of nanoseconds. This is the <b>T in PNT</b>, and the reason GNSS is the primary time source for mobile networks, power grids and financial time-stamping.',
    ],
    controls: ['clock', 'satellites'],
    scenario: {
      ...SINGLE_SYSTEM_GEOMETRY,
      clockMode: 'estimate',
      maxSatellites: 4,
      clockErrorS: 400e-6,
      display: { orbits: false, circles: true },
      camera: 'sky',
    },
    readout: (app) => {
      const fix = app.receiver.fix;
      return [
        { label: 'True receiver clock error', value: interval(app.receiver.clockBiasS) },
        { label: 'Clock error solved by receiver', value: fix && fix.type !== 'clock-assumed' ? interval(fix.clockBiasS) : '—' },
        ...positionRows(app),
      ];
    },
  },
  {
    id: 'multi-gnss',
    title: 'Combining constellations',
    body: [
      'Each constellation keeps its own system time (GPST, GST, GLONASST, BDT), and a receiver has slightly different internal delays for each signal. A multi-constellation receiver therefore solves one additional clock offset for every extra constellation: with GPS and Galileo together it needs at least five satellites.',
      'The return is far more satellites: from Riyadh, the four constellations together offer three to four times as many usable satellites as GPS alone. That strengthens the geometry and keeps a fix in obstructed places where a single constellation would fail.',
    ],
    scenario: { powered: true, camera: 'sky', phoneTab: 'sky' },
    readout: (app) => {
      const fix = app.receiver.fix;
      const mask = app.receiver.config.elevationMaskDeg;
      const usable = app.receiver.observations.filter((o) => o.healthy && o.el >= mask);
      const rows: ReadoutRow[] = SYSTEM_IDS.map((id) => ({
        label: `${SYSTEMS[id].name} used / healthy above ${mask}°`,
        value: `${app.receiver.used.filter((o) => o.sat.system.id === id).length} / ${usable.filter((o) => o.sat.system.id === id).length}`,
        color: SYSTEMS[id].color,
      }));
      if (fix) {
        rows.push({ label: 'Unknowns solved', value: String(3 + fix.systemsUsed.length) });
        for (const [id, isb] of Object.entries(fix.interSystemBiasS)) {
          rows.push({ label: `${SYSTEMS[id as keyof typeof SYSTEMS].name} − GPS clock offset`, value: interval(isb) });
        }
        if (fix.dop) rows.push({ label: 'PDOP', value: num(fix.dop.pdop, 2) });
      }
      return rows;
    },
  },
  {
    id: 'geometry',
    title: 'Satellite geometry',
    body: [
      'Every pseudorange carries an error of a metre or more. How much that error affects the position depends on where the satellites are in the sky. Satellites bunched together intersect at shallow angles and give a poorly defined position; satellites spread across the sky give a sharp one.',
      'The amplification is expressed as <b>dilution of precision</b> (DOP): position error ≈ DOP × range error. A PDOP below 2 is excellent; above about 5 the position degrades noticeably.',
    ],
    controls: ['geometry'],
    scenario: {
      powered: true,
      systems: GPS_ONLY,
      solutionSystem: 'GPS',
      maxSatellites: 4,
      selection: 'clustered',
      camera: 'sky',
      phoneTab: 'sky',
      onlyUsedSignals: true,
    },
    readout: (app) => {
      const fix = app.receiver.fix;
      if (!fix?.dop) return [{ label: 'Status', value: 'waiting for a fix' }];
      return [
        { label: 'Satellites in solution', value: String(fix.satellitesUsed) },
        { label: 'PDOP / HDOP / VDOP', value: `${num(fix.dop.pdop, 1)} / ${num(fix.dop.hdop, 1)} / ${num(fix.dop.vdop, 1)}` },
        { label: 'Horizontal error (true)', value: distance(fix.error.horizontal) },
        { label: 'Vertical error (true)', value: distance(Math.abs(fix.error.u)) },
      ];
    },
  },
  {
    id: 'error-budget',
    title: 'Error sources',
    body: [
      'A pseudorange is not a perfect distance. The satellite’s broadcast orbit and clock are slightly wrong; the signal is delayed by the <b>ionosphere</b> (charged particles 60 to 1,000 km up, the largest error, worst near solar maximum) and the <b>troposphere</b>; it reflects off nearby surfaces (<b>multipath</b>); and the receiver adds tracking noise.',
      'Receivers remove most of the atmospheric delay with models broadcast in the navigation message. The table shows the average size of each error over the satellites in the solution, before and after those corrections.',
    ],
    scenario: { powered: true, camera: 'region' },
    readout: (app) => {
      const used = app.receiver.used.filter((o) => o.measurement);
      if (used.length === 0) return [{ label: 'Status', value: 'waiting for measurements' }];
      const rms = (f: (o: (typeof used)[number]) => number) =>
        Math.sqrt(used.reduce((a, o) => a + f(o) ** 2, 0) / used.length);
      const e = (o: (typeof used)[number]) => o.measurement!.errors;
      return [
        { label: 'Satellite orbit and clock', value: `${num(rms((o) => e(o).satelliteOrbitClock), 2)} m` },
        { label: 'Ionosphere: raw → after model', value: `${num(rms((o) => e(o).ionosphere), 1)} → ${num(rms((o) => e(o).ionosphere - e(o).ionosphereModel), 1)} m` },
        { label: 'Troposphere: raw → after model', value: `${num(rms((o) => e(o).troposphere), 2)} → ${num(rms((o) => e(o).troposphere - e(o).troposphereModel), 2)} m` },
        { label: 'Multipath', value: `${num(rms((o) => e(o).multipath), 2)} m` },
        { label: 'Receiver noise', value: `${num(rms((o) => e(o).noise), 2)} m` },
        ...positionRows(app),
      ];
    },
  },
  {
    id: 'environment',
    title: 'Signal strength and the environment',
    body: [
      'GNSS signals are extremely weak. The specified minimum for GPS L1 C/A at the Earth’s surface is −128.5 dBm, about 10<sup>−16</sup> W, and a phone’s small antenna loses several decibels more. That is <b>below the thermal noise</b> in the receiver’s bandwidth; the signal is recovered only because the receiver knows the code and integrates it.',
      'In an <b>urban canyon</b> buildings block much of the sky; some satellites are received only by reflection, with a longer path and a positive range error. <b>Indoors</b> every signal is attenuated by the structure, fewer satellites are tracked and errors grow.',
    ],
    controls: ['environment'],
    scenario: { powered: true, camera: 'region', phoneTab: 'sky' },
    readout: (app) => {
      const rx = app.receiver;
      const tracked = rx.observations.filter((o) => o.state !== 'searching' && Number.isFinite(o.link.cn0));
      const noise = inBandNoisePowerDbw(rx.frontEnd, rx.interferenceDb) + 30;
      if (tracked.length === 0) return [{ label: 'Signals tracked', value: 'none' }];
      const best = tracked.reduce((a, b) => (b.link.receivedPowerDbw > a.link.receivedPowerDbw ? b : a));
      const bestDbm = best.link.receivedPowerDbw + 30;
      return [
        { label: 'Strongest signal at receiver', value: `${num(bestDbm, 1)} dBm (${best.sat.label})` },
        { label: 'Thermal noise in 2 MHz', value: `${num(noise, 1)} dBm` },
        { label: 'Signal relative to noise', value: `${num(bestDbm - noise, 1)} dB` },
        { label: 'C/N₀ range tracked', value: `${num(Math.min(...tracked.map((o) => o.link.cn0)), 0)} – ${num(Math.max(...tracked.map((o) => o.link.cn0)), 0)} dB-Hz` },
        ...positionRows(app),
      ];
    },
  },
  {
    id: 'vulnerabilities',
    title: 'Vulnerabilities',
    body: [
      'Because the signals arrive below the noise floor, a low-power transmitter nearby can raise the noise enough to stop a receiver tracking them (<b>jamming</b>), or broadcast counterfeit signals that lead it to a false position or time (<b>spoofing</b>). Both are now encountered routinely, particularly near conflict zones and by aviation and shipping.',
      'The next module simulates both. Until then, the full simulator is available under <b>Controls</b>: change the location, constellations, environment and display, or select any satellite to inspect it or exclude it from the solution.',
    ],
    scenario: { powered: true, camera: 'sky' },
    readout: positionRows,
  },
];
