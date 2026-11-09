/**
 * Trees along the path from satellite data, for places OpenStreetMap does not map:
 *  1. Global canopy height map of Meta and World Resources Institute (≈1 m pixels, heights of
 *     trees in metres; open data on AWS, Cloud-Optimized GeoTIFF tiles by quadkey, EPSG:3857).
 *  2. If it is unreachable: ESA WorldCover 2021 (10 m land cover, class 10 «tree cover»); the
 *     height of such trees is the forest height set by the user.
 * Pure: the caller passes a function that opens a COG by URL.
 */
import { CogReader } from './cog';
import { intermediate } from './calc/geo';

export const CHM_URL = (qk: string) => `https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/${qk}.tif`;
export const WORLDCOVER_URL = (name: string) => `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
/** Trees lower than this are not counted (bushes, noise of the model). */
export const MIN_TREE_M = 3;
const MAX_TREE_M = 50;

export type OpenCog = (url: string) => Promise<CogReader | null>;

export interface Canopy {
  source: 'chm' | 'worldcover';
  /** Clutter height along the path, metres, at fractions t of the path. */
  heightAt(t: number): number;
  /** Share of the path under trees, 0..1, mean and maximum tree height, m. */
  share: number;
  mean: number;
  max: number;
  /** Why the canopy height map was not used (WorldCover fallback). */
  chmError?: string;
}

const R = 6378137;
export const mercator = (lat: number, lon: number): [number, number] => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];

/** Bing/Web quadkey of the tile containing the point at zoom z. */
export function quadkey(lat: number, lon: number, z = 9): string {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const s = Math.sin(lat * Math.PI / 180);
  const y = Math.min(n - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)));
  let q = '';
  for (let i = z; i > 0; i--) { const m = 1 << (i - 1); q += String((x & m ? 1 : 0) + (y & m ? 2 : 0)); }
  return q;
}

/** ESA WorldCover tile name: 3°×3° by the lower-left corner, e.g. N54E036. */
export function worldCoverTile(lat: number, lon: number): string {
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lon / 3) * 3;
  return `${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}`;
}

interface Sample { t: number; lat: number; lon: number }

/** Points every `stepM` along the path plus two points `sideM` to each side (trees across the beam). */
function samples(lat1: number, lon1: number, lat2: number, lon2: number, dKm: number, stepM: number, sideM: number): Sample[][] {
  const n = Math.max(2, Math.round((dKm * 1000) / stepM) + 1);
  const kLat = 1 / 110574, kLon = 1 / (111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180));
  // unit vector across the path in degrees per metre
  const dx = (lon2 - lon1) / kLon, dy = (lat2 - lat1) / kLat, L = Math.hypot(dx, dy) || 1;
  const ux = -dy / L, uy = dx / L;
  const out: Sample[][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [la, lo] = intermediate(lat1, lon1, lat2, lon2, t);
    out.push([-1, 0, 1].map((s) => ({ t, lat: la + s * sideM * uy * kLat, lon: lo + s * sideM * ux * kLon })));
  }
  return out;
}

/** Values of a set of points from tiled COGs (one file per key), grouped by file. */
async function readTiled(open: OpenCog, pts: Sample[], keyOf: (s: Sample) => string, urlOf: (k: string) => string,
  pixelOf: (r: CogReader, s: Sample) => [number, number], onProgress?: (f: number) => void): Promise<(number | null)[]> {
  const groups = new Map<string, number[]>();
  pts.forEach((s, i) => { const k = keyOf(s); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); });
  const out: (number | null)[] = new Array(pts.length).fill(null);
  let gi = 0;
  for (const [k, idx] of groups) {
    const r = await open(urlOf(k));
    if (r) {
      const vals = await r.pixels(idx.map((i) => pixelOf(r, pts[i])), (d, t) => onProgress?.((gi + d / t) / groups.size));
      idx.forEach((i, j) => { out[i] = vals[j]; });
    }
    gi++;
    onProgress?.(gi / groups.size);
  }
  return out;
}

function summarise(source: Canopy['source'], hs: number[]): Canopy {
  const trees = hs.filter((h) => h > 0);
  const n = hs.length;
  return {
    source,
    heightAt: (t: number) => hs[Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))] ?? 0,
    share: n ? trees.length / n : 0,
    mean: trees.length ? trees.reduce((a, b) => a + b, 0) / trees.length : 0,
    max: trees.length ? Math.max(...trees) : 0
  };
}

/** At most this many points along the path are read from the canopy height map. */
export const CHM_MAX_POINTS = 1500;
/** Trees within this distance of the path axis (ground metres, each side) are counted. */
const CHM_SIDE_M = 8;
/** Canopy height map is given up after this time and WorldCover is used instead, ms. */
export const CHM_TIMEOUT_MS = 150_000;

/**
 * Canopy height map (Meta/WRI). The files are not cloud-optimized: every image row (≈1 m) is a separate
 * compressed strip of the whole 78-km tile, so each new row is one more download. Hence: one point every
 * 10–30 m along the path (≤ 1500 points), and trees beside the point are read along the same row (±8 m),
 * which costs nothing. The height at a point is the 80th percentile of that window, so a single noisy pixel
 * does not make a tree and a gap in the crowns is kept.
 */
export async function canopyFromChm(open: OpenCog, lat1: number, lon1: number, lat2: number, lon2: number, dKm: number, onProgress?: (f: number) => void): Promise<Canopy> {
  const L = dKm * 1000;
  const n = Math.max(2, Math.min(CHM_MAX_POINTS, Math.ceil(L / 10)) + 1);
  const cosLat = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const pts: Sample[] = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); const [lat, lon] = intermediate(lat1, lon1, lat2, lon2, t); pts.push({ t, lat, lon }); }
  const groups = new Map<string, number[]>();
  pts.forEach((p, i) => { const k = quadkey(p.lat, p.lon, 9); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); });
  const hs: number[] = new Array(n).fill(0);
  let seen = false, gi = 0;
  for (const [k, idx] of groups) {
    const r = await open(CHM_URL(k));
    if (r) {
      // the map is in Web Mercator metres; if a file comes in degrees, use them as they are
      const deg = Math.abs(r.info.x0) <= 180 && Math.abs(r.info.y0) <= 90 && r.info.sx < 0.01;
      const groundPerPx = deg ? r.info.sx * 111320 * cosLat : r.info.sx * cosLat;
      const w = Math.max(1, Math.min(60, Math.round(CHM_SIDE_M / groundPerPx)));
      const px: [number, number][] = [];
      for (const i of idx) {
        const [x, y] = deg ? [pts[i].lon, pts[i].lat] : mercator(pts[i].lat, pts[i].lon);
        const c = Math.floor((x - r.info.x0) / r.info.sx), row = Math.floor((r.info.y0 - y) / r.info.sy);
        for (let j = -w; j <= w; j++) px.push([c + j, row]);
      }
      const vals = await r.pixels(px, (d, t) => onProgress?.((gi + d / t) / groups.size));
      const per = 2 * w + 1;
      idx.forEach((i, m) => {
        const v: number[] = [];
        for (let j = 0; j < per; j++) {
          const x = vals[m * per + j];
          // 255 in a byte map is "no data", not a 255-m tree
          if (x != null && Number.isFinite(x) && x < 255) v.push(Math.min(MAX_TREE_M, Math.max(0, x)));
        }
        if (!v.length) return;
        seen = true;
        v.sort((a, b) => a - b);
        const p80 = v[Math.min(v.length - 1, Math.floor(v.length * 0.8))];
        hs[i] = p80 >= MIN_TREE_M ? Math.round(p80) : 0;
      });
    }
    gi++;
    onProgress?.(gi / groups.size);
  }
  if (!seen) throw new Error('Карта высот деревьев для этого места недоступна.');
  return summarise('chm', hs);
}

/** WorldCover: tree cover (class 10) at ≥ half of the samples of a 20 m bin → forest of the set height. */
export async function canopyFromWorldCover(open: OpenCog, lat1: number, lon1: number, lat2: number, lon2: number, dKm: number, forestHeight: number, onProgress?: (f: number) => void): Promise<Canopy> {
  const rows = samples(lat1, lon1, lat2, lon2, dKm, 10, 6);
  const flat = rows.flat();
  const vals = await readTiled(open, flat, (s) => worldCoverTile(s.lat, s.lon), WORLDCOVER_URL,
    (r, s) => [(s.lon - r.info.x0) / r.info.sx, (r.info.y0 - s.lat) / r.info.sy], onProgress);
  if (!vals.some((x) => x != null)) throw new Error('Карта растительности для этого места недоступна.');
  const per = rows.length, hs: number[] = [];
  for (let i = 0; i < per; i++) {
    let tree = 0, all = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(per - 1, i + 1); j++) for (let s = 0; s < 3; s++) { const x = vals[j * 3 + s]; if (x != null) { all++; if (x === 10) tree++; } }
    hs.push(all && tree * 2 >= all ? forestHeight : 0);
  }
  return summarise('worldcover', hs);
}

/** Canopy height map first, land cover if it is not reachable. */
export async function satelliteCanopy(open: OpenCog, lat1: number, lon1: number, lat2: number, lon2: number, dKm: number, forestHeight: number, onProgress?: (f: number) => void, timeoutMs = CHM_TIMEOUT_MS): Promise<Canopy> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`не загрузилась за ${Math.round(timeoutMs / 60000 * 10) / 10} мин (медленная сеть)`.replace('.', ','))), timeoutMs); });
    try { return await Promise.race([canopyFromChm(open, lat1, lon1, lat2, lon2, dKm, onProgress), late]); }
    finally { clearTimeout(timer); }
  } catch (e) {
    console.warn('canopy height map failed, trying WorldCover', e);
    const c = await canopyFromWorldCover(open, lat1, lon1, lat2, lon2, dKm, forestHeight, onProgress);
    return { ...c, chmError: e instanceof Error ? e.message : String(e) };
  }
}

export function canopyText(c: Canopy, forestHeight: number): string {
  const pct = Math.round(c.share * 100);
  if (c.source === 'chm') {
    return pct
      ? `По спутниковой карте высот деревьев (Meta и WRI, пиксель ≈1 м) лес занимает ${pct} % длины пролёта: средняя высота деревьев ${Math.round(c.mean)} м, наибольшая ${Math.round(c.max)} м.`
      : 'По спутниковой карте высот деревьев (Meta и WRI) деревьев выше 3 м на трассе нет.';
  }
  const why = c.chmError ? ` Карта высот деревьев не открылась: ${c.chmError.replace(/\.$/, '')}.` : '';
  return (pct
    ? `По спутниковой карте растительности ESA WorldCover (пиксель 10 м) лес занимает ${pct} % длины пролёта; высота принята ${forestHeight} м (карта высот деревьев была недоступна).`
    : 'По спутниковой карте растительности ESA WorldCover леса на трассе нет.') + why;
}
