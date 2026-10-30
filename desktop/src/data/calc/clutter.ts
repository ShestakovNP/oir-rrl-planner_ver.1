/**
 * Merging buildings, forest and water surfaces into the terrain profile. Pure
 * geometry, no network: the objects come from net/clutter.ts (OpenStreetMap).
 */
import { intermediate, rad, vincenty } from './geo';
import type { ProfilePoint } from '../types';

export interface ClutterObject {
  kind: 'building' | 'forest' | 'water';
  height: number;
  /** true when the height came from OSM tags, false when estimated. */
  measured: boolean;
  ring: [number, number][];
  bbox: [number, number, number, number];
  /** Rivers mapped as a centre line: the ring is a polyline and `width` is the river width, m. */
  line?: boolean;
  width?: number;
}

export interface ClutterOptions {
  forestHeight: number;
  /** Corridor half-width, m: obstacles this close to the path centre line count. */
  halfWidth?: number;
}

export interface ClutterResult {
  profile: ProfilePoint[];
  buildings: number;
  buildingsMeasured: number;
  forests: number;
  waters: number;
  /** Share of the path length over water, 0..1. */
  waterShare: number;
  /** Share of the path length covered by obstacles, 0..1. */
  coverage: number;
  summary: string;
}

/* local metric frame around the link, accurate enough for a corridor of tens of metres */
function frame(lat0: number, lon0: number) {
  const kx = 111320 * Math.cos(rad(lat0)), ky = 110574;
  return (lat: number, lon: number): [number, number] => [(lon - lon0) * kx, (lat - lat0) * ky];
}

function inside(p: [number, number], poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToPoly(p: [number, number], poly: [number, number][], closed = true): number {
  let best = Infinity;
  for (let i = closed ? 0 : 1, j = closed ? poly.length - 1 : 0; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}

/**
 * Samples obstacles every ~10 m along the centre line and writes the clutter
 * height into the profile. Edges of obstacles become profile points, so the
 * chart and the calculation see sharp building and forest boundaries.
 */
export function applyClutter(
  profile: ProfilePoint[], lat1: number, lon1: number, lat2: number, lon2: number, objs: ClutterObject[], opts: ClutterOptions
): ClutterResult {
  const D = vincenty(lat1, lon1, lat2, lon2).km;
  const toXY = frame((lat1 + lat2) / 2, (lon1 + lon2) / 2);
  const shapes = objs.map((o) => ({ ...o, xy: o.ring.map(([a, b]) => toXY(a, b)) }));
  const half = opts.halfWidth ?? 15;
  const stepKm = Math.max(0.005, Math.min(0.02, D / 3000));
  const n = Math.max(2, Math.round(D / stepKm) + 1);
  const cAt: number[] = [], tAt: ('b' | 'f' | 'w' | undefined)[] = [];
  const usedB = new Set<number>(), usedF = new Set<number>(), usedW = new Set<number>();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [la, lo] = intermediate(lat1, lon1, lat2, lon2, t);
    const p = toXY(la, lo);
    let c = 0, kind: 'b' | 'f' | 'w' | undefined;
    shapes.forEach((s, k) => {
      if (la < s.bbox[0] - 0.001 || la > s.bbox[2] + 0.001 || lo < s.bbox[1] - 0.002 || lo > s.bbox[3] + 0.002) return;
      let hit: boolean;
      if (s.line) hit = distToPoly(p, s.xy, false) <= (s.width ?? 30) / 2;
      else hit = inside(p, s.xy) || (s.kind === 'building' && distToPoly(p, s.xy) <= half);
      if (!hit) return;
      if (s.kind === 'water') { usedW.add(k); if (!kind) kind = 'w'; return; }
      (s.kind === 'building' ? usedB : usedF).add(k);
      if (s.height > c) { c = s.height; kind = s.kind === 'building' ? 'b' : 'f'; }
    });
    // keep 50 m around each antenna free: the masts themselves stand there
    const dKm = t * D;
    const nearMast = dKm < 0.05 || dKm > D - 0.05;
    cAt.push(nearMast ? 0 : c);
    tAt.push(nearMast && kind !== 'w' ? undefined : kind);
  }
  // ground from the existing profile (scaled to the geodesic length)
  const base = profile.length >= 2 ? profile : [{ d: 0, g: 0, c: 0 }, { d: D, g: 0, c: 0 }];
  const Dp = base[base.length - 1].d || D;
  const gAt = (d: number) => {
    const x = (d / D) * Dp;
    if (x <= base[0].d) return base[0].g;
    for (let i = 1; i < base.length; i++) if (x <= base[i].d) { const a = base[i - 1], b = base[i], f = (x - a.d) / (b.d - a.d || 1); return a.g + f * (b.g - a.g); }
    return base[base.length - 1].g;
  };
  const out: ProfilePoint[] = [];
  const push = (d: number, c: number, t: 'b' | 'f' | 'w' | undefined) => {
    const p: ProfilePoint = { d: +d.toFixed(4), g: Math.round(gAt(d) * 10) / 10, c: Math.round(c * 10) / 10 };
    if (t) p.t = t;
    out.push(p);
  };
  const terrainD = new Set(base.map((p) => +((p.d / Dp) * D).toFixed(4)));
  let covered = 0, wet = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * D;
    if (cAt[i] > 0) covered++;
    if (tAt[i] === 'w') wet++;
    const changed = i === 0 || i === n - 1 || cAt[i] !== cAt[i - 1] || tAt[i] !== tAt[i - 1];
    if (changed && i > 0) push(Math.max(0, d - 0.001), cAt[i - 1], tAt[i - 1]);
    if (changed || terrainD.has(+d.toFixed(4)) || i % Math.max(1, Math.round(n / 300)) === 0) push(d, cAt[i], tAt[i]);
  }
  const dedup = out.filter((p, i) => i === 0 || p.d > out[i - 1].d);
  const buildings = usedB.size, forests = usedF.size, waters = usedW.size;
  const waterShare = wet / n;
  const measured = [...usedB].filter((k) => shapes[k].measured).length;
  const coverage = covered / n;
  const parts: string[] = [];
  if (buildings) parts.push(`зданий: ${buildings}${buildings ? ` (высота из OSM у ${measured}, у остальных — типовая по виду здания)` : ''}`);
  if (forests) parts.push(`лесных массивов: ${forests} (высота леса ${opts.forestHeight} м)`);
  if (waters) parts.push(`водных объектов: ${waters} (${Math.round(waterShare * 100)} % длины пролёта над водой)`);
  const summary = parts.length
    ? `На трассе найдено ${parts.join(', ')}.${buildings || forests ? ` Здания и лес занимают ${Math.round(coverage * 100)} % длины пролёта.` : ''}`
    : 'На трассе по данным OpenStreetMap нет зданий, лесных массивов и водоёмов.';
  return { profile: dedup, buildings, buildingsMeasured: measured, forests, waters, waterShare, coverage, summary };
}

