/** Propagation models. Sources: ITU-R P.525, P.526, P.530, P.676, P.838. */

export const EARTH_R_KM = 6371;

/** Free-space loss, dB (f in GHz, d in km). */
export const fsl = (fGHz: number, dKm: number) => 92.45 + 20 * Math.log10(fGHz) + 20 * Math.log10(dKm);

/** Single knife-edge diffraction loss, dB. h = clearance (negative = obstruction), F1 = first Fresnel radius. */
export function knifeEdge(h: number, F1: number): number {
  const v = (-Math.SQRT2 * h) / F1;
  return v > -0.78 ? 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1) : 0;
}

/** Parabolic dish gain with 55 % aperture efficiency, dBi. */
export const dishGain = (dM: number, fGHz: number) =>
  dM > 0 && fGHz > 0 ? 10 * Math.log10(0.55 * Math.pow((Math.PI * dM * fGHz) / 0.299792458, 2)) : NaN;

/** Half-power beamwidth, degrees. */
export const beamwidth = (dM: number, fGHz: number) => (dM > 0 && fGHz > 0 ? (70 * 0.299792458) / fGHz / dM : NaN);

/* ---------- gases, ITU-R P.676, standard atmosphere (7.5 g/m³, 15 °C, sea level), dB/km ---------- */
const GAS: [number, number][] = [
  [1, 0.0054], [5, 0.0085], [8, 0.0105], [10, 0.0125], [13, 0.022], [15, 0.035], [18, 0.075], [20, 0.12],
  [22, 0.19], [23, 0.19], [25, 0.15], [28, 0.12], [32, 0.11], [38, 0.12], [42, 0.15], [46, 0.25], [50, 0.45],
  [52, 1.0], [54, 3.0], [56, 8.0], [58, 13], [60, 15], [62, 12], [64, 5], [66, 1.8], [68, 0.75], [70, 0.48],
  [72, 0.38], [75, 0.34], [78, 0.33], [80, 0.33], [83, 0.34], [86, 0.36], [90, 0.4], [95, 0.45], [100, 0.5]
];
export function gasAttenuation(fGHz: number): number {
  if (fGHz <= GAS[0][0]) return GAS[0][1];
  for (let i = 1; i < GAS.length; i++) {
    if (fGHz <= GAS[i][0]) {
      const a = GAS[i - 1], b = GAS[i], t = (fGHz - a[0]) / (b[0] - a[0]);
      return Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * t);
    }
  }
  return GAS[GAS.length - 1][1];
}

/* ---------- rain, ITU-R P.838-3 coefficients and P.530 path model ---------- */
// [f GHz, kH, αH, kV, αV]
const RAIN: [number, number, number, number, number][] = [
  [1, 2.59e-5, 0.9691, 3.08e-5, 0.8592], [2, 8.47e-5, 1.0664, 9.98e-5, 0.949], [4, 1.071e-4, 1.6009, 2.461e-4, 1.2476],
  [6, 7.056e-4, 1.59, 4.878e-4, 1.5728], [7, 1.915e-3, 1.481, 1.425e-3, 1.4745], [8, 4.115e-3, 1.3905, 3.45e-3, 1.3797],
  [10, 1.217e-2, 1.2571, 1.129e-2, 1.2156], [12, 2.386e-2, 1.1825, 2.455e-2, 1.1216], [15, 4.481e-2, 1.1233, 5.008e-2, 1.044],
  [18, 7.078e-2, 1.0818, 7.708e-2, 1.0025], [20, 9.164e-2, 1.0568, 9.611e-2, 0.9847], [23, 0.1286, 1.0214, 0.1284, 0.963],
  [25, 0.1571, 0.9991, 0.1533, 0.9491], [30, 0.2403, 0.9485, 0.2291, 0.9129], [38, 0.4053, 0.8805, 0.3844, 0.8552],
  [40, 0.4431, 0.8673, 0.4274, 0.8421], [50, 0.66, 0.8084, 0.6472, 0.7871], [60, 0.8606, 0.7656, 0.8515, 0.7486],
  [70, 1.0315, 0.7345, 1.0253, 0.7215], [80, 1.1704, 0.7115, 1.1668, 0.7021], [90, 1.2807, 0.6944, 1.2795, 0.6876],
  [100, 1.3671, 0.6815, 1.3680, 0.6765]
];
function rainCoef(fGHz: number, pol: 'H' | 'V') {
  const f = Math.min(100, Math.max(1, fGHz));
  let i = 1;
  while (i < RAIN.length - 1 && RAIN[i][0] < f) i++;
  const a = RAIN[i - 1], b = RAIN[i];
  const t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
  const ki = pol === 'V' ? 3 : 1;
  return {
    k: Math.exp(Math.log(a[ki]) + (Math.log(b[ki]) - Math.log(a[ki])) * t),
    alpha: a[ki + 1] + (b[ki + 1] - a[ki + 1]) * t
  };
}

