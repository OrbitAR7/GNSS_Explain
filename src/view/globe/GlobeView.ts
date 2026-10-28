import {
  ArcType,
  BillboardCollection,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  ConstantPositionProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  EllipsoidGeometry,
  EllipsoidOutlineGeometry,
  Entity,
  GeometryInstance,
  HeadingPitchRange,
  ImageryLayer,
  JulianDate,
  LabelCollection,
  LabelStyle,
  Material,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  NearFarScalar,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolylineCollection,
  PolylineDashMaterialProperty,
  Primitive,
  Quaternion,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
  TranslationRotationScale,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  buildModuleUrl,
  type Billboard,
  type Label,
  type PointPrimitive,
  type Polyline,
} from 'cesium';
import type { Geodetic, Vec3 } from '../../gnss/geodesy';
import { ecefToGeodetic, geodeticToEcef } from '../../gnss/geodesy';
import type { Fix, Observation } from '../../gnss/receiver';
import type { Satellite } from '../../gnss/satellite';
import type { SystemId } from '../../gnss/systems';
import { receiverGlyph, satelliteGlyph } from './glyphs';

const toCartesian = (p: Vec3): Cartesian3 => new Cartesian3(p[0], p[1], p[2]);

export type CameraView = 'overview' | 'spheres' | 'sky' | 'region' | 'street';
export type Imagery = 'satellite' | 'offline';

export interface DisplayOptions {
  orbits: boolean;
  signals: boolean;
  labels: 'none' | 'inView' | 'all';
  spheres: boolean;
  circles: boolean;
  placeNames: boolean;
}

export interface RangeVisual {
  sat: Satellite;
  /** Range the receiver believes (m). */
  range: number;
}

interface SatelliteGraphics {
  billboard: Billboard;
  label: Label;
  orbit: Polyline;
  color: Color;
}

interface SignalGraphics {
  line: Polyline;
  pulses: PointPrimitive[];
  phase: number;
  state: string;
}

interface SphereGraphics {
  fill: Primitive;
  outline: Primitive;
  color: string;
}

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_PLACES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const RECEIVER_COLOR = Color.fromCssColorString('#b794ff');
const FIX_COLOR = Color.fromCssColorString('#ffe066');

export class GlobeView {
  readonly viewer: Viewer;
  display: DisplayOptions = { orbits: true, signals: true, labels: 'inView', spheres: false, circles: false, placeNames: true };

  private readonly satBillboards: BillboardCollection;
  private readonly satLabels: LabelCollection;
  private readonly orbitLines: PolylineCollection;
  private readonly signalLines: PolylineCollection;
  private readonly pulses: PointPrimitiveCollection;
  private readonly rangeCircles: PolylineCollection;
  private readonly rangeLabels: LabelCollection;
  private readonly satGraphics = new Map<string, SatelliteGraphics>();
  private readonly signalGraphics = new Map<string, SignalGraphics>();
  private readonly spheres: SphereGraphics[] = [];
  private readonly receiverEntity: Entity;
  private readonly fixEntity: Entity;
  private readonly errorEntity: Entity;
  private receiverPosition = Cartesian3.ZERO;
  private receiverGeodetic: Geodetic = { lat: 0, lon: 0, h: 0 };
  private imageryLayer: ImageryLayer | null = null;
  private placesLayer: ImageryLayer | null = null;
  private orbitEpoch: number | null = null;
  private circleUpdatedAt = 0;

