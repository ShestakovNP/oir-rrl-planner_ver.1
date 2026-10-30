/** Place search: coordinates are parsed locally; names go to OSM Nominatim (1 request per user action). */
import { NOMINATIM_URL } from '../config';
import { parseCoord } from '../data/calc/geo';
import { httpJson } from './http';

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

interface NominatimItem { display_name: string; lat: string; lon: string; type?: string; name?: string }

/** "56.548, 84.070" or "56°32'55\" 84°04'13\"" → a place without any network call. */
export function parseLatLon(q: string): Place | null {
  const parts = q.split(/[;,]\s+|\s{2,}|\t|,(?=\s*-?\d)/).map((s) => s.trim()).filter(Boolean);
  let a: string | undefined, b: string | undefined;
  if (parts.length === 2) [a, b] = parts;
  else {
    const m = q.trim().match(/^(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)$/);
    if (m) [a, b] = [m[1], m[2]];
    const dms = q.trim().match(/^(.*?\d+\s*°[^°]*?)\s+(\d+\s*°.*)$/);
    if (!m && dms) [a, b] = [dms[1], dms[2]];
  }
  if (!a || !b) return null;
  const lat = parseCoord(a), lon = parseCoord(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: 'Точка по координатам', detail: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
}

export async function searchPlaces(q: string): Promise<Place[]> {
  const coord = parseLatLon(q);
  if (coord) return [coord];
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=6&accept-language=ru&q=${encodeURIComponent(q)}`;
  const items = await httpJson<NominatimItem[]>(url, 15000);
  return items.map((it) => {
    const [first, ...rest] = it.display_name.split(', ');
    return { name: it.name || first, detail: rest.slice(0, 3).join(', '), lat: parseFloat(it.lat), lon: parseFloat(it.lon) };
  });
}