export interface RainModel {
  /** Specific attenuation at R0.01, dB/km. */
  gamma: number;
  /** Path attenuation exceeded 0.01 % of the time, dB. */
  A001: number;
  /** Percentage of time the given fade margin is exceeded by rain. */
  pFor(marginDb: number): number;
}

export function rainModel(fGHz: number, dKm: number, R001: number, pol: 'H' | 'V'): RainModel {
  const { k, alpha } = rainCoef(fGHz, pol);
  const gamma = k * Math.pow(R001, alpha);
  const den = 0.477 * Math.pow(dKm, 0.633) * Math.pow(R001, 0.073 * alpha) * Math.pow(fGHz, 0.123) - 10.579 * (1 - Math.exp(-0.024 * dKm));
  const r = Math.min(den > 0 ? 1 / den : 2.5, 2.5);
  const A001 = gamma * dKm * r;
  const C0 = fGHz >= 10 ? 0.12 + 0.4 * Math.log10(Math.pow(fGHz / 10, 0.8)) : 0.12;
  const C1 = Math.pow(0.07, C0) * Math.pow(0.12, 1 - C0);
  const C2 = 0.855 * C0 + 0.546 * (1 - C0);
  const C3 = 0.139 * C0 + 0.043 * (1 - C0);
  const Ap = (p: number) => A001 * C1 * Math.pow(p, -(C2 + C3 * Math.log10(p)));
  return {
    gamma,
    A001,
    pFor(M: number) {
      if (!(R001 > 0)) return 0;
      if (M <= 0) return 100;
      if (Ap(1) >= M) return 1;
      if (Ap(1e-6) < M) return 0;
      let lo = -6, hi = 0;
      for (let i = 0; i < 50; i++) {
        const m = (lo + hi) / 2;
        if (Ap(10 ** m) > M) lo = m;
        else hi = m;
      }
      return 10 ** ((lo + hi) / 2);
    }
  };
}

/**
 * Multipath fading, ITU-R P.530 quick method: percentage of the worst month
 * during which the fade depth A (dB) is exceeded.
 */
export function multipathWorstMonth(dKm: number, fGHz: number, dN1: number, slope: number, hLowM: number, A: number): number {
  if (A <= 0) return 100;
  const K = Math.pow(10, -4.6 - 0.0027 * dN1);
  return Math.min(100, K * Math.pow(dKm, 3) * Math.pow(1 + slope, -1.2) * Math.pow(10, 0.033 * fGHz - 0.001 * hLowM - A / 10));
}

/** Approximate required C/N for a modulation name, dB (used for cross-polar interference degradation). */
export function requiredSnr(name: string): number {
  const t = String(name).toUpperCase();
  if (/BPSK/.test(t)) return 7;
  if (/QPSK|4-?QAM/.test(t)) return 10;
  const m = t.match(/(\d+)\s*-?\s*QAM|QAM\s*-?_?(\d+)/);
  if (m) {
    const M = +(m[1] || m[2]);
    if (M >= 4) return 17 + 3 * (Math.log2(M) - 4);
  }
  return 20;
}
