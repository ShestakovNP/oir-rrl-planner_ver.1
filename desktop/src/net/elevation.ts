/**
 * Terrain profile from the public OpenTopoData API (SRTM 30 m), no key needed.
 * Limits of the public API: 100 points per request, 1 request per second,
 * 1000 requests per day — a profile costs 1–3 requests.
 */
import { ELEVATION_URL } from '../config';
import { intermediate, vincenty } from '../data/calc/geo';
import type { ProfilePoint } from '../data/types';
import { httpJson, NetworkError } from './http';

interface OtdResponse {
  status: string;
  error?: string;
  results?: { elevation: number | null }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchTerrainProfile(
  lat1: number, lon1: number, lat2: number, lon2: number,
  onProgress?: (done: number, total: number) => void
): Promise<ProfilePoint[]> {
  const D = vincenty(lat1, lon1, lat2, lon2).km;
  if (!(D > 0)) throw new Error('Объекты совпадают.');
  const n = Math.max(50, Math.min(300, Math.round((D * 1000) / 30) + 1));
  const pts: { d: number; lat: number; lon: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [la, lo] = intermediate(lat1, lon1, lat2, lon2, t);
    pts.push({ d: D * t, lat: la, lon: lo });
  }
  const out: ProfilePoint[] = [];
  const batches = Math.ceil(n / 100);
  for (let b = 0; b < batches; b++) {
    if (b > 0) await sleep(1100);
    const chunk = pts.slice(b * 100, b * 100 + 100);
    const loc = chunk.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const data = await httpJson<OtdResponse>(`${ELEVATION_URL}?locations=${encodeURIComponent(loc)}&interpolation=bilinear`, 30000);
    if (data.status !== 'OK' || !data.results) throw new NetworkError(data.error ? `Сервис высот: ${data.error}` : 'Сервис высот вернул ошибку.', false);
    data.results.forEach((r, i) => out.push({ d: +chunk[i].d.toFixed(4), g: Math.round((r.elevation ?? 0) * 10) / 10, c: 0 }));
    onProgress?.(b + 1, batches);
  }
  return out;
}
