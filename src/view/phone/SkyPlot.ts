import type { GnssReceiver, Observation } from '../../gnss/receiver';
import type { SystemId } from '../../gnss/systems';

type Shape = 'circle' | 'square' | 'triangle' | 'diamond';
const SHAPES: Record<SystemId, Shape> = { GPS: 'circle', GAL: 'square', GLO: 'triangle', BDS: 'diamond' };

const GRID = 'rgba(148, 160, 180, 0.28)';
const TEXT = 'rgba(205, 212, 224, 0.9)';
const MASK = 'rgba(242, 179, 61, 0.55)';

export interface SkyPlotHit {
  x: number;
  y: number;
  id: string;
}

function drawShape(g: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  g.beginPath();
  switch (shape) {
    case 'circle':
      g.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'square':
      g.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
      break;
    case 'triangle':
      g.moveTo(x, y - r * 1.1);
      g.lineTo(x + r, y + r * 0.8);
      g.lineTo(x - r, y + r * 0.8);
      g.closePath();
      break;
    case 'diamond':
      g.moveTo(x, y - r * 1.15);
      g.lineTo(x + r * 1.05, y);
      g.lineTo(x, y + r * 1.15);
      g.lineTo(x - r * 1.05, y);
      g.closePath();
      break;
  }
}

/** Polar plot of satellite azimuth/elevation as seen from the receiver (north up, zenith at centre). */
export class SkyPlot {
  hits: SkyPlotHit[] = [];
  selectedId: string | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {}

  render(rx: GnssReceiver): void {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const hgt = cv.clientHeight;
    if (w === 0 || hgt === 0) return;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);

    const cx = w / 2;
    const cy = hgt / 2;
    const R = Math.min(w, hgt) / 2 - 16;
    const project = (az: number, el: number): [number, number] => {
      const r = (R * (90 - el)) / 90;
      const a = (az * Math.PI) / 180;
      return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    };

    // Obstructions (urban canyon skyline).
    if (rx.config.environment === 'urban') {
      g.beginPath();
      for (let az = 0; az <= 360; az += 2) {
        const [x, y] = project(az, rx.environment.skyline(az % 360));
        if (az === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.moveTo(cx + R, cy);
      g.arc(cx, cy, R, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(120, 130, 148, 0.30)';
      g.fill('evenodd');
    }

    g.strokeStyle = GRID;
    g.lineWidth = 1;
    for (const el of [0, 30, 60]) {
      g.beginPath();
      g.arc(cx, cy, (R * (90 - el)) / 90, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();

    g.setLineDash([3, 3]);
    g.strokeStyle = MASK;
    g.beginPath();
    g.arc(cx, cy, (R * (90 - rx.config.elevationMaskDeg)) / 90, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);

    g.fillStyle = TEXT;
    g.font = '600 10px "IBM Plex Sans", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      const [x, y] = project(az, -9);
      g.fillText(label, x, y);
    }
    g.font = '500 8px "IBM Plex Mono", monospace';
    g.fillStyle = 'rgba(148, 160, 180, 0.75)';
    for (const el of [30, 60]) {
      const [x, y] = project(45, el);
      g.fillText(`${el}°`, x + 8, y);
    }

    this.hits = [];
    const ordered = [...rx.observations].sort((a, b) => rank(a) - rank(b));
    for (const o of ordered) this.drawSatellite(g, o, project);
  }

  private drawSatellite(
    g: CanvasRenderingContext2D,
    o: Observation,
    project: (az: number, el: number) => [number, number],
  ): void {
    const [x, y] = project(o.az, o.el);
    const color = o.sat.system.color;
    const shape = SHAPES[o.sat.system.id];
    const r = 5.5;
    drawShape(g, shape, x, y, r);
    if (o.state === 'used') {
      g.fillStyle = color;
      g.fill();
    } else if (o.state === 'searching') {
      g.strokeStyle = 'rgba(148, 160, 180, 0.65)';
      g.lineWidth = 1;
      g.stroke();
    } else {
      g.fillStyle = `${color}33`;
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      g.stroke();
    }
    if (o.sat.id === this.selectedId) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, r + 4, 0, Math.PI * 2);
      g.stroke();
    }
    if (o.excluded || !o.healthy) {
      g.strokeStyle = '#ff5d6c';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 5, y - 5);
      g.lineTo(x + 5, y + 5);
      g.stroke();
    }
    g.fillStyle = o.state === 'searching' ? 'rgba(148, 160, 180, 0.8)' : 'rgba(230, 234, 240, 0.95)';
    g.font = '500 8px "IBM Plex Mono", monospace';
    g.textAlign = 'left';
    g.fillText(o.sat.label.slice(1), x + r + 2, y - r);
    this.hits.push({ x, y, id: o.sat.id });
  }

  hitTest(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: SkyPlotHit | null = null;
    let bestD = 12;
    for (const hit of this.hits) {
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d < bestD) {
        bestD = d;
        best = hit;
      }
    }
    return best?.id ?? null;
  }
}

function rank(o: Observation): number {
  return o.state === 'used' ? 3 : o.state === 'searching' ? 0 : 1;
}

export { SHAPES };
