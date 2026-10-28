import type { App } from '../../app/App';
import type { ElementSource } from '../../app/orbitData';
import { toGpsTime } from '../../gnss/time';
import { h, icon, ICONS, setText } from '../dom';
import { num, utcDate, utcTime } from '../format';

const RATES = [1, 10, 60, 600, 3600];

const SOURCE_TEXT: Record<ElementSource, string> = {
  celestrak: 'CelesTrak, live',
  cache: 'CelesTrak, cached',
  snapshot: 'CelesTrak snapshot',
};

export class TopBar {
  readonly root: HTMLElement;

  constructor(app: App) {
    const date = h('span', { class: 'clock-date' });
    const time = h('span', { class: 'clock-time' });
    const gps = h('span', { class: 'clock-gps' });
    const location = h('span', { class: 'topbar-location' });
    const data = h('span', { class: 'topbar-data' });
    const play = h('button', { class: 'icon-btn', 'aria-label': 'Play or pause', onclick: () => (app.globe.playing = !app.globe.playing) });
    const rates = RATES.map((r) =>
      h('button', { onclick: () => ((app.globe.rate = r), (app.globe.playing = true), app.notify()) }, r === 1 ? '1×' : `${r}×`),
    );

    this.root = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'brand' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name' }, 'GNSS Explain'),
      ),
      h('div', { class: 'topbar-meta' }, location, data),
      h(
        'div',
        { class: 'topbar-clock' },
        h('div', { class: 'clock' }, date, time, gps),
        play,
        h('div', { class: 'segmented compact', role: 'group', 'aria-label': 'Simulation rate' }, ...rates),
        h('button', { class: 'btn compact', onclick: () => app.resetTime(), title: 'Return to the current time' }, 'Now'),
      ),
    );

    let lastPlaying: boolean | null = null;
    app.subscribe(() => {
      const t = app.globe.time;
      const g = toGpsTime(t);
      setText(date, utcDate(t));
      setText(time, `${utcTime(t)} UTC`);
      setText(gps, `GPS week ${g.week} · ${num(g.tow, 0)} s`);
      setText(location, app.placeName);
      const p = Object.values(app.provenance);
      const total = app.satellites.length;
      const retrieved = p.find((x) => x?.retrievedAt)?.retrievedAt;
      const source = p[0]?.source;
      setText(
        data,
        source ? `Orbits: ${SOURCE_TEXT[source]}${retrieved ? ` ${utcDate(retrieved)} ${utcTime(retrieved).slice(0, 5)} UTC` : ''} · ${total} satellites` : '',
      );
      rates.forEach((b, i) => b.classList.toggle('active', RATES[i] === app.globe.rate));
      if (lastPlaying !== app.globe.playing) {
        lastPlaying = app.globe.playing;
        play.replaceChildren(icon(app.globe.playing ? ICONS.pause : ICONS.play));
      }
    });
  }
}
