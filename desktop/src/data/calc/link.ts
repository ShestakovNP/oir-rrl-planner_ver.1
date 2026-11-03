/**
 * Link budget and availability for one hop with up to two radio channels on a
 * shared antenna. Pure functions: no UI, no storage, no network.
 */
import type { Channel, Climate, Link, ModMode, Pol, ProfilePoint, Site } from '../types';
import { deg, vincenty, type Geodesic } from './geo';
import {
  EARTH_R_KM, beamwidth, dishGain, fsl, gasAttenuation, knifeEdge, multipathP0, multipathWorstMonth, rainModel, requiredSnr, type RainModel
} from './physics';
import { downtime, fmt, ghz, polName } from './format';
import { buildRecommendations, type Rec } from './recommend';
import { comparePolarization, type PolarizationResult } from './polarization';
import { waterReflection, waterShare, type WaterReflection } from './water';
import { acmAverageRate, momentsRain, type MomentsRain } from './acm';
import { coSiteInterference, type InterferenceResult, type Neighbor } from './interference';
import { SCHEME_SHORT, diversityValidity, fdImprovement, protectionOf, sdImprovement } from './protection';
import type { ProtectionScheme } from '../types';
import {
  DEFAULT_GOST, GOST_RAIN_XI, GOST_REGIONS, diversity as gostDiversity, gostRain, gostRainRate, kOfG, levelsOf, multipath as gostMultipath,
  multipathQuality, regionStats, selectiveMargin, subrefQuality, subrefraction, type GostParams
} from './gost';

export interface Sample {
  d: number;
  /** Ground with Earth bulge, m. */
  g: number;
  /** Top of ground + clutter with bulge, m. */
  top: number;
  /** Line of sight, m. */
  los: number;
  /** First Fresnel radius, m. */
  F1: number;
  /** Clearance above top, m. */
  H: number;
  /** Surface type at this point (b building, f forest, w water). */
  t?: 'b' | 'f' | 'w';
}
export interface Critical extends Sample { rel: number }
export interface Geometry { s: Sample[]; crit: Critical | null }

export interface PathModel {
  pts: ProfilePoint[];
  D: number;
  gA0: number;
  gB0: number;
  hA: number;
  hB: number;
  HA: number;
  HB: number;
}

export interface ModeResult extends ModMode {
  prx: number;
  /** Threshold degradation by the co-channel cross-polar neighbour, dB. */
  deg: number;
  margin: number;
  mpMonth: number;
  mpYear: number;
  rainYear: number;
  /** Total unavailability, % of year. */
  u: number;
  /** false = strong sub-refraction eats the whole margin. */
  subOk: boolean;
  ok: boolean;
  /** ГОСТ Р 53363-2009 details of this mode (null for ITU-R). */
  g?: GostMode | null;
}

/** Per-mode results of ГОСТ Р 53363-2009, % (worst month for multipath and sub-refraction). */
export interface GostMode {
  /** Selective fading margin, dB (Infinity = not counted). */
  Fsel: number;
  p0: number;
  pFlat: number;
  pSel: number;
  /** Multipath fading after diversity, %. */
  pMl: number;
  pSub: number;
  rainAS: number;
  kMl: number;
  kRain: number;
  kSub: number;
  kApp: number;
  sesrMl: number;
  sesrRain: number;
  sesrSub: number;
  sesr: number;
  /** Diversity improvement at this margin (1 = none). */
  I: number;
}
export interface GostChannel {
  params: GostParams;
  regionName: string;
  gMean: number;
  sigma: number;
  sigmaR: number;
  xi: number;
  /** Rain intensity of section 16.1, mm/h. */
  J: number;
  gamma: number;
  /** Mean antenna height above sea level, m, and the path inclination, mrad. */
  hMean: number;
  eps: number;
  kind: 'hilly' | 'mountain' | 'high';
  /** Relative clearance p(ḡ) = H/H0. */
  pRel: number;
  notes: string[];
}

