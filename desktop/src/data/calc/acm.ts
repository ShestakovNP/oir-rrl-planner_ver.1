/**
 * Adaptive modulation (ACM) and E-band rain, after I.V. Stepanets, «Исследование и разработка
 * методов расчёта пропускной способности радиорелейных линий с адаптивной модуляцией»
 * (dissertation, SPbSUT, 2024):
 *  - average throughput of an ACM hop, formula (2.2): Cср = Σ Cᵢ·(Pн.ᵢ₊₁ − Pн.ᵢ), Pн.ₙ₊₁ = 1;
 *  - rain fade distribution for E-band by the method of moments, formulas (3.6)–(3.11),
 *    from local rain statistics: probability of rain Pd, mean attenuation in rain Asr,
 *    variance of the attenuation DA.
 * Pure functions: no UI.
 */

export interface AcmMode { rateMbps: number; u: number }

/**
 * Average throughput, Mbit/s, of a hop that steps down the modulation in fades.
 * u — unavailability of each mode, % of time. The mode with the highest rate that still works
 * carries the traffic; when even the lowest mode fails, nothing is carried.
 */
export function acmAverageRate(modes: AcmMode[]): number {
  const m = modes.filter((x) => x.rateMbps > 0 && Number.isFinite(x.u)).sort((a, b) => a.rateMbps - b.rateMbps);
  if (!m.length) return 0;
  // A faster mode can never be available more often than a slower one.
  const P: number[] = [];
  m.forEach((x, i) => P.push(Math.max(i ? P[i - 1] : 0, Math.min(100, Math.max(0, x.u)) / 100)));
  let c = 0;
  for (let i = 0; i < m.length; i++) c += m[i].rateMbps * ((i + 1 < m.length ? P[i + 1] : 1) - P[i]);
  return c;
}

export interface MomentsRain {
  alpha: number;
  beta: number;
  delta: number;
  /** Share of time (%) the rain fade exceeds M dB. */
  pFor(M: number): number;
}

/**
 * Rain fade distribution by the method of moments.
 * F(A) = α·(δ²·e^(βδ²A) + δ·e^(βδA) + e^(βA)) for A < 0 (A — signal change, dB, negative in a fade).
 * Pd — probability of rain, %; Asr — mean attenuation during rain, dB (positive);
 * DA — variance of the attenuation during rain, dB². Needs DA ≥ Asr² (otherwise null).
 */
export function momentsRain(pdPct: number, asrDb: number, daDb2: number): MomentsRain | null {
  const Pd = pdPct / 100, Asr = -Math.abs(asrDb);
  if (!(Pd > 0 && Pd <= 1) || !(Asr < 0) || !(daDb2 > 0)) return null;
  const r = daDb2 / (Asr * Asr);
  const phi = (d: number) => (2 * (d * d + d + 1) ** 2) / (9 * d * d) - 1; // (3.8), minimum 1 at δ = 1
  if (r < 1) return null;
  let lo = 1e-6, hi = 1;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (phi(mid) > r) lo = mid; else hi = mid; }
  const delta = (lo + hi) / 2;
  const s = delta * delta + delta + 1;
  const alpha = Pd / s; // (3.10)
  // From (3.7): Asr = −3 / (β·(δ²+δ+1)) with Asr the mean during rain. (3.11) in the text carries an
  // extra Pd factor, which contradicts (3.7); the moments check out only without it.
  const beta = -3 / (Asr * s);
  const F = (A: number) => (A >= 0 ? 1 : alpha * (delta * delta * Math.exp(beta * delta * delta * A) + delta * Math.exp(beta * delta * A) + Math.exp(beta * A)));
  return { alpha, beta, delta, pFor: (M: number) => (M <= 0 ? 100 : Math.min(100, 100 * F(-M))) };
}
