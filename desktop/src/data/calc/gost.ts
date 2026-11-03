/**
 * ГОСТ Р 53363-2009 «Цифровые радиорелейные линии. Показатели качества. Методы расчёта».
 * Sections implemented here (numbers of the standard in brackets):
 *  - effective Earth radius from the refractivity gradient g (8.1) and its range gн…gв (8.3.1);
 *  - unavailability from sub-refraction (12, 17) with the regional ḡ, σ of Appendix Б and σ(R) (Б.1);
 *  - multipath (interference) fading: flat (13.3–13.4) and selective (13.5–13.8) on hilly paths
 *    below 20 GHz, high mountain paths (13.18–13.23) and mountain paths (13.24);
 *  - space and frequency diversity (14.1–14.12) for hilly paths;
 *  - SESR and unavailability from multipath (15), rain (16) and sub-refraction (17), totals (18).
 * Not implemented: flat / over-water paths of 13.2 (they need the reflection analysis of section 9),
 * equipment reliability of section 5 (entered as a ready value). Pure functions: no UI.
 */
import { rainCoef } from './physics';

/** Appendix Б, table Б.1: ḡ and σ, 10⁻⁸ 1/m, for the summer and winter months. */
export interface GostRegion { id: number; name: string; summer: [number, number]; winter: [number, number] | null }
export const GOST_REGIONS: GostRegion[] = [
  { id: 1, name: 'Северо-запад ЕТР (Кольский п-ов, Карелия), Прибалтика, Беларусь; северо-восток ЕТР', summer: [-9, 7], winter: [-8, 3] },
  { id: 2, name: 'Центральные районы ЕТР', summer: [-10, 8], winter: [-8, 5] },
  { id: 3, name: 'Юго-запад ЕТР (Курская, Воронежская обл.)', summer: [-9, 7.5], winter: [-7, 3.75] },
  { id: 4, name: 'Степные районы Поволжья, Дона, Краснодарского и Ставропольского краёв', summer: [-8, 8.5], winter: [-7, 5] },
  { id: 5, name: 'Восточные районы средней полосы ЕТР (Башкирия, Пермский край)', summer: [-9, 7], winter: [-9, 6] },
  { id: 6, name: 'Оренбургская обл. и юго-восток ЕТР', summer: [-6, 7], winter: [-9, 3.75] },
  { id: 7, name: 'Прикаспийская низменность', summer: [-13, 10], winter: [-12, 6.5] },
  { id: 8, name: 'Степная полоса Южной Сибири и Казахстана', summer: [-7, 9], winter: [-15, 5.5] },
  { id: 9, name: 'Средняя полоса Западно-Сибирской низменности', summer: [-10, 9], winter: null },
  { id: 10, name: 'Восточная Сибирь (Якутия, Красноярский край)', summer: [-7, 9], winter: [-15, 6.5] },
  { id: 11, name: 'Прибайкалье (прибрежные районы)', summer: [-8, 8], winter: [-9, 4.5] },
  { id: 12, name: 'Забайкалье (континентальные районы)', summer: [-8, 10], winter: [-11, 7.5] },
  { id: 13, name: 'Приамурье, Приморье, Сахалин', summer: [-11, 8.5], winter: [-8, 3.5] },
  { id: 14, name: 'Субарктический пояс Сибири', summer: [-7, 7], winter: [-15, 6] },
  { id: 15, name: 'Черноморское побережье Кавказа', summer: [-10, 6], winter: [-10, 5.5] },
  { id: 16, name: 'Камчатка', summer: [-8.5, 5.8], winter: null }
];