export interface ChannelResult {
  n: 1 | 2;
  ch: Channel;
  tag: string;
  label: string;
  fGHz: number;
  pol: Pol;
  geom: Geometry;
  geomMin: Geometry;
  FSL: number;
  diff: number;
  diffMin: number;
  gasK: number;
  gas: number;
  gA: number;
  gB: number;
  gAcalc: number;
  gBcalc: number;
  beamA: number;
  beamB: number;
  fixed: number;
  rain: RainModel;
  modes: ModeResult[];
  best: ModeResult | null;
  working: ModeResult[];
  top: ModeResult | null;
  next: ModeResult | null;
  /** Reference mode: best within the norm, or the first one that works at all. */
  ref: ModeResult | null;
  /** Fade margin needed to meet the availability objective, dB. */
  marginRequired: number;
  /** Reflection from water on the path (null = no water under the reflection point). */
  refl: WaterReflection | null;
  /** Protection / diversity details (null = 1+0). */
  div: DiversityResult | null;
  /** Interference from other links at the same objects on overlapping frequencies. */
  intf: InterferenceResult | null;
  /** Average throughput with adaptive modulation, Mbit/s (Stepanets 2024, formula 2.2). */
  avgRate: number;
  /** Rain modelled by the method of moments from local statistics (E-band). */
  rainMoments: MomentsRain | null;
  /** ГОСТ Р 53363-2009 inputs and intermediate values (null for ITU-R). */
  gost: GostChannel | null;
}

export interface DiversityBranch {
  /** Height of the second antenna above ground, m. */
  h: number;
  /** Vertical spacing between the antennas, m. */
  S: number;
  /** Level difference main − diversity antenna, dB. */
  V: number;
  /** Gain of the diversity antenna, dB. */
  gain: number;
  /** Clearance of the diversity antenna, share of the first Fresnel zone, at k and at kMin. */
  rel: number | null;
  relMin: number | null;
  diff: number;
  /** Improvement factor at the reference mode margin. */
  I: number;
}
export interface DiversityResult {
  scheme: ProtectionScheme;
  /** SD branches: at A (improves the B→A direction) and at B (A→B). */
  a: DiversityBranch | null;
  b: DiversityBranch | null;
  /** FD improvement at the reference margin. */
  I: number;
  /** HSB coupler loss counted in the budget (both ends), dB. */
  hsbLoss: number;
  /** Multipath outage at the reference mode without and with diversity, % of year. */
  mpPlain: number;
  mpDiv: number;
  /** Where the P.530 formula leaves its validated range. */
  validity: string[];
}

export type Level = 'ok' | 'warn' | 'bad' | 'info';

export interface LinkResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  siteA: Site;
  siteB: Site;
  climate: Climate;
  geo: Geodesic | null;
  path: PathModel;
  k: number;
  kMin: number;
  geom: Geometry;
  geomMin: Geometry;
  clearance: { rel: number | null; level: Level; label: string };
  tiltA: number;
  tiltB: number;
  channels: ChannelResult[];
  multi: boolean;
  coChannel: boolean;
  samePol: boolean;
  /** Antenna XPD used for co-channel operation, dB; null when not entered. */
  xpd: number | null;
  /** Allowed unavailability, % of year. */
  uNorm: number;
  totalRate: number;
  /** Average throughput of all stems with adaptive modulation, Mbit/s. */
  avgRate: number;
  verdict: { level: Level; label: string; title: string; sub: string };
  recs: Rec[];
  polarization: PolarizationResult;
  /** Share of the path over water, 0…1. */
  water: number;
  method: 'itu' | 'gost';
}

/** True when channel 2 is enabled and its band overlaps channel 1 (dual-polarization co-channel operation). */
export function channelsShareFrequency(link: Pick<Link, 'channels'>): boolean {
  const [a, b] = link.channels;
  if (!b?.enabled || !(a.freqMHz > 0) || !(b.freqMHz > 0)) return false;
  return Math.abs(a.freqMHz - b.freqMHz) < ((a.bwMHz || 0) + (b.bwMHz || 0)) / 2 || a.freqMHz === b.freqMHz;
}

export function interpolate(pts: ProfilePoint[], d: number): ProfilePoint {
  if (d <= pts[0].d) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (d <= pts[i].d) {
      const a = pts[i - 1], b = pts[i], t = (d - a.d) / (b.d - a.d || 1);
      const p: ProfilePoint = { d, g: a.g + (b.g - a.g) * t, c: a.c + (b.c - a.c) * t };
      let kind = t <= 0.5 ? a.t : b.t;
      // A ramp between typed clutter and open ground keeps the clutter type.
      if (!kind && p.c > 0) kind = a.c > 0 ? a.t : b.t;
      if (kind) p.t = kind;
      return p;
    }
  }
  return pts[pts.length - 1];
}

