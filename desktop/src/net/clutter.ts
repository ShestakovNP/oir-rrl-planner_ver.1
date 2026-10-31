/**
 * Buildings, forests and water along a link from OpenStreetMap (Overpass API, no key).
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
  // Geometry is cut to a box around the path: a city river or a big forest comes as its nearby
  // boundary only, which keeps the answer small; crossings are counted along the path.
  const pad = 0.03, s = Math.min(lat1, lat2) - pad, n = Math.max(lat1, lat2) + pad;
  const padLon = pad / Math.max(0.2, Math.cos(rad((lat1 + lat2) / 2)));
  const w = Math.min(lon1, lon2) - padLon, e = Math.max(lon1, lon2) + padLon;
  const f = (sel: string) => `${sel}(poly:"${poly}");`;
  const q = `[out:json][timeout:90][maxsize:268435456];(` +
    f('way["building"]') + f('relation["building"]') +
    f('way["landuse"="forest"]') + f('way["natural"="wood"]') + f('relation["landuse"="forest"]') + f('relation["natural"="wood"]') +
    f('way["natural"~"^(water|bay)$"]') + f('relation["natural"~"^(water|bay)$"]') +
    f('way["waterway"~"^(riverbank|dock)$"]') + f('relation["waterway"="riverbank"]') +
    f('way["landuse"~"^(reservoir|basin)$"]') + f('relation["landuse"~"^(reservoir|basin)$"]') +
    f('way["waterway"~"^(river|canal)$"]') +
    `);out tags geom(${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});`;
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