/** Appendix В, table В.1: rain intensity coefficient ξ. */
export const GOST_RAIN_XI: { name: string; xi: number }[] = [
  { name: 'Остальные территории', xi: 1.0 },
  { name: 'Юго-восток Калмыкии; Астраханская обл.', xi: 0.5 },
  { name: 'Калмыкия (кроме юго-востока); Волгоградская, Ростовская, Саратовская обл.', xi: 0.65 },
  { name: 'Камчатская обл.; Корякский АО', xi: 0.7 },
  { name: 'Сахалинская обл.', xi: 0.8 },
  { name: 'Дагестан', xi: 0.85 },
  { name: 'Башкортостан, Марий Эл, Татарстан, Удмуртия, Чувашия; Кировская, Магаданская, Оренбургская, Пермская, Самарская, Свердловская, Ульяновская, Челябинская обл.; Коми-Пермяцкий АО', xi: 0.9 },
  { name: 'Адыгея, Карачаево-Черкесия; Краснодарский, Ставропольский края; Белгородская, Воронежская, Курская, Орловская обл.', xi: 0.95 },
  { name: 'Бурятия, Саха (Якутия); Иркутская, Новосибирская, Омская, Томская, Читинская обл.; Агинский и Усть-Ордынский Бурятские АО, Эвенкийский АО; Брестская, Гомельская обл.', xi: 1.05 },
  { name: 'Черноморское побережье Кавказа (Анапа … Сочи); Ямало-Ненецкий АО', xi: 1.2 },
  { name: 'Приморский, Хабаровский края; Амурская, Еврейская автономная обл.', xi: 1.5 }
];

export type GostTerrain = 'land' | 'coast' | 'arctic';

export interface GostParams {
  region: number;
  season: 'summer' | 'winter';
  terrain: GostTerrain;
  /** Index in GOST_RAIN_XI. */
  rainTerritory: number;
  /** Equipment unavailability from section 5, %. */
  kAppPct: number;
  /** Required SESR, %; null = not checked. */
  sesrNormPct: number | null;
}
export const DEFAULT_GOST: GostParams = { region: 2, season: 'summer', terrain: 'land', rainTerritory: 0, kAppPct: 0, sesrNormPct: null };

export const G_CRIT = -31.4e-8;
/** Effective Earth radius factor for a gradient g, 1/m (8.1): aэ = 6 370 000 / (1 + 3 185 000·g). */
export const kOfG = (g: number) => 1 / (1 + 3185000 * g);

/** ḡ, σ in 1/m; σ(R) for paths shorter than 50 km (Б.1, Б.2) — used for sub-refraction. */
export function regionStats(p: GostParams, Rkm: number): { gMean: number; sigma: number; sigmaR: number } {
  const r = GOST_REGIONS.find((x) => x.id === p.region) ?? GOST_REGIONS[1];
  const [g, s] = (p.season === 'winter' && r.winter ? r.winter : r.summer).map((x) => x * 1e-8);
  let sigmaR = s;
  if (Rkm < 50) {
    const y = 0.588 - 0.00179 * Rkm + 0.000704 * Rkm ** 2 - 0.0000143 * Rkm ** 3 + 0.0000000831 * Rkm ** 4;
    sigmaR = (1e-7 + g / 3.1) * (1 / y - 1) + s / y;
  }
  return { gMean: g, sigma: s, sigmaR: Math.max(s, sigmaR) };
}

/** Normal tail probability with the polynomial of (12.1). */
export function normalTail(n: number): number {
  if (n < 0) return 1 - normalTail(-n);
  const t = 1 / (1 + 0.2316419 * n);
  const poly = 0.31938153 * t - 0.356563782 * t ** 2 + 1.781477937 * t ** 3 - 1.821255978 * t ** 4 + 1.330274429 * t ** 5;
  return (poly / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * n * n);
}

/**
 * Sub-refraction (12): margin(g) — fade margin at gradient g (dB, negative = signal lost).
 * Returns p_субрефр, % of the worst month.
 */
export function subrefraction(margin: (g: number) => number, gMean: number, sigma: number): { p: number; g0: number | null } {
  const gHi = gMean + 4.3 * sigma;
  if (margin(gHi) > 0) return { p: 0, g0: null };
  if (margin(gMean) <= 0) return { p: 100 * normalTail(0), g0: gMean };
  let lo = gMean, hi = gHi;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (margin(m) > 0) lo = m; else hi = m; }
  const g0 = (lo + hi) / 2;
  return { p: 100 * normalTail((g0 - gMean) / sigma), g0 };
}