export function geometry(P: PathModel, k: number, fGHz: number): Geometry {
  const { pts, D, HA, HB } = P;
  const set = new Set(pts.map((p) => +p.d.toFixed(5)));
  for (let i = 0; i <= 320; i++) set.add(+((D * i) / 320).toFixed(5));
  const ds = [...set].filter((d) => d >= 0 && d <= D).sort((a, b) => a - b);
  let crit: Critical | null = null;
  const s = ds.map((d) => {
    const q = interpolate(pts, d);
    const bulge = ((d * (D - d)) / (2 * k * EARTH_R_KM)) * 1000;
    const los = HA + ((HB - HA) * d) / D;
    const F1 = d > 0 && d < D ? 17.32 * Math.sqrt((d * (D - d)) / (fGHz * D)) : 0;
    const top = q.g + q.c + bulge;
    const o: Sample = { d, g: q.g + bulge, top, los, F1, H: los - top, t: q.t };
    if (d > D * 0.005 && d < D * 0.995 && F1 > 0) {
      const rel = o.H / F1;
      if (!crit || rel < crit.rel) crit = { ...o, rel };
    }
    return o;
  });
  return { s, crit };
}

export type SurfaceKind = 'b' | 'f' | 'w' | 'c';
/**
 * Consecutive runs of the same surface along the samples, for drawing:
 * b building, f forest, w water, c clutter without a known type (entered by hand).
 */
export function surfaceRuns(s: Sample[]): { kind: SurfaceKind; from: number; to: number }[] {
  const kindOf = (o: Sample): SurfaceKind | null => (o.t === 'w' ? 'w' : o.top - o.g > 0.05 ? (o.t ?? 'c') : null);
  const runs: { kind: SurfaceKind; from: number; to: number }[] = [];
  s.forEach((o, i) => {
    const k = kindOf(o);
    const last = runs[runs.length - 1];
    if (k && last && last.kind === k && last.to === i - 1) last.to = i;
    else if (k) runs.push({ kind: k, from: i, to: i });
  });
  return runs;
}

export function clearanceState(rel: number | null): { level: Level; label: string } {
  if (rel == null) return { level: 'warn', label: '—' };
  return rel >= 0.577 ? { level: 'ok', label: 'Трасса открыта' } : rel >= 0 ? { level: 'warn', label: 'Трасса полуоткрыта' } : { level: 'bad', label: 'Трасса закрыта' };
}

/** Builds the path model; returns warnings about profile problems. */
export function buildPath(link: Link, A: Site, B: Site, geo: Geodesic | null): { path: PathModel; warnings: string[] } {
  const warnings: string[] = [];
  let pts = (link.profile || [])
    .filter((p) => Number.isFinite(p.d) && Number.isFinite(p.g))
    .map((p): ProfilePoint => ({ d: p.d, g: p.g, c: Math.max(0, Number.isFinite(p.c) ? p.c : 0), ...(p.t ? { t: p.t } : {}) }))
    .sort((a, b) => a.d - b.d);
  let D = geo ? geo.km : 0;
  if (pts.length < 2) {
    const gA = A.groundM ?? 0, gB = B.groundM ?? 0;
    pts = [{ d: 0, g: gA, c: 0 }, { d: D, g: gB, c: 0 }];
    warnings.push('Профиль трассы не задан: считаю ровную землю между объектами. Загрузите профиль по SRTM или введите его вручную.');
  } else {
    const d0 = pts[0].d;
    pts = pts.map((p) => ({ ...p, d: p.d - d0 }));
    const Dp = pts[pts.length - 1].d;
    if (geo && Dp > 0) {
      const sc = geo.km / Dp;
      if (Math.abs(sc - 1) > 0.01)
        warnings.push(`Длина по координатам ${fmt(geo.km, 2)} км, а профиль заканчивается на ${fmt(Dp, 2)} км. Профиль растянут до длины по координатам — проверьте его.`);
      pts = pts.map((p) => ({ ...p, d: p.d * sc }));
    } else D = Dp;
  }
  if (!(D > 0)) D = Math.max(pts[pts.length - 1].d, 0.01);
  const gA0 = pts[0].g, gB0 = pts[pts.length - 1].g;
  return { path: { pts, D, gA0, gB0, hA: link.hA, hB: link.hB, HA: gA0 + link.hA, HB: gB0 + link.hB }, warnings };
}

interface Ctx {
  link: Link;
  path: PathModel;
  k: number;
  kMin: number;
  slope: number;
  hLow: number;
  uNorm: number;
  /** Carrier-to-interference from the other channel, dB (Infinity = none). */
  ci: number;
  A: Site;
  B: Site;
  /** Other links of the project (for interference from links at the same objects). */
  neighbors: Neighbor[];
}