  constructor(container: HTMLElement) {
    this.viewer = new Viewer(container, {
      baseLayer: ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
      ),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    const scene = this.viewer.scene;
    scene.globe.enableLighting = true;
    scene.screenSpaceCameraController.maximumZoomDistance = 2.5e8;
    scene.screenSpaceCameraController.minimumZoomDistance = 50;
    this.viewer.clock.shouldAnimate = true;

    const primitives = scene.primitives;
    this.orbitLines = primitives.add(new PolylineCollection());
    this.signalLines = primitives.add(new PolylineCollection());
    this.rangeCircles = primitives.add(new PolylineCollection());
    this.pulses = primitives.add(new PointPrimitiveCollection());
    this.satBillboards = primitives.add(new BillboardCollection());
    this.satLabels = primitives.add(new LabelCollection());
    this.rangeLabels = primitives.add(new LabelCollection());

    const labelStyle = {
      font: '500 12px "IBM Plex Sans", sans-serif',
      style: LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Color.fromCssColorString('#030612'),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
    this.receiverEntity = this.viewer.entities.add({
      position: Cartesian3.ZERO,
      billboard: {
        image: receiverGlyph('#b794ff'),
        verticalOrigin: VerticalOrigin.BOTTOM,
        width: 28,
        height: 36,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        ...labelStyle,
        text: 'Receiver',
        fillColor: RECEIVER_COLOR,
        pixelOffset: new Cartesian2(0, -46),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 4.5e7),
      },
    });
    this.fixEntity = this.viewer.entities.add({
      show: false,
      position: Cartesian3.ZERO,
      point: {
        pixelSize: 9,
        color: FIX_COLOR,
        outlineColor: Color.fromCssColorString('#030612'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: { ...labelStyle, text: '', fillColor: FIX_COLOR, pixelOffset: new Cartesian2(0, 20) },
    });
    this.errorEntity = this.viewer.entities.add({
      show: false,
      polyline: {
        positions: [],
        width: 2,
        arcType: ArcType.NONE,
        material: new PolylineDashMaterialProperty({ color: FIX_COLOR, dashLength: 10 }),
      },
    });
  }

  get time(): Date {
    return JulianDate.toDate(this.viewer.clock.currentTime);
  }

  set time(date: Date) {
    this.viewer.clock.currentTime = JulianDate.fromDate(date);
  }

  get rate(): number {
    return this.viewer.clock.multiplier;
  }

  set rate(multiplier: number) {
    this.viewer.clock.multiplier = multiplier;
  }

  get playing(): boolean {
    return this.viewer.clock.shouldAnimate;
  }

  set playing(value: boolean) {
    this.viewer.clock.shouldAnimate = value;
  }

  onFrame(callback: () => void): void {
    this.viewer.scene.preRender.addEventListener(callback);
  }

  setImagery(kind: Imagery): void {
    const layers = this.viewer.imageryLayers;
    if (this.imageryLayer) layers.remove(this.imageryLayer, true);
    this.imageryLayer = null;
    if (kind === 'satellite') {
      this.imageryLayer = layers.addImageryProvider(
        new UrlTemplateImageryProvider({ url: ESRI_IMAGERY, maximumLevel: 18, credit: 'Esri, Maxar, Earthstar Geographics' }),
        1,
      );
    }
    this.setPlaceNames(this.display.placeNames);
  }

  setPlaceNames(show: boolean): void {
    this.display.placeNames = show;
    const layers = this.viewer.imageryLayers;
    if (this.placesLayer) layers.remove(this.placesLayer, true);
    this.placesLayer = show
      ? layers.addImageryProvider(new UrlTemplateImageryProvider({ url: ESRI_PLACES, maximumLevel: 18, credit: 'Esri' }))
      : null;
  }

  setSatellites(satellites: Satellite[]): void {
    this.satBillboards.removeAll();
    this.satLabels.removeAll();
    this.orbitLines.removeAll();
    this.satGraphics.clear();
    const glyphs = new Map<string, string>();
    for (const sat of satellites) {
      const color = Color.fromCssColorString(sat.system.color);
      let glyph = glyphs.get(sat.system.color);
      if (!glyph) {
        glyph = satelliteGlyph(sat.system.color);
        glyphs.set(sat.system.color, glyph);
      }
      const billboard = this.satBillboards.add({
        position: Cartesian3.ZERO,
        image: glyph,
        width: 22,
        height: 22,
        id: { kind: 'satellite', id: sat.id },
        scaleByDistance: new NearFarScalar(3e6, 1.25, 1.5e8, 0.6),
      });
      const label = this.satLabels.add({
        position: Cartesian3.ZERO,
        text: sat.label,
        font: '500 11px "IBM Plex Mono", monospace',
        fillColor: color,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.fromCssColorString('#030612'),
        outlineWidth: 3,
        pixelOffset: new Cartesian2(13, -9),
        show: false,
      });
      const orbit = this.orbitLines.add({
        positions: [],
        width: 1,
        material: Material.fromType('Color', { color: color.withAlpha(0.22) }),
      });
      this.satGraphics.set(sat.id, { billboard, label, orbit, color });
    }
    this.orbitEpoch = null;
  }

  /**
   * Orbits are sampled once in the inertial frame and rotated into the Earth-fixed
   * frame every frame with Greenwich sidereal time, so each satellite sits on its orbit.
   */
  updateOrbits(satellites: Satellite[], enabled: Record<SystemId, boolean>, date: Date, gmst: number): void {
    const t = date.getTime();
    if (this.orbitEpoch === null || Math.abs(t - this.orbitEpoch) > 6 * 3600_000) {
      this.orbitEpoch = t;
      for (const sat of satellites) {
        const g = this.satGraphics.get(sat.id);
        if (g) g.orbit.positions = sat.sampleOrbitInertial(date).map(toCartesian);
      }
    }
    this.orbitLines.modelMatrix = Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(-gmst));
    for (const sat of satellites) {
      const g = this.satGraphics.get(sat.id);
      if (g) g.orbit.show = this.display.orbits && enabled[sat.system.id];
    }
  }

  updateSatellites(satellites: Satellite[], enabled: Record<SystemId, boolean>, observations: Map<string, Observation>): void {
    for (const sat of satellites) {
      const g = this.satGraphics.get(sat.id);
      if (!g) continue;
      const show = enabled[sat.system.id] && sat.valid;
      g.billboard.show = show;
      if (!show) {
        g.label.show = false;
        continue;
      }
      const p = toCartesian(sat.position);
      const o = observations.get(sat.id);
      g.billboard.position = p;
      g.billboard.color = o ? Color.WHITE : Color.WHITE.withAlpha(0.45);
      g.label.position = p;
      g.label.show = this.display.labels === 'all' || (this.display.labels === 'inView' && o !== undefined);
    }
  }

  setReceiver(position: Geodetic, name: string): void {
    this.receiverGeodetic = position;
    this.receiverPosition = toCartesian(geodeticToEcef(position));
    this.receiverEntity.position = new ConstantPositionProperty(this.receiverPosition);
    if (this.receiverEntity.label) this.receiverEntity.label.text = new ConstantProperty(name);
  }

  /** Lines from tracked satellites to the receiver; pulses travel down the lines in use. */
  updateSignals(observations: Observation[], wallMs: number, onlyUsed: boolean): void {
    const live = new Set<string>();
    if (this.display.signals) {
      for (const o of observations) {
        if (o.state === 'searching' || (onlyUsed && o.state !== 'used')) continue;
        live.add(o.sat.id);
        let g = this.signalGraphics.get(o.sat.id);
        const color = Color.fromCssColorString(o.sat.system.color);
        if (!g) {
          g = {
            line: this.signalLines.add({ positions: [], width: 1 }),
            pulses: [0, 1, 2].map(() => this.pulses.add({ pixelSize: 4, color })),
            phase: Math.random(),
            state: '',
          };
          this.signalGraphics.set(o.sat.id, g);
        }
        if (g.state !== o.state) {
          g.state = o.state;
          const used = o.state === 'used';
          g.line.material = used
            ? Material.fromType('Color', { color: color.withAlpha(0.75) })
            : Material.fromType('PolylineDash', { color: color.withAlpha(0.45), dashLength: 10 });
          g.line.width = used ? 1.6 : 1;
        }
        const s = toCartesian(o.sat.position);
        g.line.positions = [s, this.receiverPosition];
        for (let k = 0; k < g.pulses.length; k++) {
          const pulse = g.pulses[k]!;
          pulse.show = o.state === 'used';
          if (pulse.show) {
            const f = (wallMs / 2400 + g.phase + k / g.pulses.length) % 1;
            pulse.position = Cartesian3.lerp(s, this.receiverPosition, f, new Cartesian3());
          }
        }
      }
    }
    for (const [id, g] of this.signalGraphics) {
      if (live.has(id)) continue;
      this.signalLines.remove(g.line);
      for (const p of g.pulses) this.pulses.remove(p);
      this.signalGraphics.delete(id);
    }
  }

  /** Range spheres around satellites and the circles where they meet the Earth's surface. */
  updateRanges(ranges: RangeVisual[], wallMs: number): void {
    for (let i = 0; i < Math.max(ranges.length, this.spheres.length); i++) {
      const r = ranges[i];
      let sphere = this.spheres[i];
      if (r && (!sphere || sphere.color !== r.sat.system.color)) {
        if (sphere) this.destroySphere(sphere);
        sphere = this.createSphere(r.sat.system.color);
        this.spheres[i] = sphere;
      }
      if (!sphere) continue;
      const show = this.display.spheres && r !== undefined;
      sphere.fill.show = show;
      sphere.outline.show = show;
      if (!show || !r) continue;
      const m = Matrix4.fromTranslationRotationScale(
        new TranslationRotationScale(
          toCartesian(r.sat.position),
          Quaternion.IDENTITY,
          new Cartesian3(r.range, r.range, r.range),
        ),
      );
      sphere.fill.modelMatrix = m;
      sphere.outline.modelMatrix = m;
    }

    if (wallMs - this.circleUpdatedAt < 120) return;
    this.circleUpdatedAt = wallMs;
    this.rangeCircles.removeAll();
    this.rangeLabels.removeAll();
    if (!this.display.circles && !this.display.spheres) return;
    for (const r of ranges) {
      const color = Color.fromCssColorString(r.sat.system.color);
      this.rangeLabels.add({
        position: toCartesian(r.sat.position),
        text: `${r.sat.label}  ${Math.round(r.range / 1000).toLocaleString('en-US')} km`,
        font: '600 13px "IBM Plex Mono", monospace',
        fillColor: color,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.fromCssColorString('#030612'),
        outlineWidth: 4,
        pixelOffset: new Cartesian2(14, 14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      if (!this.display.circles) continue;
      const points = surfaceCircle(r.sat.position, r.range, this.receiverGeodetic.h);
      if (points.length > 2) {
        this.rangeCircles.add({
          positions: points,
          width: 2.5,
          material: Material.fromType('Color', { color }),
        });
      }
    }
  }

  setFix(fix: Fix | null, visible: boolean): void {
    const show = visible && fix !== null;
    this.fixEntity.show = show;
    this.errorEntity.show = show && fix !== null && fix.error.total > 25_000;
    if (!show || !fix) return;
    const p = toCartesian(fix.position);
    this.fixEntity.position = new ConstantPositionProperty(p);
    const far = fix.error.total > 1000;
    if (this.fixEntity.label) {
      const text = far ? `Computed position · ${Math.round(fix.error.total / 1000)} km off` : 'Computed position';
      this.fixEntity.label.text = new ConstantProperty(text);
      this.fixEntity.label.distanceDisplayCondition = new ConstantProperty(
        new DistanceDisplayCondition(0, far ? Number.MAX_VALUE : 2e6),
      );
    }
    if (this.errorEntity.show && this.errorEntity.polyline) {
      this.errorEntity.polyline.positions = new ConstantProperty([this.receiverPosition, p]);
    }
  }

  fly(view: CameraView, duration = 1.8): void {
    const target = new BoundingSphere(this.receiverPosition, 1);
    const camera = this.viewer.camera;
    const offsets: Record<CameraView, HeadingPitchRange> = {
      overview: new HeadingPitchRange(0, -Math.PI / 2, 1.05e8),
      spheres: new HeadingPitchRange(CesiumMath.toRadians(20), CesiumMath.toRadians(-25), 1.25e8),
      sky: new HeadingPitchRange(0, CesiumMath.toRadians(-48), 3.4e7),
      region: new HeadingPitchRange(0, CesiumMath.toRadians(-62), 4.5e6),
      street: new HeadingPitchRange(CesiumMath.toRadians(20), CesiumMath.toRadians(-35), 1800),
    };
    const sphere = view === 'spheres' ? new BoundingSphere(Cartesian3.ZERO, 1) : target;
    camera.flyToBoundingSphere(sphere, { offset: offsets[view], duration });
  }

  onPick(handler: (pick: { satelliteId: string | null; position: Geodetic | null }) => void): void {
    const events = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    events.setInputAction((e: { position: Cartesian2 }) => {
      const picked = this.viewer.scene.pick(e.position) as { id?: { kind?: string; id?: string } } | undefined;
      const ground = this.viewer.camera.pickEllipsoid(e.position);
      let position: Geodetic | null = null;
      if (ground) {
        const c = Cartographic.fromCartesian(ground);
        position = { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude), h: 0 };
      }
      handler({ satelliteId: picked?.id?.kind === 'satellite' ? (picked.id.id ?? null) : null, position });
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  private createSphere(cssColor: string): SphereGraphics {
    const color = Color.fromCssColorString(cssColor);
    const make = (geometry: EllipsoidGeometry | EllipsoidOutlineGeometry, alpha: number, closed: boolean): Primitive =>
      this.viewer.scene.primitives.add(
        new Primitive({
          geometryInstances: new GeometryInstance({
            geometry,
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(color.withAlpha(alpha)) },
          }),
          appearance: new PerInstanceColorAppearance({ translucent: true, flat: true, closed }),
          asynchronous: false,
          show: false,
        }),
      );
    const unit = new Cartesian3(1, 1, 1);
    return {
      fill: make(new EllipsoidGeometry({ radii: unit, stackPartitions: 64, slicePartitions: 64 }), 0.06, true),
      outline: make(new EllipsoidOutlineGeometry({ radii: unit, stackPartitions: 12, slicePartitions: 24 }), 0.28, false),
      color: cssColor,
    };
  }

  private destroySphere(sphere: SphereGraphics): void {
    this.viewer.scene.primitives.remove(sphere.fill);
    this.viewer.scene.primitives.remove(sphere.outline);
  }
}

/**
 * Points on the WGS-84 ellipsoid (at height h) whose distance from the satellite equals
 * `range`: the "you are somewhere on this line" circle. For each bearing around the
 * sub-satellite point the angular distance is found by bisection, since distance to
 * the satellite grows monotonically away from the sub-satellite point.
 */
function surfaceCircle(sat: Vec3, range: number, h: number, steps = 240): Cartesian3[] {
  const sub = ecefToGeodetic(sat);
  const lat0 = CesiumMath.toRadians(sub.lat);
  const lon0 = CesiumMath.toRadians(sub.lon);
  const pointAt = (angle: number, bearing: number): Vec3 => {
    const lat = Math.asin(Math.sin(lat0) * Math.cos(angle) + Math.cos(lat0) * Math.sin(angle) * Math.cos(bearing));
    const lon =
      lon0 +
      Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat0), Math.cos(angle) - Math.sin(lat0) * Math.sin(lat));
    return geodeticToEcef({ lat: CesiumMath.toDegrees(lat), lon: CesiumMath.toDegrees(lon), h });
  };
  const dist = (p: Vec3): number => Math.hypot(p[0] - sat[0], p[1] - sat[1], p[2] - sat[2]);
  const horizon = Math.acos(6_371_000 / Math.hypot(...sat));
  if (range < dist(pointAt(0, 0)) || range > dist(pointAt(horizon, 0)) * 1.02) return [];
  const points: Cartesian3[] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    let lo = 0;
    let hi = horizon;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (dist(pointAt(mid, bearing)) < range) lo = mid;
      else hi = mid;
    }
    const p = pointAt((lo + hi) / 2, bearing);
    const g = ecefToGeodetic(p);
    points.push(Cartesian3.fromDegrees(g.lon, g.lat, g.h + 2000));
  }
  return points;
}