/** Number of modulation levels from a mode name: QPSK → 4, 16QAM / QAM16 → 16 … */
export function levelsOf(name: string): { M: number; psk: boolean } | null {
  const t = name.toUpperCase();
  if (/BPSK/.test(t)) return { M: 2, psk: true };
  if (/QPSK|4-?QAM/.test(t)) return { M: 4, psk: true };
  const m = t.match(/(\d+)\s*-?\s*(QAM|APSK|TCM)|(QAM|APSK|TCM)\s*-?_?(\d+)/);
  if (m) return { M: +(m[1] || m[4]), psk: false };
  const p = t.match(/(\d+)\s*-?PSK/);
  if (p) return { M: +p[1], psk: true };
  return null;
}

function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** Selective fading margin, dB (13.5–13.7). Cs — Gbit/s, R — km, f — GHz. */
export function selectiveMargin(CsGbps: number, M: number, psk: boolean, Rkm: number, fGHz: number, coastal: boolean): number {
  if (!(CsGbps > 0) || !(M >= 2)) return Infinity;
  const FM = psk ? 1 / (Math.tan(Math.PI / M) * Math.log2(M)) : (Math.sqrt(M) - 1) / Math.log2(M);
  const de = coastal ? -3.2e-6 : -0.6e-6, se = 1.7e-6;
  let num = 0, den = 0;
  for (let n = 1; n <= 400; n++) {
    const e = 1 - erf((de + (3e-4 / (Rkm * fGHz)) * (2 * n - 1)) / (Math.SQRT2 * se));
    num += (2 * n - 1) ** 2 * e; den += e;
    if (e < 1e-12 && n > 3) break;
  }
  const FRf = Math.sqrt(Math.max(1, den > 0 ? num / den : 1));
  return -20 * Math.log10(((Math.PI * CsGbps) / (Math.sqrt(12) * fGHz)) * FM * FRf);
}

export interface GostMultipath { p0: number; pFlat: number; pSel: number; p: number; kind: 'hilly' | 'mountain' | 'high' }

/**
 * Multipath unavailability, % of the worst month (13.1, 13.3, 13.24).
 * F — thermal fade margin (dB), Fsel — selective margin (dB), h — mean antenna height above sea, m,
 * eps — path inclination, mrad.
 */
export function multipath(Rkm: number, fGHz: number, F: number, Fsel: number, h: number, epsMrad: number, terrain: GostTerrain): GostMultipath {
  const coastal = terrain !== 'land';
  const hilly = () => {
    const C = terrain === 'arctic' ? 2 : terrain === 'coast' ? Math.max(1, 5 - 0.007 * h + 4e-6 * h * h) : 1;
    const p0 = C * fGHz ** 1.5 * (Rkm <= 20 ? 2.05e-5 * Rkm ** 3 : 4.1e-4 * Rkm ** 2);
    const pFlat = p0 * 10 ** (-F / 10), pSel = Number.isFinite(Fsel) ? p0 * 10 ** (-Fsel / 10) : 0;
    return { p0, pFlat, pSel, p: pFlat + pSel };
  };
  const high = () => {
    const K = coastal ? 4.9e-3 : 4.1e-4;
    const Fh = coastal ? 10 ** (-0.0004 * (h - 100)) : 10 ** (-0.001 * (h - 800));
    const p0 = K * Fh * Rkm ** 2.5 * fGHz ** 1.5 * (1 + Math.abs(epsMrad)) ** -1.2;
    const x = (180 / (Math.PI * 1e3)) * epsMrad;
    const q = (20.16 * x - 15.4 * x * x + 3.03 * x ** 3) * 1e-8;
    const Vm = ((q * 1e5) / 9) * Rkm * fGHz * fGHz;
    // (13.23) is printed as 10^((F′−Vм)/10); the sign must be negative for the fade to get rarer with margin.
    const pFlat = p0 * 10 ** (-(F - Vm) / 10);
    return { p0, pFlat, pSel: 0, p: pFlat };
  };
  if (h <= 800) return { ...hilly(), kind: 'hilly' };
  if (h > 1200) return { ...high(), kind: 'high' };
  const a = hilly(), b = high();
  return { p0: a.p0, pFlat: a.pFlat, pSel: a.pSel, p: a.p + ((b.p - a.p) / 400) * (h - 800), kind: 'mountain' };
}

