import type { GnssReceiver, Observation } from '../../gnss/receiver';
import { SYSTEM_IDS, SYSTEMS, type SystemId } from '../../gnss/systems';
import { toGpsTime } from '../../gnss/time';
import { h, setText } from '../dom';
import { interval, latitude, longitude, num } from '../format';
import { SHAPES, SkyPlot } from './SkyPlot';

export type PhoneTab = 'status' | 'sky';

export interface PhoneCallbacks {
  onPower(on: boolean): void;
  onSelect(satelliteId: string): void;
}

const CARRIER_LABEL: Record<SystemId, string> = { GPS: 'L1', GAL: 'E1', GLO: 'L1', BDS: 'B1' };
const SYSTEM_SHORT: Record<SystemId, string> = { GPS: 'GPS', GAL: 'GAL', GLO: 'GLO', BDS: 'BDS' };

const STATE_ORDER: Record<Observation['state'], number> = { used: 0, ready: 1, tracking: 2, acquiring: 3, searching: 4 };

interface TableRow {
  tr: HTMLTableRowElement;
  cells: { id: HTMLElement; cn0: HTMLElement; bar: HTMLElement; flags: HTMLElement; el: HTMLElement; az: HTMLElement };
  className: string;
}

function statusBarIcons(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 14');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', '14');
  svg.innerHTML = `
    <g class="sb-location"><path d="M6 1 1 12l5-2 5 2z" fill="currentColor"/></g>
    <g fill="currentColor"><rect x="17" y="9" width="2.5" height="4" rx=".5"/><rect x="21" y="6.5" width="2.5" height="6.5" rx=".5"/><rect x="25" y="4" width="2.5" height="9" rx=".5"/><rect x="29" y="1.5" width="2.5" height="11.5" rx=".5"/></g>
    <g fill="none" stroke="currentColor" stroke-width="1.2"><rect x="39" y="2" width="20" height="10" rx="2.5"/><path d="M61 5.5v3" stroke-linecap="round"/></g>
    <rect x="41" y="4" width="13" height="6" rx="1" fill="currentColor"/>`;
  return svg;
}

