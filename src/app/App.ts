import { lookupSatellite } from '../gnss/catalog';
import type { EnvironmentId } from '../gnss/environment';
import type { Geodetic } from '../gnss/geodesy';
import { GnssReceiver, type AssistanceMode, type ClockMode, type Selection } from '../gnss/receiver';
import { gstime, Satellite } from '../gnss/satellite';
import { SPEED_OF_LIGHT } from '../gnss/constants';
import { SYSTEM_IDS, SYSTEMS, type SystemId } from '../gnss/systems';
import { GlobeView, type CameraView, type DisplayOptions } from '../view/globe/GlobeView';
import { PhoneView, type PhoneTab } from '../view/phone/PhoneView';
import { loadElements, type Provenance } from './orbitData';
import { DEFAULT_PLACE, type Place } from './places';

/** Everything a briefing chapter (or the reset button) configures. */
export interface Scenario {
  systems: Record<SystemId, boolean>;
  rate: number;
  environment: EnvironmentId;
  assistance: AssistanceMode;
  elevationMaskDeg: number;
  maxSatellites: number;
  selection: Selection;
  solutionSystem: SystemId | null;
  clockMode: ClockMode;
  /** Fix the receiver clock error (s) instead of letting the oscillator drift. */
  clockErrorS: number | null;
  powered: boolean;
  display: Partial<DisplayOptions>;
  /** Draw signal lines only for satellites in the solution. */
  onlyUsedSignals: boolean;
  phoneTab: PhoneTab;
  camera: CameraView | null;
}

export const DEFAULT_SCENARIO: Scenario = {
  systems: { GPS: true, GAL: true, GLO: true, BDS: true },
  rate: 1,
  environment: 'open',
  assistance: 'assisted',
  elevationMaskDeg: 10,
  maxSatellites: 0,
  selection: 'strongest',
  solutionSystem: null,
  clockMode: 'estimate',
  clockErrorS: null,
  powered: false,
  display: { orbits: true, signals: true, labels: 'inView', spheres: false, circles: false },
  onlyUsedSignals: false,
  phoneTab: 'status',
  camera: null,
};

type Listener = () => void;

export class App {
  readonly globe: GlobeView;
  readonly receiver: GnssReceiver;
  readonly phone: PhoneView;
  satellites: Satellite[] = [];
  provenance: Partial<Record<SystemId, Provenance>> = {};
  place: Place = DEFAULT_PLACE;
  placeName = `${DEFAULT_PLACE.name}, ${DEFAULT_PLACE.region}`;
  selectedId: string | null = null;
  onlyUsedSignals = false;
  /** Wall-clock ms of the last display refresh. */
  private lastUpdate = 0;
  /** Simulation time (ms) of the last receiver update. */
  private lastReceiverTime: number | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(globeContainer: HTMLElement, phoneContainer: HTMLElement) {
    this.globe = new GlobeView(globeContainer);
    this.receiver = new GnssReceiver(this.place.position);
    this.phone = new PhoneView(
      phoneContainer,
      { onPower: (on) => this.setPower(on), onSelect: (id) => this.select(id) },
      this.place.timeZone,
    );
    this.globe.setReceiver(this.place.position, this.placeName);
    this.globe.onPick(({ satelliteId, position }) => {
      if (this.pickHandler && position) {
        const handler = this.pickHandler;
        this.pickHandler = null;
        handler(position);
        return;
      }
      if (satelliteId) this.select(satelliteId);
    });
  }

  /** One-shot handler for the next click on the globe (used by "Pick on globe"). */
  pickHandler: ((position: Geodetic) => void) | null = null;