/** Space (S, m) or frequency (dfGHz) diversity on a hilly path (14.1–14.12); returns p_млd, %. */
export function diversity(
  kind: 'sd' | 'fd', mp: GostMultipath, fGHz: number, Rkm: number, Fm: number, opts: { S?: number; dfGHz?: number; coastal: boolean }
): { p: number; I: number } {
  const eta = 1;
  const Ppl = mp.pFlat / 100, Psel = mp.pSel / 100, P0 = mp.p0 / 100;
  let I = 1;
  if (kind === 'sd') {
    const S = opts.S ?? 0;
    if (!(S > 0)) return { p: mp.p, I: 1 };
    const F = fGHz < 20
      ? -1 / ((1.287e5 * (S * Math.min(fGHz, 11)) ** -2) * P0)
      : -2.5e-4 * Math.max(3, Math.min(S, 23)) ** 0.87 * Rkm ** 0.48 * P0 ** -1.04;
    I = (1 - Math.exp(F)) * 10 ** (Fm / 10);
  } else {
    const df = opts.dfGHz ?? 0;
    if (!(df > 0)) return { p: mp.p, I: 1 };
    const Cf = opts.coastal ? 2.5 * (df / fGHz) ** -1.2 : 17 * (df / fGHz) ** -1;
    I = 1 / (Cf * Ppl);
  }
  I = Math.max(1, I);
  const K2pl = Math.max(0, Math.min(1, 1 - (I / eta) * Ppl));
  const rw = K2pl > 0.26 ? 1 - 0.9746 * (1 - K2pl) ** 2.17 : 1 - 0.6921 * (1 - K2pl) ** 1.034;
  const K2sel = rw <= 0.5 ? 0.8238 : rw <= 0.9628 ? 1 - 0.195 * (1 - rw) ** (0.109 - 0.13 * Math.log10(1 - rw)) : 1 - 0.3957 * (1 - rw) ** 0.5136;
  const Pd = Ppl / I;
  const Pseld = Psel > 0 ? (Psel * Psel) / (eta * Math.max(1e-9, 1 - K2sel)) : 0;
  const P = (Pseld ** 0.75 + Pd ** 0.75) ** (4 / 3);
  return { p: Math.min(mp.p, 100 * P), I };
}

/** Multipath contribution to SESR and unavailability (15). p — % of the worst month. */
export function multipathQuality(p: number, F: number, Fsel: number, fGHz: number, Rkm: number, relClear: number, terrain: GostTerrain, mountain: boolean) {
  const z = mountain ? 1 / 7 : terrain === 'land' ? 1 / 4 : 1 / 3;
  if (p < 0.000385) return { sesr: p, kng: 0, alpha: 0, tauM: NaN };
  const Fef = Math.sqrt(10 ** (-F / 10) + (Number.isFinite(Fsel) ? 10 ** (-Fsel / 10) : 0));
  const VdB = Math.min(-0.01, 20 * Math.log10(Fef));
  const psi = Rkm * Rkm * Math.max(0, relClear) * 1e-4;
  const Cm = terrain === 'land' ? 1 / (0.001 + (0.106 * psi) ** 1.9) : 1 / (0.002 + (0.272 * psi) ** 2.1);
  const tauM = Cm * Fef * Math.sqrt(4 / fGHz);
  const st = 3.694 + 250.541 / (-VdB) ** 1.5 + 4 * Math.log10(fGHz / 4);
  const x = (4.343 / (Math.SQRT2 * st)) * Math.log(10 / tauM) - (Math.SQRT2 * st) / 8.686;
  const t = 1 / (1 + 0.47047 * Math.abs(x));
  const alpha = 0.5 * (1 - Math.sign(x || 1) * (1 - (0.3480242 * t - 0.0958798 * t * t + 0.7478556 * t ** 3) * Math.exp(-x * x)));
  return { sesr: (1 - alpha) * p, kng: z * alpha * p, alpha, tauM };
}