export function calcChannel(ctx: Ctx, ch: Channel, n: 1 | 2, polOverride?: Pol): ChannelResult {
  const { link, path, k, kMin, slope, hLow, uNorm, ci, A: sA, B: sB, neighbors } = ctx;
  const pol = polOverride ?? ch.pol;
  const D = path.D;
  const fGHz = ch.freqMHz / 1000;
  const geom = geometry(path, k, fGHz);
  const geomMin = geometry(path, kMin, fGHz);
  const FSL = fsl(fGHz, D);
  const diff = geom.crit ? Math.max(0, knifeEdge(geom.crit.H, geom.crit.F1)) : 0;
  const diffMin = geomMin.crit ? Math.max(0, knifeEdge(geomMin.crit.H, geomMin.crit.F1)) : 0;
  const gasK = link.climate.gasDbPerKm ?? gasAttenuation(fGHz);
  const gas = gasK * D;
  const gAcalc = dishGain(link.dishA, fGHz), gBcalc = dishGain(link.dishB, fGHz);
  const gA = ch.gainA ?? gAcalc, gB = ch.gainB ?? gBcalc;
  const prot = protectionOf(link);
  const hsbLoss = prot?.scheme === 'hsb' ? 2 * Math.max(0, prot.hsbLossDb || 0) : 0;
  const fixed = gA + gB - link.feederA - link.feederB - link.otherLoss - hsbLoss;
  const rain = rainModel(fGHz, D, link.climate.rainR001, pol);
  const er = link.climate.eRain;
  const rainMoments = er?.on && fGHz >= 57 ? momentsRain(er.pdPct, er.asrDb, er.daDb2) : null;
  const rainP = (M: number) => (rainMoments ? rainMoments.pFor(M) : rain.pFor(M));
  const c = link.climate;
  const refl = waterReflection(path, geom.s, k, kMin, fGHz, pol, link.dishA, link.dishB);
  const intf: InterferenceResult | null = neighbors.length ? coSiteInterference(link, sA, sB, ch, pol, gA, gB, neighbors) : null;
  /* diversity: improvement of the multipath term only */
  const c0 = link.climate;
  const p0 = multipathP0(D, fGHz, c0.dN1, slope, hLow);
  const branch = (at: 'A' | 'B'): (Omit<DiversityBranch, 'I'> & { Ifn(M: number): number }) | null => {
    if (prot?.scheme !== 'sd' || !(at === 'A' ? prot.sdA : prot.sdB)) return null;
    const h2 = at === 'A' ? prot.hA2 : prot.hB2;
    const P2 = at === 'A' ? { ...path, hA: h2, HA: path.gA0 + h2 } : { ...path, hB: h2, HB: path.gB0 + h2 };
    const g2 = geometry(P2, k, fGHz), g2min = geometry(P2, kMin, fGHz);
    const diff2 = g2.crit ? Math.max(0, knifeEdge(g2.crit.H, g2.crit.F1)) : 0;
    const dish2 = at === 'A' ? prot.dishA2 : prot.dishB2, dishMain = at === 'A' ? link.dishA : link.dishB;
    // Same dish as the main one: take the main antenna gain (it may come from the datasheet).
    const gain2 = Math.abs(dish2 - dishMain) < 1e-6 ? (at === 'A' ? gA : gB) : dishGain(dish2, fGHz);
    const gMain = at === 'A' ? gA - link.feederA : gB - link.feederB;
    const gDiv = gain2 - (at === 'A' ? prot.feederA2 : prot.feederB2);
    const V = gMain - diff - (gDiv - diff2);
    const S = Math.abs((at === 'A' ? link.hA : link.hB) - h2);
    return { h: h2, S, V, gain: gain2, rel: g2.crit ? g2.crit.rel : null, relMin: g2min.crit ? g2min.crit.rel : null, diff: diff2, Ifn: (M: number) => sdImprovement(S, fGHz, D, p0, M, V) };
  };
  const brA = branch('A'), brB = branch('B');
  const fdSpacing = prot?.scheme === 'fd' ? Math.max(0, prot.fdSpacingMHz || 0) / 1000 : 0;
  /** Worst-direction improvement factor for a fade margin M. */
  const improve = (M: number): number => {
    if (prot?.scheme === 'fd') return fdImprovement(fdSpacing, fGHz, D, M);
    if (prot?.scheme === 'sd') return Math.min(brA ? brA.Ifn(M) : 1, brB ? brB.Ifn(M) : 1);
    return 1;
  };
  const mpOf = (M: number) => multipathWorstMonth(D, fGHz, c0.dN1, slope, hLow, M) / improve(M);
  const reflLoss = refl ? refl.applied : 0;
  /* ГОСТ Р 53363-2009 */
  const gp: GostParams | null = c.method === 'gost' ? { ...DEFAULT_GOST, ...(c.gost ?? {}) } : null;
  let gch: GostChannel | null = null;
  let gostEval: ((M: number, Fsel: number) => GostMode) | null = null;
  if (gp) {
    const st = regionStats(gp, D);
    const xi = (GOST_RAIN_XI[gp.rainTerritory] ?? GOST_RAIN_XI[0]).xi;
    const lat = (sA.lat + sB.lat) / 2, lon = (sA.lon + sB.lon) / 2;
    const J = gostRainRate(xi, lat, lon);
    const hMean = (path.HA + path.HB) / 2, eps = Math.abs(path.HA - path.HB) / D;
    const coastal = gp.terrain !== 'land';
    const pRel = geom.crit ? geom.crit.rel * Math.sqrt(3) : 0;
    // Diffraction loss growth from ḡ to gв = ḡ + 4.3σ(R), tabulated once (sub-refraction, section 12).
    const gHi = st.gMean + 4.3 * st.sigmaR;
    const tbl: { g: number; dl: number }[] = [];
    for (let i = 0; i <= 32; i++) {
      const g = st.gMean + ((gHi - st.gMean) * i) / 32;
      const gm = geometry(path, kOfG(g), fGHz);
      const dl = (gm.crit ? Math.max(0, knifeEdge(gm.crit.H, gm.crit.F1)) : 0) - diff;
      tbl.push({ g, dl: Math.max(i ? tbl[i - 1].dl : 0, dl) });
    }
    const dlAt = (g: number) => {
      if (g <= tbl[0].g) return tbl[0].dl;
      for (let i = 1; i < tbl.length; i++) if (g <= tbl[i].g) { const a = tbl[i - 1], b = tbl[i]; return a.dl + ((b.dl - a.dl) * (g - a.g)) / (b.g - a.g || 1); }
      return tbl[tbl.length - 1].dl;
    };
    const kind = gostMultipath(D, fGHz, 30, Infinity, hMean, eps, gp.terrain).kind;
    const notes: string[] = [];
    if (fGHz > 20 && kind === 'hilly') notes.push('Формулы многолучёвых замираний раздела 13.1 даны для частот до 20 ГГц; выше — экстраполяция.');
    if (prot?.scheme === 'sd' && fGHz >= 20) notes.push('Для пространственного разнесения выше 20 ГГц применена формула (14.3).');
    gch = { params: gp, regionName: (GOST_REGIONS.find((x) => x.id === gp.region) ?? GOST_REGIONS[1]).name, gMean: st.gMean, sigma: st.sigma, sigmaR: st.sigmaR, xi, J, gamma: 0, hMean, eps, kind, pRel, notes };
    gostEval = (M: number, Fsel: number): GostMode => {
      const kApp = Math.max(0, gp.kAppPct || 0);
      if (!(M > 0)) return { Fsel, p0: 0, pFlat: 100, pSel: 0, pMl: 100, pSub: 100, rainAS: 100, kMl: 100, kRain: 100, kSub: 100, kApp, sesrMl: 0, sesrRain: 0, sesrSub: 0, sesr: 100, I: 1 };
      const mp = gostMultipath(D, fGHz, M, Fsel, hMean, eps, gp.terrain);
      let pMl = mp.p, I = 1;
      if (prot?.scheme === 'sd') {
        const vs = [brA, brB].filter((b): b is NonNullable<typeof brA> => !!b).map((b) => gostDiversity('sd', mp, fGHz, D, M, { S: b.S, coastal }));
        if (vs.length) { const w = vs.reduce((a, b) => (b.p > a.p ? b : a)); pMl = w.p; I = w.I; }
      } else if (prot?.scheme === 'fd') {
        const v = gostDiversity('fd', mp, fGHz, D, M, { dfGHz: fdSpacing, coastal });
        pMl = v.p; I = v.I;
      }
      const q = multipathQuality(pMl, M, Fsel, fGHz, D, pRel, gp.terrain, mp.kind !== 'hilly');
      const rn = gostRain(J, fGHz, pol, D, M, lat, lon);
      const pSub = subrefraction((g) => M - dlAt(g), st.gMean, st.sigmaR).p;
      const sq = subrefQuality(pSub, gp.terrain);
      const sesr = q.sesr + rn.sesr + sq.sesr;
      return { Fsel, p0: mp.p0, pFlat: mp.pFlat, pSel: mp.pSel, pMl, pSub, rainAS: rn.AS, kMl: q.kng, kRain: rn.kng, kSub: sq.kng, kApp, sesrMl: q.sesr, sesrRain: rn.sesr, sesrSub: sq.sesr, sesr, I };
    };
    gch.gamma = gostRain(J, fGHz, pol, D, 30, lat, lon).gamma;
  }
  const fselOf = (m: ModMode) => {
    if (!gp) return Infinity;
    const lv = levelsOf(m.name);
    return lv ? selectiveMargin(m.rateMbps / 1000, lv.M, lv.psk, D, fGHz, gp.terrain !== 'land') : Infinity;
  };
  const sesrNorm = gp && gp.sesrNormPct != null && gp.sesrNormPct > 0 ? gp.sesrNormPct : null;
  const thrCorr = Number.isFinite(ch.thrCorrDb) ? (ch.thrCorrDb as number) : 0;
  const modes: ModeResult[] = ch.modes
    // Rows not filled in from the datasheet yet (rate 0 or threshold 0 dBm) are left out.
    .filter((m) => Number.isFinite(m.txDbm) && Number.isFinite(m.thresholdDbm) && m.rateMbps > 0 && m.thresholdDbm < 0)
    .map((m0) => ({ ...m0, thresholdDbm: m0.thresholdDbm + thrCorr }))
    .map((m) => {
      // Interference: the other stem (shared frequency) plus links at the same objects; worst end.
      const extI = Math.max(intf?.IA ?? -Infinity, intf?.IB ?? -Infinity);
      const prx0 = m.txDbm + fixed - FSL - diff - gas - reflLoss;
      const iOverC = (Number.isFinite(ci) ? Math.pow(10, -ci / 10) : 0) + (Number.isFinite(extI) ? Math.pow(10, (extI - prx0) / 10) : 0);
      const ciTot = iOverC > 0 ? -10 * Math.log10(iOverC) : Infinity;
      const degr = Number.isFinite(ciTot) ? 10 * Math.log10(1 + Math.pow(10, (requiredSnr(m.name) - ciTot) / 10)) : 0;
      const prx = m.txDbm + fixed - FSL - diff - gas - reflLoss;
      const margin = prx - m.thresholdDbm - degr;
      if (gostEval) {
        const g = gostEval(margin, fselOf(m));
        const u = Math.min(100, g.kApp + g.kMl + g.kRain + g.kSub);
        return { ...m, prx, deg: degr, margin, mpMonth: g.pMl, mpYear: g.kMl, rainYear: g.kRain, u, subOk: g.pSub < 0.01, ok: margin > 0 && u <= uNorm && (sesrNorm == null || g.sesr <= sesrNorm), g };
      }
      const mpMonth = mpOf(margin);
      const mpYear = mpMonth * c.monthToYear;
      const rainYear = rainP(margin);
      const u = Math.min(100, mpYear + rainYear);
      return { ...m, prx, deg: degr, margin, mpMonth, mpYear, rainYear, u, subOk: diffMin - diff < margin, ok: margin > 0 && u <= uNorm };
    });
  const pick = (list: ModeResult[]) => (list.length ? list.reduce((a, b) => (b.rateMbps > a.rateMbps ? b : a)) : null);
  const okList = modes.filter((r) => r.ok);
  const working = modes.filter((r) => r.margin > 0);
  const best = pick(okList);
  const top = pick(working);
  const next = modes.slice().sort((a, b) => a.rateMbps - b.rateMbps).find((r) => !r.ok && (!best || r.rateMbps > best.rateMbps)) || null;
  const refMode = best || working[0] || modes[0] || null;
  const refFsel = refMode ? fselOf(refMode) : Infinity;
  const unav = (M: number) => {
    if (gostEval) { const g = gostEval(M, refFsel); return Math.min(100, g.kApp + g.kMl + g.kRain + g.kSub); }
    return Math.min(100, mpOf(M) * c.monthToYear + rainP(M));
  };
  let lo = 0, hi = 90;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (unav(m) > uNorm) lo = m;
    else hi = m;
  }
  return {
    n, ch, tag: 'Ст' + n, label: `${ghz(ch.freqMHz)} · ${polName(pol)}`, fGHz, pol, geom, geomMin, FSL, diff, diffMin, gasK, gas,
    gA, gB, gAcalc, gBcalc, beamA: beamwidth(link.dishA, fGHz), beamB: beamwidth(link.dishB, fGHz), fixed, rain, modes,
    best, working, top, next, ref: best || working[0] || modes[0] || null, marginRequired: hi, refl, intf: intf && intf.list.length ? intf : null,
    avgRate: acmAverageRate(modes.map((x) => ({ rateMbps: x.rateMbps, u: x.margin > 0 ? x.u : 100 }))), rainMoments: gp ? null : rainMoments, gost: gch,
    div: prot ? (() => {
      const refM = (best || working[0] || modes[0])?.margin ?? 0;
      const fin = (b: typeof brA): DiversityBranch | null => (b ? { h: b.h, S: b.S, V: b.V, gain: b.gain, rel: b.rel, relMin: b.relMin, diff: b.diff, I: b.Ifn(refM) } : null);
      const plain = multipathWorstMonth(D, fGHz, c.dN1, slope, hLow, refM) * c.monthToYear;
      const Ss = [brA?.S, brB?.S].filter((x): x is number => x != null);
      const validity = prot.scheme === 'sd' ? diversityValidity('sd', fGHz, D, Ss.length ? Math.min(...Ss) : undefined)
        : prot.scheme === 'fd' ? diversityValidity('fd', fGHz, D, undefined, fdSpacing / fGHz) : [];
      if (gostEval && (prot.scheme === 'sd' || prot.scheme === 'fd')) {
        const refG = gostEval(refM, refFsel);
        const finG = (b: typeof brA): DiversityBranch | null => (b ? { ...fin(b)!, I: refG.I } : null);
        return { scheme: prot.scheme, a: finG(brA), b: finG(brB), I: refG.I, hsbLoss, mpPlain: refG.pFlat + refG.pSel, mpDiv: refG.pMl, validity: [] };
      }
      return { scheme: prot.scheme, a: fin(brA), b: fin(brB), I: prot.scheme === 'fd' ? fdImprovement(fdSpacing, fGHz, D, refM) : improve(refM), hsbLoss, mpPlain: plain, mpDiv: plain / improve(refM), validity };
    })() : null
  };
}

