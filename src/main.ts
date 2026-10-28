import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles/app.css';

import { App } from './app/App';
import { SYSTEM_IDS, SYSTEMS } from './gnss/systems';
import { BriefingPanel } from './view/briefing/BriefingPanel';
import { h, setText } from './view/dom';
import type { CameraView } from './view/globe/GlobeView';
import { ControlsPanel } from './view/panels/ControlsPanel';
import { Inspector } from './view/panels/Inspector';
import { TopBar } from './view/panels/TopBar';

function mount(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app element missing');

  const globeContainer = h('div', { class: 'globe' });
  const phoneContainer = h('div', { class: 'phone-dock' });
  const stage = h('main', { class: 'stage' }, globeContainer);
  const right = h('aside', { class: 'right-panel', 'aria-label': 'Receiver' }, phoneContainer);
  const loading = h('div', { class: 'loading' }, 'Loading orbital elements…');
  stage.append(loading);

  const app = new App(globeContainer, phoneContainer);
  const briefing = new BriefingPanel(app);
  const controls = new ControlsPanel(app);
  const inspector = new Inspector(app);
  const topBar = new TopBar(app);

  const tabs = {
    briefing: h('button', { class: 'tab active', role: 'tab' }, 'Briefing'),
    controls: h('button', { class: 'tab', role: 'tab' }, 'Controls'),
  };
  const showTab = (key: keyof typeof tabs): void => {
    for (const k of Object.keys(tabs) as (keyof typeof tabs)[]) tabs[k].classList.toggle('active', k === key);
    briefing.root.hidden = key !== 'briefing';
    controls.root.hidden = key !== 'controls';
  };
  tabs.briefing.addEventListener('click', () => showTab('briefing'));
  tabs.controls.addEventListener('click', () => showTab('controls'));
  controls.root.hidden = true;

  const left = h(
    'aside',
    { class: 'left-panel' },
    h('nav', { class: 'tabs', role: 'tablist' }, tabs.briefing, tabs.controls),
    briefing.root,
    controls.root,
  );

  const views: [CameraView, string][] = [
    ['overview', 'Constellations'],
    ['sky', 'Receiver sky'],
    ['region', 'Region'],
    ['street', 'Street'],
  ];
  const cameraBar = h(
    'div',
    { class: 'overlay camera-bar segmented compact' },
    ...views.map(([view, label]) => h('button', { onclick: () => app.fly(view) }, label)),
  );
  const legendCounts = new Map<string, HTMLElement>();
  const legend = h(
    'div',
    { class: 'overlay legend' },
    ...SYSTEM_IDS.map((id) => {
      const count = h('b');
      legendCounts.set(id, count);
      return h('div', { class: 'legend-row' }, h('i', { class: 'swatch', style: `--c:${SYSTEMS[id].color}` }), SYSTEMS[id].name, count);
    }),
    h('div', { class: 'legend-note' }, 'used / in view'),
  );
  stage.append(cameraBar, legend, inspector.root);
  app.subscribe(() => {
    for (const id of SYSTEM_IDS) {
      const obs = app.receiver.observations.filter((o) => o.sat.system.id === id);
      const used = obs.filter((o) => o.state === 'used').length;
      setText(legendCounts.get(id)!, app.systems[id] ? `${used} / ${obs.length}` : 'off');
    }
  });

  root.append(topBar.root, left, stage, right);

  app.globe.setImagery('satellite');
  app
    .start()
    .then(() => {
      loading.remove();
      briefing.show(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      setText(loading, `Could not load orbital elements: ${err instanceof Error ? err.message : String(err)}`);
    });
}

mount();