/* ---------- OpenStreetMap (Overpass) answer parsing ---------- */

interface OsmGeom { lat: number; lon: number }
export interface OsmEl {
  type: 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: OsmGeom[];
  members?: { role: string; geometry?: OsmGeom[] }[];
}

const TYPE_HEIGHT: Record<string, number> = {
  house: 7, detached: 7, semidetached_house: 7, bungalow: 5, cabin: 4, hut: 3, shed: 3, garage: 3, garages: 3, kiosk: 3,
  barn: 7, farm_auxiliary: 6, greenhouse: 4, roof: 5, service: 4, toilets: 3,
  residential: 15, apartments: 18, dormitory: 15, hotel: 18, office: 15, commercial: 12, retail: 8, supermarket: 8,
  industrial: 10, warehouse: 10, hangar: 12, school: 12, kindergarten: 8, hospital: 15, university: 15, church: 20, cathedral: 30,
  public: 12, civic: 12, government: 12, transportation: 10, train_station: 12, construction: 10
};

const num = (s: string | undefined) => {
  if (!s) return NaN;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
};

function buildingHeight(tags: Record<string, string>): { h: number; measured: boolean } {
  const h = num(tags.height) || num(tags['building:height']);
  if (h > 0) return { h, measured: true };
  const lv = num(tags['building:levels']);
  if (lv > 0) return { h: lv * 3 + 2, measured: true };
  return { h: TYPE_HEIGHT[tags.building] ?? 8, measured: false };
}

/** Joins open outer ways of a multipolygon into rings. */
function rings(el: OsmEl): [number, number][][] {
  if (el.type === 'way' && el.geometry && el.geometry.length >= 3) return [el.geometry.map((g) => [g.lat, g.lon])];
  const parts = (el.members || []).filter((m) => m.role === 'outer' && m.geometry && m.geometry.length >= 2).map((m) => m.geometry!.map((g) => [g.lat, g.lon] as [number, number]));
  const out: [number, number][][] = [];
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const pool = parts.slice();
  while (pool.length) {
    let ring = pool.shift()!;
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i], end = ring[ring.length - 1];
        if (same(p[0], end)) { ring = ring.concat(p.slice(1)); pool.splice(i, 1); grown = true; break; }
        if (same(p[p.length - 1], end)) { ring = ring.concat(p.slice(0, -1).reverse()); pool.splice(i, 1); grown = true; break; }
      }
    }
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}


/** Converts an Overpass JSON answer into obstacles with heights. */
export function parseOverpass(data: { elements?: OsmEl[] }, opts: ClutterOptions): ClutterObject[] {
  const objs: ClutterObject[] = [];
  const bbox = (ring: [number, number][]): [number, number, number, number] => {
    const lats = ring.map((p) => p[0]), lons = ring.map((p) => p[1]);
    return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
  };
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const isBuilding = !!tags.building && tags.building !== 'no';
    const isForest = tags.landuse === 'forest' || tags.natural === 'wood';
    const isWaterArea = tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin';
    const isRiverLine = el.type === 'way' && (tags.waterway === 'river' || tags.waterway === 'canal');
    if (isRiverLine && el.geometry && el.geometry.length >= 2) {
      // a river drawn as a line: use its width tag, otherwise a typical width
      const ring = el.geometry.map((g) => [g.lat, g.lon] as [number, number]);
      const w = num(tags.width) || (tags.waterway === 'canal' ? 15 : 40);
      objs.push({ kind: 'water', height: 0, measured: false, ring, bbox: bbox(ring), line: true, width: w });
      continue;
    }
    if (!isBuilding && !isForest && !isWaterArea) continue;
    const kind: ClutterObject['kind'] = isBuilding ? 'building' : isForest ? 'forest' : 'water';
    const hh = isBuilding ? buildingHeight(tags) : isForest ? { h: opts.forestHeight, measured: false } : { h: 0, measured: false };
    for (const ring of rings(el)) objs.push({ kind, height: hh.h, measured: hh.measured, ring, bbox: bbox(ring) });
  }
  return objs;
}