export function calculateLink(link: Link, A: Site, B: Site, neighbors: Neighbor[] = []): LinkResult {
  const errors: string[] = [];
  const geoOk = [A.lat, A.lon, B.lat, B.lon].every(Number.isFinite) && Math.abs(A.lat) <= 90 && Math.abs(B.lat) <= 90;
  let geo: Geodesic | null = null;
  if (geoOk) {
    const v = vincenty(A.lat, A.lon, B.lat, B.lon);
    if (v.km > 0.01) geo = v;
    else errors.push('Объекты совпадают или стоят ближе 10 м друг к другу.');
  } else errors.push('У объектов не заданы корректные координаты.');
  const { path, warnings } = buildPath(link, A, B, geo);
  const c = link.climate;
  const gostOn = c.method === 'gost';
  let k = c.k, kMin = c.kMin;
  if (gostOn && geo) {
    const st = regionStats({ ...DEFAULT_GOST, ...(c.gost ?? {}) }, geo.km);
    k = kOfG(st.gMean);
    kMin = kOfG(st.gMean + 4.3 * st.sigmaR);
  }
  const uNorm = 100 - c.availabilityPct;
  const D = path.D;
  const channels = link.channels
    .map((ch, i) => ({ ch, n: (i + 1) as 1 | 2 }))
    .filter(({ ch, n }) => (n === 1 || ch.enabled) && ch.freqMHz > 0);
  if (!channels.length) errors.push('Укажите частоту ствола 1.');
  const lowest = channels.length ? channels.reduce((a, b) => (b.ch.freqMHz < a.ch.freqMHz ? b : a)) : null;
  const fRef = lowest ? lowest.ch.freqMHz / 1000 : 6;
  const geom = geometry(path, k, fRef);
  const geomMin = geometry(path, kMin, fRef);
  const tiltA = deg(Math.atan((path.HB - path.HA) / (D * 1000))) - deg(D / (2 * k * EARTH_R_KM));
  const tiltB = deg(Math.atan((path.HA - path.HB) / (D * 1000))) - deg(D / (2 * k * EARTH_R_KM));

  const coChannel = channelsShareFrequency(link);
  const samePol = channels.length === 2 && channels[0].ch.pol === channels[1].ch.pol;
  const xpd = link.xpdA != null && link.xpdB != null ? Math.min(link.xpdA, link.xpdB) : null;
  // Interference between the channels exists only when they share a frequency:
  // same polarization → full co-channel interference; orthogonal → limited by antenna XPD.
  const ci = coChannel ? (samePol ? 0 : xpd ?? Infinity) : Infinity;
  const ctx: Ctx = { link, path, k, kMin, slope: Math.abs(path.HA - path.HB) / D, hLow: Math.min(path.HA, path.HB), uNorm, ci, A, B, neighbors };
  const results = channels.map(({ ch, n }) => calcChannel(ctx, ch, n));
  const multi = results.length > 1;
  const totalRate = Math.round(results.reduce((s, r) => s + (r.best ? r.best.rateMbps : 0), 0) * 10) / 10;
  const cs = clearanceState(geom.crit ? geom.crit.rel : null);

  /* verdict */
  const allOk = results.length > 0 && results.every((r) => r.best);
  const someOk = results.some((r) => r.best);
  const anyWork = results.some((r) => r.working.length);
  const level: Level = errors.length ? 'bad' : allOk ? 'ok' : someOk || anyWork ? 'warn' : 'bad';
  let title = '', sub = '';
  const nm = `${A.name || 'A'} — ${B.name || 'B'}`;
  if (errors.length) {
    title = 'Расчёт невозможен';
    sub = errors.join(' ');
  } else if (!multi) {
    const r = results[0];
    if (r.best) {
      title = `Пролёт ${nm} рабочий. Максимум в пределах нормы: ${r.best.name}, ${fmt(r.best.rateMbps, 1)} Мбит/с`;
      sub = `На этой скорости связь будет прерываться примерно на ${downtime(r.best.u)} в год при допустимых ${downtime(uNorm)}.`;
    } else if (r.working.length) {
      title = 'Связь будет, но норму надёжности не выдерживает ни один режим';
      sub = 'Поднимите антенны, возьмите антенны больше или режим с более низким порогом.';
    } else {
      title = 'Сигнала не хватает: приёмник не услышит передатчик';
      sub = r.modes.length ? 'Уровень сигнала ниже порога во всех режимах. Нужны антенны больше, выше мощность или короче пролёт.' : 'Добавьте типы модуляции ППУ и внесите скорость, мощность и порог из паспорта.';
    }
  } else {
    title = allOk ? `Пролёт ${nm} рабочий. Два ствола дают ${fmt(totalRate, 1)} Мбит/с в пределах нормы`
      : someOk ? `Норму выполняет только один ствол: ${fmt(totalRate, 1)} Мбит/с`
      : anyWork ? 'Связь будет, но норму не выполняет ни один ствол' : 'Сигнала не хватает ни в одном стволе';
    sub = results.map((r) => `${r.tag} (${r.label}): ${r.best ? `${r.best.name}, ${fmt(r.best.rateMbps, 1)} Мбит/с, перерывы ≈ ${downtime(r.best.u)} в год` : 'норма не выполняется'}`).join('. ') + `. Допустимо ${downtime(uNorm)} в год.`;
  }
  const protN = protectionOf(link);
  if (protN && !errors.length) sub += ` Схема резервирования: ${SCHEME_SHORT[protN.scheme]}.`;
  const label = level === 'ok' ? 'Норма выполнена' : level === 'warn' ? 'Норма выполнена не везде' : errors.length ? 'Ошибка данных' : 'Связи нет';

  const base: LinkResult = {
    ok: !errors.length, errors, warnings, siteA: A, siteB: B, climate: link.climate, geo, path, k, kMin, geom, geomMin,
    clearance: { rel: geom.crit ? geom.crit.rel : null, ...cs }, tiltA, tiltB, channels: results, multi, coChannel, samePol, xpd,
    uNorm, totalRate, avgRate: Math.round(results.reduce((s, x) => s + x.avgRate, 0) * 10) / 10, verdict: { level, label, title, sub }, recs: [], polarization: { channels: [], pair: null }, water: waterShare(path), method: gostOn ? 'gost' : 'itu'
  };
  if (!errors.length && results.length) {
    base.polarization = comparePolarization(base, ctx);
    base.recs = buildRecommendations(base);
  }
  return base;
}

export type { Ctx as ChannelContext };
