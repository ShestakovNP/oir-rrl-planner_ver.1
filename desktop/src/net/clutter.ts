/**
 * Buildings and forests along a link from OpenStreetMap (Overpass API, no key).
 *
 * One request per link: all buildings and forest areas in a narrow corridor
 * around the path. Heights: the OSM `height` tag when present, otherwise
 * `building:levels` × 3 m + 2 m (roof), otherwise a typical height for the
 * building type; forests get the height the user sets (default 20 m).
 * The result is merged into the terrain profile as the clutter column.
 */
import { OVERPASS_URL } from '../config';
import { intermediate, rad } from '../data/calc/geo';
import { parseOverpass, type ClutterObject, type ClutterOptions, type OsmEl } from '../data/calc/clutter';
export { applyClutter, parseOverpass, type ClutterObject, type ClutterOptions, type ClutterResult } from '../data/calc/clutter';
import { httpJson, NetworkError } from './http';

function corridor(lat1: number, lon1: number, lat2: number, lon2: number, halfWidthM: number): string {
  const n = 8, left: [number, number][] = [], right: [number, number][] = [];
  const mLat = 1 / 110574, mLon = 1 / (111320 * Math.cos(rad((lat1 + lat2) / 2)));
  for (let i = 0; i <= n; i++) {
    const [la, lo] = intermediate(lat1, lon1, lat2, lon2, i / n);
    const [la2, lo2] = intermediate(lat1, lon1, lat2, lon2, Math.min(1, i / n + 0.001));
    const [la0, lo0] = intermediate(lat1, lon1, lat2, lon2, Math.max(0, i / n - 0.001));
    const dx = (lo2 - lo0) / mLon, dy = (la2 - la0) / mLat, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    left.push([la + ny * halfWidthM * mLat, lo + nx * halfWidthM * mLon]);
    right.push([la - ny * halfWidthM * mLat, lo - nx * halfWidthM * mLon]);
  }
  return [...left, ...right.reverse()].map(([a, b]) => `${a.toFixed(6)} ${b.toFixed(6)}`).join(' ');
}

export async function fetchClutterObjects(lat1: number, lon1: number, lat2: number, lon2: number, opts: ClutterOptions): Promise<ClutterObject[]> {
  const poly = corridor(lat1, lon1, lat2, lon2, Math.max(40, (opts.halfWidth ?? 15) + 30));
  const q = `[out:json][timeout:60];(way["building"](poly:"${poly}");relation["building"](poly:"${poly}");way["landuse"="forest"](poly:"${poly}");way["natural"="wood"](poly:"${poly}");relation["landuse"="forest"](poly:"${poly}");relation["natural"="wood"](poly:"${poly}"););out tags geom;`;
  let data: { elements?: OsmEl[] };
  try {
    data = await httpJson<{ elements?: OsmEl[] }>(`${OVERPASS_URL}?data=${encodeURIComponent(q)}`, 90000);
  } catch (e) {
    const m = (e as Error).message || '';
    if (/429|504|503/.test(m)) throw new NetworkError('Сервис карты OpenStreetMap сейчас перегружен. Повторите через минуту.', false);
    throw e;
  }
  return parseOverpass(data, opts);
}

