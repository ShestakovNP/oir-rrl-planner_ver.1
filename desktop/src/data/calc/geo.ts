/** Geodesy: coordinate parsing, WGS-84 distance and azimuths (Vincenty). */

export const rad = (x: number) => (x * Math.PI) / 180;
export const deg = (x: number) => (x * 180) / Math.PI;
export const n360 = (x: number) => ((x % 360) + 360) % 360;

/**
 * Accepts "55.6", "55,6", "55°36'00\"", "55 36 00", "N55°36'", "-37.5", "37.5 W" / "з.д.".
 * Returns NaN when nothing numeric is found.
 */
export function parseCoord(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim().toUpperCase();
  if (!s) return NaN;
  const nums = (s.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(',', '.')));
  if (!nums.length) return NaN;
  const v = nums[0] + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
  const negative = /^-/.test(s) || /[SWЮ]|З\.?\s*Д|Ю\.?\s*Ш/.test(s);
  return negative ? -v : v;
}

export function formatDms(v: number, isLat: boolean): string {
  if (!Number.isFinite(v)) return '—';
  const hemi = isLat ? (v >= 0 ? 'N' : 'S') : v >= 0 ? 'E' : 'W';
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFull = (a - d) * 60;
  const m = Math.floor(mFull);
  const sec = (mFull - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(2).padStart(5, '0')}"${hemi}`;
}

export interface Geodesic {
  km: number;
  az1: number;
  az2: number;
}

/** Vincenty inverse problem on WGS-84. az1: A→B, az2: B→A (both true azimuths). */
export function vincenty(la1: number, lo1: number, la2: number, lo2: number): Geodesic {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const L = rad(lo2 - lo1);
  const U1 = Math.atan((1 - f) * Math.tan(rad(la1)));
  const U2 = Math.atan((1 - f) * Math.tan(rad(la2)));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, lamPrev: number, sS = 0, cS = 0, sig = 0, sA = 0, c2A = 0, c2m = 0, it = 0;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sS = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    if (sS === 0) return { km: 0, az1: 0, az2: 0 };
    cS = sU1 * sU2 + cU1 * cU2 * cl;
    sig = Math.atan2(sS, cS);
    sA = (cU1 * cU2 * sl) / sS;
    c2A = 1 - sA * sA;
    c2m = c2A ? cS - (2 * sU1 * sU2) / c2A : 0;
    const C = (f / 16) * c2A * (4 + f * (4 - 3 * c2A));
    lamPrev = lam;
    lam = L + (1 - C) * f * sA * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
  } while (Math.abs(lam - lamPrev) > 1e-12 && ++it < 200);
  const u2 = (c2A * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2m + (B / 4) * (cS * (-1 + 2 * c2m * c2m) - (B / 6) * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
  const sl = Math.sin(lam), cl = Math.cos(lam);
  return {
    km: (b * A * (sig - dS)) / 1000,
    az1: n360(deg(Math.atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl))),
    az2: n360(deg(Math.atan2(cU1 * sl, -sU1 * cU2 + cU1 * sU2 * cl)) + 180)
  };
}

/** Point at fraction t (0..1) along the great circle A→B (spherical; fine for profile sampling). */
export function intermediate(la1: number, lo1: number, la2: number, lo2: number, t: number): [number, number] {
  const p1 = rad(la1), l1 = rad(lo1), p2 = rad(la2), l2 = rad(lo2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [la1, lo1];
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))];
}