/** Smartphone running a GNSS status app: what the receiver reports to the user. */
export class PhoneView {
  readonly root: HTMLElement;
  private tab: PhoneTab = 'status';
  private selectedId: string | null = null;
  private readonly sky: SkyPlot;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly table: HTMLTableSectionElement;
  private readonly rows = new Map<string, TableRow>();
  private readonly tabButtons: Record<PhoneTab, HTMLButtonElement>;
  private readonly panes: Record<PhoneTab, HTMLElement>;
  private timeFormat: Intl.DateTimeFormat;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: PhoneCallbacks,
    timeZone: string,
  ) {
    this.timeFormat = this.makeTimeFormat(timeZone);
    const field = (key: string, label: string): HTMLElement =>
      h('div', { class: 'app-field' }, h('span', {}, label), (this.el[key] = h('b', {}, '—')));

    const skyCanvas = h('canvas', { class: 'app-sky', 'aria-label': 'Sky plot' });
    this.sky = new SkyPlot(skyCanvas);
    skyCanvas.addEventListener('click', (e) => {
      const id = this.sky.hitTest(e.clientX, e.clientY);
      if (id) this.callbacks.onSelect(id);
    });

    this.table = h('tbody');
    this.table.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('tr');
      if (row?.dataset.id) this.callbacks.onSelect(row.dataset.id);
    });

    const toggle = h('button', {
      class: 'switch',
      role: 'switch',
      'aria-checked': 'false',
      'aria-label': 'Use location',
      onclick: () => this.callbacks.onPower(true),
    });

    this.tabButtons = {
      status: h('button', { class: 'app-tab active', onclick: () => this.setTab('status') }, 'Status'),
      sky: h('button', { class: 'app-tab', onclick: () => this.setTab('sky') }, 'Sky'),
    };

    const legend = h(
      'div',
      { class: 'sky-legend' },
      ...SYSTEM_IDS.map((id) =>
        h(
          'div',
          { class: 'sky-legend-row' },
          h('i', { class: `shape shape-${SHAPES[id]}`, style: `--c:${SYSTEMS[id].color}` }),
          h('span', {}, SYSTEMS[id].name),
          (this.el[`legend-${id}`] = h('b', {}, '')),
        ),
      ),
    );

    this.panes = {
      status: h(
        'div',
        { class: 'app-pane' },
        h(
          'div',
          { class: 'app-fields' },
          field('lat', 'Latitude'),
          field('lon', 'Longitude'),
          field('alt', 'Height (WGS-84)'),
          field('acc', 'H. accuracy (95%)'),
          field('fix', 'Fix'),
          field('ttff', 'TTFF'),
          field('sats', 'Satellites used / in view'),
          field('dop', 'PDOP / HDOP / VDOP'),
          field('clockOffset', 'Receiver clock offset'),
          field('gpst', 'GPS week / time of week'),
        ),
        h(
          'table',
          { class: 'app-table' },
          h(
            'thead',
            {},
            h('tr', {}, ...['ID', 'GNSS', 'CF', 'C/N0', 'Flags', 'Elev', 'Azim'].map((c) => h('th', {}, c))),
          ),
          this.table,
        ),
      ),
      sky: h(
        'div',
        { class: 'app-pane', hidden: true },
        skyCanvas,
        legend,
        h('p', { class: 'app-note' }, 'Filled: used in fix. Outline: tracked. Grey: not tracked. Dashed ring: elevation mask.'),
      ),
    };

    this.root = h(
      'div',
      { class: 'phone' },
      h('div', { class: 'phone-camera' }),
      h(
        'div',
        { class: 'phone-screen' },
        h('div', { class: 'statusbar' }, (this.el.time = h('span', {}, '--:--')), statusBarIcons()),
        (this.el.off = h(
          'div',
          { class: 'settings' },
          h('div', { class: 'settings-title' }, 'Location'),
          h(
            'div',
            { class: 'settings-row' },
            h('div', {}, h('div', { class: 'settings-label' }, 'Use location'), h('div', { class: 'settings-sub' }, 'Off')),
            toggle,
          ),
          h(
            'p',
            { class: 'settings-text' },
            'Location uses GNSS satellites to determine where the phone is. The GNSS receiver only listens to the satellites; it transmits nothing.',
          ),
          h(
            'p',
            { class: 'settings-text' },
            'With mobile data, the network also supplies assistance data (satellite orbits, approximate time and position) so the first fix takes seconds instead of a minute.',
          ),
        )),
        (this.el.on = h(
          'div',
          { class: 'gnss-app', hidden: true },
          h(
            'div',
            { class: 'app-bar' },
            h('span', { class: 'app-title' }, 'GNSS Status'),
            h('button', { class: 'app-off', onclick: () => this.callbacks.onPower(false) }, 'Turn off'),
          ),
          h('div', { class: 'app-tabs' }, this.tabButtons.status, this.tabButtons.sky),
          this.panes.status,
          this.panes.sky,
        )),
      ),
    );
    parent.append(this.root);
  }

  setTimeZone(timeZone: string): void {
    this.timeFormat = this.makeTimeFormat(timeZone);
  }

  setTab(tab: PhoneTab): void {
    this.tab = tab;
    for (const key of ['status', 'sky'] as const) {
      this.tabButtons[key].classList.toggle('active', key === tab);
      this.panes[key].hidden = key !== tab;
    }
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.sky.selectedId = id;
  }

  render(rx: GnssReceiver, utc: Date): void {
    setText(this.el.time!, this.timeFormat.format(utc));
    this.root.classList.toggle('is-on', rx.powered);
    this.el.off!.hidden = rx.powered;
    this.el.on!.hidden = !rx.powered;
    if (!rx.powered) return;

    const fix = rx.fix;
    const used = rx.observations.filter((o) => o.state === 'used').length;
    const e = this.el;
    if (fix && fix.type !== 'clock-assumed') {
      setText(e.lat!, latitude(fix.geodetic.lat));
      setText(e.lon!, longitude(fix.geodetic.lon));
      setText(e.alt!, `${num(fix.geodetic.h, 1)} m`);
      setText(e.acc!, fix.accuracyH95 === null ? '—' : `${num(fix.accuracyH95, 1)} m`);
      setText(e.fix!, fix.type === '2D' ? '2D (altitude held)' : '3D');
    } else if (fix && fix.type === 'clock-assumed') {
      setText(e.lat!, latitude(fix.geodetic.lat));
      setText(e.lon!, longitude(fix.geodetic.lon));
      setText(e.alt!, `${num(fix.geodetic.h, 0)} m`);
      setText(e.acc!, '—');
      setText(e.fix!, 'Clock not solved');
    } else {
      for (const k of ['lat', 'lon', 'alt', 'acc']) setText(e[k]!, '—');
      setText(e.fix!, rx.observations.some((o) => o.state === 'acquiring' || o.state === 'tracking') ? 'Acquiring' : 'No fix');
    }
    e.fix!.className = fix?.type === '3D' ? 'ok' : fix ? 'warn' : '';
    setText(e.ttff!, rx.ttff === null ? '—' : `${num(rx.ttff, 1)} s`);
    setText(e.sats!, `${used} / ${rx.observations.length}`);
    setText(
      e.dop!,
      fix?.dop ? `${num(fix.dop.pdop, 1)} / ${num(fix.dop.hdop, 1)} / ${num(fix.dop.vdop, 1)}` : '—',
    );
    setText(e.clockOffset!, fix && fix.type !== 'clock-assumed' ? interval(fix.clockBiasS) : '—');
    const gpst = toGpsTime(utc);
    setText(e.gpst!, `${gpst.week} / ${num(gpst.tow, 0)} s`);

    if (this.tab === 'status') this.renderTable(rx);
    else this.renderSky(rx);
  }

  private renderTable(rx: GnssReceiver): void {
    // Rows are kept and updated in place so they stay clickable; the order only changes
    // when a satellite changes state.
    const rows = [...rx.observations].sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        SYSTEM_IDS.indexOf(a.sat.system.id) - SYSTEM_IDS.indexOf(b.sat.system.id) ||
        a.sat.label.localeCompare(b.sat.label),
    );
    const seen = new Set<string>();
    let previous: Element | null = null;
    for (const o of rows) {
      seen.add(o.sat.id);
      let row = this.rows.get(o.sat.id);
      if (!row) {
        row = this.createRow(o);
        this.rows.set(o.sat.id, row);
      }
      this.updateRow(row, o, rx);
      const expectedNext: Element | null = previous ? previous.nextElementSibling : this.table.firstElementChild;
      if (expectedNext !== row.tr) {
        if (previous) previous.after(row.tr);
        else this.table.prepend(row.tr);
      }
      previous = row.tr;
    }
    for (const [id, row] of this.rows) {
      if (seen.has(id)) continue;
      row.tr.remove();
      this.rows.delete(id);
    }
  }

  private createRow(o: Observation): TableRow {
    const cells = {
      id: h('td'),
      cn0: h('span'),
      bar: h('span', { class: 'cn0-bar', style: `--c:${o.sat.system.color}` }),
      flags: h('td', { class: 'flags' }),
      el: h('td'),
      az: h('td'),
    };
    const tr = h(
      'tr',
      { 'data-id': o.sat.id },
      cells.id,
      h('td', {}, h('i', { class: 'sys', style: `--c:${o.sat.system.color}` }), SYSTEM_SHORT[o.sat.system.id]),
      h('td', {}, CARRIER_LABEL[o.sat.system.id]),
      h('td', { class: 'cn0' }, cells.bar, cells.cn0),
      cells.flags,
      cells.el,
      cells.az,
    );
    return { tr, cells, className: '' };
  }

  private updateRow(row: TableRow, o: Observation, rx: GnssReceiver): void {
    const tracked = o.state !== 'searching' && Number.isFinite(o.link.cn0);
    const almanac = rx.config.assistance === 'assisted' || o.hasEphemeris;
    const flags = `${almanac ? 'A' : '·'}${o.hasEphemeris ? 'E' : '·'}${o.state === 'used' ? 'U' : '·'}`;
    const className = [o.state, o.sat.id === this.selectedId ? 'selected' : '', o.healthy ? '' : 'unhealthy']
      .filter(Boolean)
      .join(' ');
    if (row.className !== className) {
      row.className = className;
      row.tr.className = className;
    }
    setText(row.cells.id, o.sat.label.slice(1));
    setText(row.cells.cn0, tracked ? num(o.link.cn0, 1) : '');
    row.cells.bar.style.width = `${tracked ? Math.max(0, Math.min(100, ((o.link.cn0 - 10) / 40) * 100)) : 0}%`;
    setText(row.cells.flags, flags);
    setText(row.cells.el, num(o.el, 0));
    setText(row.cells.az, num(o.az, 0));
  }

  private renderSky(rx: GnssReceiver): void {
    this.sky.render(rx);
    for (const id of SYSTEM_IDS) {
      const all = rx.observations.filter((o) => o.sat.system.id === id);
      const used = all.filter((o) => o.state === 'used').length;
      setText(this.el[`legend-${id}`]!, rx.config.systems[id] ? `${used} / ${all.length}` : 'off');
    }
  }

  private makeTimeFormat(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  }
}
