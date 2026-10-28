import type { App } from '../../app/App';
import { h, icon, ICONS } from '../dom';
import { distance, interval, num } from '../format';

const STATE_TEXT = {
  searching: 'Not tracked',
  acquiring: 'Acquiring signal',
  tracking: 'Reading navigation data',
  ready: 'Usable, not in solution',
  used: 'Used in position solution',
} as const;

const STATUS_TEXT: Record<string, string> = {
  healthy: 'Healthy',
  unhealthy: 'Unhealthy (set unusable)',
  testing: 'In testing / commissioning',
  spare: 'Spare',
  maintenance: 'Maintenance',
  decommissioned: 'Decommissioned',
  unknown: 'Not in service (status not published)',
};

/** Details for the selected satellite. */
export class Inspector {
  readonly root: HTMLElement;
  private readonly content: HTMLElement;

  constructor(private readonly app: App) {
    this.content = h('div');
    this.root = h(
      'aside',
      { class: 'inspector', hidden: true },
      h('button', { class: 'icon-btn inspector-close', 'aria-label': 'Close', onclick: () => app.select(null) }, icon(ICONS.close)),
      this.content,
    );
    app.subscribe(() => this.render());
  }

  private render(): void {
    const id = this.app.selectedId;
    const sat = id ? this.app.satellite(id) : undefined;
    this.root.hidden = !sat;
    if (!sat) return;
    const o = this.app.receiver.observations.find((x) => x.sat.id === sat.id);
    const info = sat.info;
    const altitude = Math.hypot(...sat.position) / 1000 - 6371;
    const row = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
    const rows = [
      ...row('Status', STATUS_TEXT[info.status] ?? info.status),
      ...row('Block / orbit', [info.block, info.orbit].filter(Boolean).join(' · ')),
      ...(info.plane ? row('Plane / slot', `${info.plane}${info.slot ? ` / ${info.slot}` : ''}`) : []),
      ...row('NORAD / SVN', `${sat.elements.norad}${info.svn ? ` / ${info.svn}` : ''}`),
      ...row('Signal', `${sat.system.signal.name} · ${num((o?.carrierHz ?? sat.system.signal.carrierHz) / 1e6, 4)} MHz`),
      ...row('Altitude / speed', `${num(altitude)} km · ${num(sat.inertialSpeed / 1000, 2)} km/s`),
      ...row('Orbital period', `${Math.floor(sat.periodMinutes / 60)} h ${String(Math.round(sat.periodMinutes % 60)).padStart(2, '0')} min`),
    ];
    if (o) {
      rows.push(
        ...row('Elevation / azimuth', `${num(o.el, 1)}° / ${num(o.az, 1)}°`),
        ...row('Range / travel time', `${distance(o.range)} · ${interval(o.range / 299_792_458)}`),
        ...row('Doppler', `${num(o.dopplerHz)} Hz`),
        ...row(
          'Received power / C/N₀',
          Number.isFinite(o.link.cn0) ? `${num(o.link.receivedPowerDbw + 30, 1)} dBm · ${num(o.link.cn0, 1)} dB-Hz` : 'blocked',
        ),
        ...row('Receiver state', o.excluded ? 'Excluded by user' : o.masked ? 'Below elevation mask' : STATE_TEXT[o.state]),
      );
      if (o.measurement?.residual !== undefined) rows.push(...row('Range residual', `${num(o.measurement.residual, 2)} m`));
    } else {
      rows.push(...row('Visibility', 'Below the horizon'));
    }
    const excluded = this.app.receiver.excluded.has(sat.id);
    const note = info.notes ? h('p', { class: 'inspector-note' }, info.notes) : '';
    this.content.replaceChildren(
      h('div', { class: 'inspector-head' }, h('i', { class: 'swatch', style: `--c:${sat.system.color}` }), h('b', {}, sat.label), h('span', {}, sat.system.name)),
      h('div', { class: 'inspector-sub' }, sat.elements.name),
      h('dl', { class: 'kv' }, ...rows),
      note,
      h('button', { class: 'btn', onclick: () => this.app.toggleExcluded(sat.id) }, excluded ? 'Include in solution' : 'Exclude from solution'),
    );
  }
}
