/**
 * Reflection of the radio beam from a water surface on the path (two-ray model).
 *
 * The specular point is found on the effective-Earth geometry (radius k·R), then the
 * reflected wave is weighted by:
 *  - the Fresnel reflection coefficient of fresh water (Debye permittivity, ITU-R P.527 approach) —
 *    absorption in water, depends on polarization and grazing angle;
 *  - the divergence factor of a curved Earth (Kerr);
 *  - the roughness factor (Ament) — waves scatter the reflection at higher frequencies;
 *  - the antenna discrimination of the reflected ray (Gaussian main lobe).
 * The direct and reflected waves interfere; the result depends on the path difference,
 * which changes with refraction (k), so the worst case over k is reported too.
 * Pure functions: no UI.
 */
import type { Pol } from '../types';
import { EARTH_R_KM, beamwidth } from './physics';
import type { PathModel, Sample } from './link';

type Cx = [number, number];
const add = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: Cx, b: Cx): Cx => { const q = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / q, (a[1] * b[0] - a[0] * b[1]) / q]; };
const abs = (a: Cx) => Math.hypot(a[0], a[1]);
const sqrt = (a: Cx): Cx => { const r = abs(a), re = Math.sqrt((r + a[0]) / 2), im = Math.sqrt(Math.max(0, (r - a[0]) / 2)); return [re, a[1] < 0 ? -im : im]; };

/** Complex relative permittivity of fresh water at ~15 °C (single Debye relaxation), ε' − jε''. */
export function waterPermittivity(fGHz: number): Cx {
  const es = 81.8, einf = 5.2, frel = 14.5;
  const x = fGHz / frel;
  const re = einf + (es - einf) / (1 + x * x);
  const im = ((es - einf) * x) / (1 + x * x);
  return [re, -im];
}

/** Fresnel reflection coefficient of a flat water surface at grazing angle psi (rad). */
export function fresnelWater(fGHz: number, psi: number, pol: Pol): Cx {
  const eta = waterPermittivity(fGHz);
  const s = Math.sin(psi), c2 = Math.cos(psi) ** 2;
  const root = sqrt(sub(eta, [c2, 0]));
  if (pol === 'H') return div(sub([s, 0], root), add([s, 0], root));
  const es = mul(eta, [s, 0]);
  return div(sub(es, root), add(es, root));
}

export interface WaterReflection {
  /** Distance of the reflection point from A, km. */
  d: number;
  /** Water stretch that holds the point, km from A. */
  from: number;
  to: number;
  /** Grazing angle, mrad. */
  psi: number;
  /** Antenna heights above the reflecting plane, m. */
  h1: number;
  h2: number;
  /** |Γ| of water, divergence, roughness, antenna discrimination A/B (dB, ≤ 0). */
  gamma: number;
  divergence: number;
  roughness: number;
  discA: number;
  discB: number;
  /** Effective amplitude of the reflected wave relative to the direct one (0…1). */
  rho: number;
  /** Path difference reflected − direct, m. */
  delta: number;
  /** Interference loss at the nominal k, dB (negative = the reflection adds to the signal). */
  loss: number;
  /** Loss included in the received level (≥ 0), dB. */
  applied: number;
  /** Deepest interference fade over k from kMin to 3, dB, and the k where it happens. */
  worst: number;
  kWorst: number;
  /** Height step that moves an antenna from a minimum to a maximum of the interference pattern, m. */
  spacingA: number;
  spacingB: number;
  /** Reflection point is hidden from one of the antennas by terrain or clutter. */
  blocked: boolean;
}

/** Wave height (rms), m, for lakes and rivers in ordinary weather. */
export const WATER_ROUGHNESS_M = 0.1;
/** Tolerance around a water stretch for the reflection point, km (the reflecting zone is long along the path). */
const EDGE_KM = 0.05;

interface Runs { from: number; to: number; level: number }

/** Water stretches along the raw profile (heights without Earth bulge). */
export function waterRuns(P: PathModel): Runs[] {
  const runs: Runs[] = [];
  let cur: { from: number; to: number; g: number[] } | null = null;
  for (const p of P.pts) {
    if (p.t === 'w') {
      if (!cur) cur = { from: p.d, to: p.d, g: [] };
      cur.to = p.d; cur.g.push(p.g);
    } else if (cur) { runs.push({ from: cur.from, to: cur.to, level: Math.min(...cur.g) }); cur = null; }
  }
  if (cur) runs.push({ from: cur.from, to: cur.to, level: Math.min(...cur.g) });
  return runs;
}

/** Specular point over a plane at height hw on the k-Earth; null if none between the antennas. */
function specular(P: PathModel, k: number, hw: number) {
  const D = P.D, aE = k * EARTH_R_KM;
  const h1 = (d: number) => P.HA - hw - ((d * d) / (2 * aE)) * 1000;
  const h2 = (d: number) => P.HB - hw - (((D - d) * (D - d)) / (2 * aE)) * 1000;
  const f = (d: number) => h1(d) / d - h2(d) / (D - d);
  let lo = D * 1e-4, hi = D * (1 - 1e-4);
  if (!(f(lo) > 0 && f(hi) < 0)) return null;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  const d = (lo + hi) / 2, a = h1(d), b = h2(d);
  if (!(a > 0 && b > 0)) return null;
  return { d, h1: a, h2: b };
}

