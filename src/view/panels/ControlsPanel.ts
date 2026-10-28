import type { App } from '../../app/App';
import { PLACES } from '../../app/places';
import { ENVIRONMENTS, type EnvironmentId } from '../../gnss/environment';
import type { AssistanceMode, Selection } from '../../gnss/receiver';
import { SYSTEM_IDS, SYSTEMS } from '../../gnss/systems';
import type { DisplayOptions, Imagery } from '../globe/GlobeView';
import { h, icon, ICONS, setText } from '../dom';
import { latitude, longitude, num } from '../format';

/** Free-run controls for every simulation parameter. */
export class ControlsPanel {
  readonly root: HTMLElement;
  private readonly sync: (() => void)[] = [];

  constructor(private readonly app: App) {
    const rx = app.receiver;
    this.root = h(
      'section',
      { class: 'controls' },
      this.section(
        'Receiver location',
        this.select(
          'Place',
          PLACES.map((p) => [p.id, `${p.name}, ${p.region}`]),
          () => (app.place && app.placeName.startsWith(app.place.name) ? app.place.id : ''),
          (id) => {
            const place = PLACES.find((p) => p.id === id);
            if (place) {
              app.setPlace(place);
              app.fly('sky');
            }
          },
        ),
        this.positionReadout(),
        h(
          'div',
          { class: 'button-row' },
          h('button', { class: 'btn', onclick: () => this.pickOnGlobe() }, icon(ICONS.crosshair), 'Pick on globe'),
          h('button', { class: 'btn', onclick: () => this.useDeviceLocation() }, icon(ICONS.locate), 'Use my location'),
        ),
      ),
      this.section(
        'Constellations',
        ...SYSTEM_IDS.map((id) => {
          const count = h('span', { class: 'field-meta' });
          this.sync.push(() => {
            const all = app.satellites.filter((s) => s.system.id === id);
            const inView = rx.observations.filter((o) => o.sat.system.id === id).length;
            setText(count, `${inView} in view · ${all.filter((s) => s.info.status === 'healthy').length}/${all.length} healthy`);
          });
          return this.checkbox(
            h('span', {}, h('i', { class: 'swatch', style: `--c:${SYSTEMS[id].color}` }), SYSTEMS[id].name, count),
            () => rx.config.systems[id],
            (on) => app.setSystem(id, on),
          );
        }),
      ),
      this.section(
        'Receiver',
        this.select<AssistanceMode>(
          'Start mode',
          [
            ['assisted', 'Assisted (A-GNSS, smartphone)'],
            ['standalone', 'Standalone (no assistance data)'],
          ],
          () => rx.config.assistance,
          (v) => (rx.config.assistance = v),
        ),
        this.select<EnvironmentId>(
          'Environment',
          Object.values(ENVIRONMENTS).map((e) => [e.id, e.label] as [EnvironmentId, string]),
          () => rx.config.environment,
          (v) => (rx.config.environment = v),
        ),
        this.range('Elevation mask', 0, 30, 1, () => rx.config.elevationMaskDeg, (v) => (rx.config.elevationMaskDeg = v), (v) => `${v}°`),
        this.range(
          'Satellites in solution',
          0,
          20,
          1,
          () => rx.config.maxSatellites,
          (v) => (rx.config.maxSatellites = v),
          (v) => (v === 0 ? 'all' : String(v)),
        ),
        this.select<Selection>(
          'When limited, prefer',
          [
            ['strongest', 'Strongest signals'],
            ['spread', 'Best geometry'],
            ['clustered', 'Clustered (poor geometry)'],
          ],
          () => rx.config.selection,
          (v) => (rx.config.selection = v),
        ),
        h('button', { class: 'btn', onclick: () => app.setPower(true) }, icon(ICONS.reset), 'Restart receiver'),
      ),
      this.section(
        'Display',
        ...(
          [
            ['orbits', 'Orbits'],
            ['signals', 'Signal paths'],
            ['spheres', 'Range spheres'],
            ['circles', 'Range circles on the ground'],
          ] as [keyof DisplayOptions, string][]
        ).map(([key, label]) =>
          this.checkbox(
            label,
            () => Boolean(app.globe.display[key]),
            (on) => Object.assign(app.globe.display, { [key]: on }),
          ),
        ),
        this.checkbox('Place names', () => app.globe.display.placeNames, (on) => app.globe.setPlaceNames(on)),
        this.select<DisplayOptions['labels']>(
          'Satellite labels',
          [
            ['inView', 'Satellites in view'],
            ['all', 'All satellites'],
            ['none', 'None'],
          ],
          () => app.globe.display.labels,
          (v) => (app.globe.display.labels = v),
        ),
        this.select<Imagery>(
          'Imagery',
          [
            ['satellite', 'Satellite imagery (Esri, online)'],
            ['offline', 'Natural Earth II (offline)'],
          ],
          () => this.imagery,
          (v) => {
            this.imagery = v;
            app.globe.setImagery(v);
          },
        ),
      ),
      this.section(
        'Interference',
        h('p', { class: 'muted' }, 'Jamming and spoofing scenarios are the next module. The receiver already exposes the hooks they use (noise floor, per-satellite signal, pseudoranges).'),
      ),
    );
    app.subscribe(() => this.sync.forEach((f) => f()));
  }

  private imagery: Imagery = 'satellite';

  private section(title: string, ...children: (Node | string)[]): HTMLElement {
    return h('fieldset', { class: 'control-section' }, h('legend', {}, title), ...children);
  }

  private positionReadout(): HTMLElement {
    const text = h('span', { class: 'mono' });
    this.sync.push(() => {
      const p = this.app.receiver.position;
      setText(text, `${latitude(p.lat, 4)}  ${longitude(p.lon, 4)}  h ${num(p.h)} m`);
    });
    return h('div', { class: 'field-meta position' }, text);
  }

  private pickOnGlobe(): void {
    document.body.classList.add('picking');
    this.app.pickHandler = (pos) => {
      document.body.classList.remove('picking');
      this.app.moveReceiver(pos, `${latitude(pos.lat, 3)}, ${longitude(pos.lon, 3)}`);
    };
  }

  private useDeviceLocation(): void {
    navigator.geolocation?.getCurrentPosition(
      (p) =>
        this.app.moveReceiver(
          { lat: p.coords.latitude, lon: p.coords.longitude, h: p.coords.altitude ?? 0 },
          'Your location',
        ),
      () => undefined,
    );
  }

  private checkbox(label: Node | string, get: () => boolean, set: (on: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => {
      set(input.checked);
      this.app.notify();
    });
    this.sync.push(() => (input.checked = get()));
    return h('label', { class: 'check' }, input, label);
  }

  private select<T extends string>(label: string, options: [T, string][], get: () => T | '', set: (v: T) => void): HTMLElement {
    const select = h('select', {}, ...options.map(([v, text]) => h('option', { value: v }, text)));
    select.addEventListener('change', () => {
      set(select.value as T);
      this.app.notify();
    });
    this.sync.push(() => {
      const v = get();
      if (document.activeElement !== select && select.value !== v) select.value = v;
    });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), select);
  }

  private range(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string,
  ): HTMLElement {
    const value = h('span', { class: 'field-value' });
    const input = h('input', { type: 'range', min, max, step });
    input.addEventListener('input', () => {
      set(Number(input.value));
      this.app.notify();
    });
    this.sync.push(() => {
      setText(value, format(get()));
      if (document.activeElement !== input) input.value = String(get());
    });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, value), input);
  }
}
