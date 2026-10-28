type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Creates an element: h('div', { class: 'row', onclick: fn }, child, ...). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : String(c));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an inline SVG icon from path data on a 24×24 grid (stroke icons). */
export function icon(paths: readonly string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Icon path data (Lucide, ISC licence). */
export const ICONS = {
  play: ['M6 4l14 8-14 8z'],
  pause: ['M7 4v16', 'M17 4v16'],
  reset: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  crosshair: ['M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4', 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8'],
  locate: ['M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  chevronRight: ['M9 18l6-6-6-6'],
  globe: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20'],
  more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
} as const;

/** Sets text only when it changed (avoids layout work in the render loop). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