function interferenceAt(P: PathModel, k: number, fGHz: number, pol: Pol, hw: number, dishA: number, dishB: number) {
  const sp = specular(P, k, hw);
  if (!sp) return null;
  const D = P.D, d1 = sp.d, d2 = D - sp.d, lam = 0.299792458 / fGHz;
  const psi = sp.h1 / (d1 * 1000);
  // Path difference for the two-ray model over a curved Earth, with effective heights.
  const delta = (2 * sp.h1 * sp.h2) / (D * 1000);
  const G = fresnelWater(fGHz, psi, pol);
  const divergence = 1 / Math.sqrt(1 + (2 * d1 * d2) / (k * EARTH_R_KM * D * Math.max(psi, 1e-6)));
  const g = (2 * Math.PI * WATER_ROUGHNESS_M * Math.sin(psi)) / lam;
  const roughness = Math.exp(-2 * g * g);
  // Angle between direct and reflected rays at each antenna ≈ grazing angle + elevation of the other end.
  const thA = Math.abs(Math.atan((sp.h2 - sp.h1) / (D * 1000)) + psi) * (180 / Math.PI);
  const thB = Math.abs(Math.atan((sp.h1 - sp.h2) / (D * 1000)) + psi) * (180 / Math.PI);
  const disc = (th: number, dish: number) => {
    const bw = beamwidth(dish, fGHz);
    return Number.isFinite(bw) && bw > 0 ? Math.max(-30, -12 * (th / bw) ** 2) : 0;
  };
  const discA = disc(thA, dishA), discB = disc(thB, dishB);
  const rho = Math.min(1, abs(G) * divergence * roughness * Math.pow(10, (discA + discB) / 20));
  const phase = Math.atan2(G[1], G[0]) - (2 * Math.PI * delta) / lam;
  const F = Math.hypot(1 + rho * Math.cos(phase), rho * Math.sin(phase));
  return { ...sp, psi, delta, gamma: abs(G), divergence, roughness, discA, discB, rho, loss: -20 * Math.log10(Math.max(F, 1e-4)), lam };
}

/** True if terrain or clutter cuts the ray A → point or point → B (geometry samples at the same k). */
function hidden(s: Sample[], P: PathModel, dR: number, gR: number): boolean {
  const D = P.D;
  for (const o of s) {
    if (o.d <= D * 0.002 || o.d >= D * 0.998 || Math.abs(o.d - dR) < 0.02) continue;
    const ray = o.d < dR ? P.HA + ((gR - P.HA) * o.d) / dR : gR + ((P.HB - gR) * (o.d - dR)) / (D - dR);
    if (o.top > ray + 0.5 && o.t !== 'w') return true;
  }
  return false;
}

/**
 * Two-ray water reflection for one channel; null when there is no water on the path
 * or the reflection point does not fall on water.
 */
export function waterReflection(
  P: PathModel, s: Sample[], k: number, kMin: number, fGHz: number, pol: Pol, dishA: number, dishB: number
): WaterReflection | null {
  const runs = waterRuns(P);
  if (!runs.length || !(P.D > 0) || !(fGHz > 0)) return null;
  for (const run of runs) {
    const r = interferenceAt(P, k, fGHz, pol, run.level, dishA, dishB);
    if (!r || r.d < run.from - EDGE_KM || r.d > run.to + EDGE_KM) continue;
    const bulge = ((r.d * (P.D - r.d)) / (2 * k * EARTH_R_KM)) * 1000;
    const blocked = hidden(s, P, r.d, run.level + bulge);
    let worst = blocked ? 0 : r.loss, kWorst = k;
    if (!blocked) {
      const k0 = Math.min(kMin, k), k1 = 3;
      for (let i = 0; i <= 200; i++) {
        const kk = k0 + ((k1 - k0) * i) / 200;
        const q = interferenceAt(P, kk, fGHz, pol, run.level, dishA, dishB);
        if (q && q.d >= run.from - EDGE_KM && q.d <= run.to + EDGE_KM && q.loss > worst) { worst = q.loss; kWorst = kk; }
      }
    }
    const lam = r.lam, Dm = P.D * 1000;
    return {
      d: r.d, from: run.from, to: run.to, psi: r.psi * 1000, h1: r.h1, h2: r.h2, gamma: r.gamma, divergence: r.divergence,
      roughness: r.roughness, discA: r.discA, discB: r.discB, rho: blocked ? 0 : r.rho, delta: r.delta,
      loss: blocked ? 0 : r.loss, applied: blocked ? 0 : Math.max(0, r.loss), worst, kWorst,
      spacingA: (lam * Dm) / (4 * r.h2), spacingB: (lam * Dm) / (4 * r.h1), blocked
    };
  }
  return null;
}

/** Share of the path length over water, 0…1. */
export function waterShare(P: PathModel): number {
  return P.D > 0 ? waterRuns(P).reduce((a, r) => a + (r.to - r.from), 0) / P.D : 0;
}
