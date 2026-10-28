import type { App } from '../../app/App';
import type { AssistanceMode } from '../../gnss/receiver';
import { ENVIRONMENTS, type EnvironmentId } from '../../gnss/environment';
import { h, icon, ICONS, setText } from '../dom';
import { num } from '../format';
import { CHAPTERS, type Chapter, type ChapterControl } from './chapters';

/** Guided walkthrough: one chapter at a time, each configuring the simulation. */
export class BriefingPanel {
  readonly root: HTMLElement;
  private index = 0;
  private readonly title: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly body: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly readoutHead: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly progress: HTMLElement;
  private readonly bindings: (() => void)[] = [];

  constructor(private readonly app: App) {
    this.counter = h('div', { class: 'chapter-counter' });
    this.title = h('h2', { class: 'chapter-title' });
    this.body = h('div', { class: 'chapter-body' });
    this.controls = h('div', { class: 'chapter-controls' });
    this.readout = h('dl', { class: 'readout' });
    this.readoutHead = h('div', { class: 'readout-head' }, 'Live values');
    this.prev = h('button', { class: 'btn', onclick: () => this.show(this.index - 1) }, icon(ICONS.chevronLeft), 'Previous');
    this.next = h('button', { class: 'btn btn-primary', onclick: () => this.show(this.index + 1) }, 'Next', icon(ICONS.chevronRight));
    this.progress = h(
      'ol',
      { class: 'chapter-index' },
      ...CHAPTERS.map((c, i) =>
        h('li', {}, h('button', { onclick: () => this.show(i), title: c.title }, h('span', {}, String(i + 1).padStart(2, '0')), c.title)),
      ),
    );
    this.root = h(
      'section',
      { class: 'briefing' },
      h(
        'div',
        { class: 'briefing-scroll' },
        this.counter,
        this.title,
        this.body,
        this.controls,
        this.readoutHead,
        this.readout,
        h('details', { class: 'chapter-toc' }, h('summary', {}, 'All chapters'), this.progress),
      ),
      h('div', { class: 'briefing-nav' }, this.prev, this.next),
    );
    app.subscribe(() => this.refresh());
  }

  get chapter(): Chapter {
    return CHAPTERS[this.index]!;
  }

  show(index: number): void {
    this.index = Math.max(0, Math.min(CHAPTERS.length - 1, index));
    const c = this.chapter;
    this.app.applyScenario(c.scenario);
    setText(this.counter, `Chapter ${this.index + 1} of ${CHAPTERS.length}`);
    setText(this.title, c.title);
    this.body.replaceChildren(
      ...c.body.map((html) => {
        const p = h('p');
        p.innerHTML = html;
        return p;
      }),
    );
    this.buildControls(c.controls ?? []);
    this.prev.disabled = this.index === 0;
    this.next.disabled = this.index === CHAPTERS.length - 1;
    [...this.progress.children].forEach((li, i) => li.classList.toggle('current', i === this.index));
    this.refresh();
  }

  private refresh(): void {
    const rows = this.chapter.readout?.(this.app) ?? [];
    this.readoutHead.hidden = rows.length === 0;
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      frag.append(
        h('dt', {}, r.color ? h('i', { class: 'swatch', style: `--c:${r.color}` }) : null, r.label),
        h('dd', {}, r.value),
      );
    }
    this.readout.replaceChildren(frag);
    for (const b of this.bindings) b();
  }

  private buildControls(list: ChapterControl[]): void {
    this.bindings.length = 0;
    const rx = this.app.receiver;
    const nodes = list.map((kind) => {
      switch (kind) {
        case 'power': {
          const button = h('button', { class: 'btn', onclick: () => this.app.setPower(!rx.powered) });
          this.bindings.push(() => setText(button, rx.powered ? 'Switch location off' : 'Switch location on'));
          return button;
        }
        case 'assistance':
          return this.segmented<AssistanceMode>(
            'Start mode',
            [
              ['assisted', 'Assisted (A-GNSS)'],
              ['standalone', 'Standalone'],
            ],
            () => rx.config.assistance,
            (v) => {
              rx.config.assistance = v;
              if (rx.powered) this.app.setPower(true);
            },
          );
        case 'environment':
          return this.segmented<EnvironmentId>(
            'Environment',
            Object.values(ENVIRONMENTS).map((e) => [e.id, e.label] as [EnvironmentId, string]),
            () => rx.config.environment,
            (v) => (rx.config.environment = v),
          );
        case 'geometry':
          return this.segmented<string>(
            'Satellites in solution',
            [
              ['clustered', '4 clustered'],
              ['spread', '4 spread out'],
              ['all', 'All GPS'],
            ],
            () => (rx.config.maxSatellites === 0 ? 'all' : rx.config.selection),
            (v) => {
              rx.config.maxSatellites = v === 'all' ? 0 : 4;
              rx.config.selection = v === 'all' ? 'strongest' : (v as 'spread' | 'clustered');
            },
          );
        case 'clock':
          return this.slider(
            'Receiver clock error',
            0,
            1000,
            10,
            () => rx.clockBiasS * 1e6,
            (v) => this.app.setClockError(v * 1e-6),
            (v) => `${num(v)} µs`,
          );
        case 'satellites':
          return this.slider(
            'Satellites in solution',
            4,
            12,
            1,
            () => rx.config.maxSatellites || 12,
            (v) => (rx.config.maxSatellites = v),
            (v) => String(v),
          );
      }
    });
    this.controls.replaceChildren(...nodes);
  }

  private segmented<T extends string>(
    label: string,
    options: [T, string][],
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement {
    const buttons = options.map(([value, text]) =>
      h(
        'button',
        {
          onclick: () => {
            set(value);
            this.app.notify();
          },
        },
        text,
      ),
    );
    this.bindings.push(() => buttons.forEach((b, i) => b.classList.toggle('active', options[i]![0] === get())));
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'segmented' }, ...buttons));
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string,
  ): HTMLElement {
    const value = h('span', { class: 'field-value' });
    const input = h('input', { type: 'range', min, max, step, value: get() });
    input.addEventListener('input', () => {
      set(Number(input.value));
      this.app.notify();
    });
    this.bindings.push(() => {
      setText(value, format(get()));
      if (document.activeElement !== input) input.value = String(get());
    });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, value), input);
  }
}