  async start(): Promise<void> {
    const loaded = await loadElements();
    this.provenance = loaded.provenance;
    this.satellites = SYSTEM_IDS.flatMap((id) =>
      loaded.sets[id].map((e) => new Satellite(SYSTEMS[id], lookupSatellite(e.norad, id, e.name), e)),
    );
    this.globe.setSatellites(this.satellites);
    this.globe.onFrame(() => this.frame());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  get systems(): Record<SystemId, boolean> {
    return this.receiver.config.systems;
  }

  satellite(id: string): Satellite | undefined {
    return this.satellites.find((s) => s.id === id);
  }

  applyScenario(partial: Partial<Scenario>): void {
    const s: Scenario = { ...DEFAULT_SCENARIO, ...partial, display: { ...DEFAULT_SCENARIO.display, ...partial.display } };
    const rx = this.receiver;
    rx.config = {
      ...rx.config,
      systems: { ...s.systems },
      environment: s.environment,
      assistance: s.assistance,
      elevationMaskDeg: s.elevationMaskDeg,
      maxSatellites: s.maxSatellites,
      selection: s.selection,
      solutionSystem: s.solutionSystem,
      clockMode: s.clockMode,
    };
    rx.excluded.clear();
    if (s.clockErrorS === null) {
      rx.freezeClock = false;
    } else {
      rx.freezeClock = true;
      rx.clockBiasS = s.clockErrorS;
      rx.clockDriftS = 0;
    }
    if (s.powered && !rx.powered) this.setPower(true);
    if (!s.powered && rx.powered) this.setPower(false);
    this.globe.rate = s.rate;
    this.globe.playing = true;
    Object.assign(this.globe.display, s.display);
    this.onlyUsedSignals = s.onlyUsedSignals;
    this.phone.setTab(s.phoneTab);
    if (s.camera) this.globe.fly(s.camera);
    this.notify();
  }

  setPower(on: boolean): void {
    if (on) this.receiver.powerOn(this.globe.time);
    else this.receiver.powerOff();
    this.notify();
  }

  setPlace(place: Place): void {
    this.place = place;
    this.placeName = `${place.name}, ${place.region}`;
    this.moveReceiver(place.position, this.placeName);
    this.phone.setTimeZone(place.timeZone);
  }

  moveReceiver(position: Geodetic, name: string): void {
    this.placeName = name;
    this.receiver.setPosition(position);
    this.globe.setReceiver(position, name);
    this.notify();
  }

  setSystem(id: SystemId, on: boolean): void {
    this.receiver.config.systems[id] = on;
    this.notify();
  }

  setClockError(seconds: number): void {
    this.receiver.freezeClock = true;
    this.receiver.clockDriftS = 0;
    this.receiver.clockBiasS = seconds;
    this.notify();
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.phone.setSelected(id);
    this.notify();
  }

  toggleExcluded(id: string): void {
    const ex = this.receiver.excluded;
    if (ex.has(id)) ex.delete(id);
    else ex.add(id);
    this.notify();
  }

  fly(view: CameraView): void {
    this.globe.fly(view);
  }

  resetTime(): void {
    this.globe.time = new Date();
  }

  /** Range each used satellite's measurement implies, as the receiver sees it. */
  measuredRanges(): { sat: Satellite; range: number }[] {
    const fix = this.receiver.fix;
    const clockM =
      fix && fix.type !== 'clock-assumed' ? fix.clockBiasS * SPEED_OF_LIGHT : 0;
    return this.receiver.used
      .filter((o) => o.measurement)
      .map((o) => {
        const isb = fix?.interSystemBiasS[o.sat.system.id] ?? 0;
        return { sat: o.sat, range: o.measurement!.corrected - clockM - isb * SPEED_OF_LIGHT };
      });
  }

  private frame(): void {
    if (this.satellites.length === 0) return;
    const utc = this.globe.time;
    const gmst = gstime(utc);
    const systems = this.receiver.config.systems;
    for (const sat of this.satellites) if (systems[sat.system.id]) sat.update(utc, gmst);
    const now = performance.now();

    // The receiver runs at least once per simulated second (so acquisition timing stays
    // accurate when time is accelerated); the display refreshes at 4 Hz.
    const simStep = this.lastReceiverTime === null ? Infinity : utc.getTime() - this.lastReceiverTime;
    if (simStep >= 1000 || simStep < 0 || now - this.lastUpdate > 250) {
      this.lastReceiverTime = utc.getTime();
      this.receiver.update(
        utc,
        this.satellites.filter((s) => systems[s.system.id]),
      );
    }
    if (now - this.lastUpdate > 250) {
      this.lastUpdate = now;
      this.phone.render(this.receiver, utc);
      this.notify();
    }

    const observations = new Map(this.receiver.observations.map((o) => [o.sat.id, o]));
    this.globe.updateOrbits(this.satellites, systems, utc, gmst);
    this.globe.updateSatellites(this.satellites, systems, observations);
    this.globe.updateSignals(this.receiver.observations, now, this.onlyUsedSignals);
    this.globe.updateRanges(this.measuredRanges(), now);
    this.globe.setFix(this.receiver.fix, this.receiver.powered);
  }
}