/** Rain intensity, mm/h (16.1): J = ξ·2.5·10⁵·Ш⁻²·(Д + 25)^−0.3. */
export const gostRainRate = (xi: number, latDeg: number, lonDeg: number) => xi * 2.5e5 * Math.abs(latDeg) ** -2 * (lonDeg + 25) ** -0.3;

/** Rain contribution (16): AS, Kнг.д and SESRд, %. F — fade margin at mean refraction. */
export function gostRain(J: number, fGHz: number, pol: 'H' | 'V', Rkm: number, F: number, latDeg: number, lonDeg: number) {
  const { k, alpha } = rainCoef(fGHz, pol);
  const gamma = k * J ** alpha;
  const B1 = Math.log10(0.19 * J);
  if (!(B1 > 0) || !(F > 0) || !(gamma > 0)) return { gamma, AS: F > 0 ? 0 : 100, kng: F > 0 ? 0 : 100, sesr: 0 };
  const E = alpha * B1 + Math.log10(F / (gamma * Rkm));
  const d = Rkm ** 0.545 * B1, L = Math.log(d);
  const psi = 3.5088e-2 * B1 * Rkm ** 0.33;
  const e1 = 0.43429 * psi;
  const e2 = 0.43429 * psi * L - 0.217145 * psi ** 2;
  const e3 = 0.217145 * psi * L ** 2 - 0.43429 * psi ** 2 * L + 0.144763 * psi ** 3;
  const e4 = 7.28316e-2 * psi * L ** 3 - 0.43429 * psi ** 2 * L ** 2 + 0.43429 * psi ** 3 * L - 0.10857 * psi ** 4;
  const e5 = 1.80954e-2 * psi * L ** 4 - 0.28953 * psi ** 2 * L ** 3 + 0.65143 * psi ** 3 * L ** 2 - 0.43429 * psi ** 4 * L + 8.68581e-2 * psi ** 5;
  const e6 = 3.61908e-3 * psi * L ** 5 - 0.14476 * psi ** 2 * L ** 4 + 0.65143 * psi ** 3 * L ** 3 - 0.8686 * psi ** 4 * L ** 2 + 0.43429 * psi ** 5 * L - 7.23816e-2 * psi ** 6;
  const u = alpha * B1 - e1;
  const A1 = 1 / u;
  const A2 = e2 * A1 ** 3;
  const A3 = (2 * e2 ** 2 + u * e3) * A1 ** 5;
  const A4 = (5 * u * e2 * e3 + u ** 2 * e4 + 5 * e2 ** 3) * A1 ** 7;
  const A5 = (6 * u ** 2 * e2 * e4 + 3 * u ** 2 * e3 ** 2 + 14 * e2 ** 4 + u ** 3 * e5 + 21 * u * e2 ** 2 * e3) * A1 ** 9;
  const A6 = (7 * u ** 3 * e2 * e5 + 7 * u ** 3 * e3 * e4 + 84 * u * e2 ** 3 * e3 + u ** 4 * e6 + 28 * u ** 2 * e2 * e3 ** 2 + 28 * u ** 2 * e2 ** 2 * e4 + 42 * e2 ** 5) * A1 ** 11;
  const B2 = B1 * [A1, A2, A3, A4, A5, A6].reduce((s, A, i) => s + A * E ** (i + 1), 0);
  const x = B2 - B1;
  const AS = Math.min(100, 10 ** -(2 + 2 * x + 0.2387 * Math.abs(x) ** 2.5682));
  const kng = AS >= 3.2e-5 ? AS : 0;
  const Q = Math.min(12, 0.1227 * Math.abs(latDeg) ** 0.7456 * Math.abs(lonDeg) ** 0.114 * Math.max(AS, 1e-12) ** -0.1227);
  const sesr = AS < 3.2e-5 ? AS * Q : 0;
  return { gamma, AS, kng, sesr };
}

/** Sub-refraction contribution (17); p — % of the worst month. */
export function subrefQuality(p: number, terrain: GostTerrain) {
  const z = terrain === 'land' ? 1 / 4 : 1 / 3;
  const AS = z * p;
  return AS >= 3.2e-5 ? { kng: AS, sesr: 0 } : { kng: 0, sesr: p };
}
