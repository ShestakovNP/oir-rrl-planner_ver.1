/**
 * Link budget and availability for one hop with up to two radio channels on a
 * shared antenna. Pure functions: no UI, no storage, no network.
 */
import type { Channel, Climate, Link, ModMode, Pol, ProfilePoint, Site } from '../types';
import { deg, vincenty, type Geodesic } from './geo';
import {
  EARTH_R_KM, beamwidth, dishGain, fsl, gasAttenuation, knifeEdge, multipathWorstMonth, rainModel, requiredSnr, type RainModel
} from './physics';
import { downtime, fmt, ghz, polName } from './format';
import { buildRecommendations, type Rec } from './recommend';
import { comparePolarization, type PolarizationResult } from './polarization';

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
  verdict: { level: Level; label: string; title: string; sub: string };
  recs: Rec[];
  polarization: PolarizationResult;
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
      return { d, g: a.g + (b.g - a.g) * t, c: a.c + (b.c - a.c) * t };
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
    const o: Sample = { d, g: q.g + bulge, top, los, F1, H: los - top };
    if (d > D * 0.005 && d < D * 0.995 && F1 > 0) {
      const rel = o.H / F1;
      if (!crit || rel < crit.rel) crit = { ...o, rel };
    }
    return o;
  });
  return { s, crit };
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
    .map((p) => ({ d: p.d, g: p.g, c: Math.max(0, Number.isFinite(p.c) ? p.c : 0) }))
    .sort((a, b) => a.d - b.d);
  let D = geo ? geo.km : 0;
  if (pts.length < 2) {
    const gA = A.groundM ?? 0, gB = B.groundM ?? 0;
    pts = [{ d: 0, g: gA, c: 0 }, { d: D, g: gB, c: 0 }];
    warnings.push('Профиль трассы не задан: считаю ровную землю между площадками. Загрузите профиль по SRTM или введите его вручную.');
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
}

export function calcChannel(ctx: Ctx, ch: Channel, n: 1 | 2, polOverride?: Pol): ChannelResult {
  const { link, path, k, kMin, slope, hLow, uNorm, ci } = ctx;
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
  const fixed = gA + gB - link.feederA - link.feederB - link.otherLoss - 2 * ch.combinerLossDb;
  const rain = rainModel(fGHz, D, link.climate.rainR001, pol);
  const c = link.climate;
  const modes: ModeResult[] = ch.modes
    .filter((m) => Number.isFinite(m.txDbm) && Number.isFinite(m.thresholdDbm))
    .map((m) => {
      const degr = Number.isFinite(ci) ? 10 * Math.log10(1 + Math.pow(10, (requiredSnr(m.name) - ci) / 10)) : 0;
      const prx = m.txDbm + fixed - FSL - diff - gas;
      const margin = prx - m.thresholdDbm - degr;
      const mpMonth = multipathWorstMonth(D, fGHz, c.dN1, slope, hLow, margin);
      const mpYear = mpMonth * c.monthToYear;
      const rainYear = rain.pFor(margin);
      const u = Math.min(100, mpYear + rainYear);
      return { ...m, prx, deg: degr, margin, mpMonth, mpYear, rainYear, u, subOk: diffMin - diff < margin, ok: margin > 0 && u <= uNorm };
    });
  const pick = (list: ModeResult[]) => (list.length ? list.reduce((a, b) => (b.rateMbps > a.rateMbps ? b : a)) : null);
  const okList = modes.filter((r) => r.ok);
  const working = modes.filter((r) => r.margin > 0);
  const best = pick(okList);
  const top = pick(working);
  const next = modes.slice().sort((a, b) => a.rateMbps - b.rateMbps).find((r) => !r.ok && (!best || r.rateMbps > best.rateMbps)) || null;
  const unav = (M: number) => Math.min(100, multipathWorstMonth(D, fGHz, c.dN1, slope, hLow, M) * c.monthToYear + rain.pFor(M));
  let lo = 0, hi = 90;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (unav(m) > uNorm) lo = m;
    else hi = m;
  }
  return {
    n, ch, tag: 'К' + n, label: `${ghz(ch.freqMHz)} · ${polName(pol)}`, fGHz, pol, geom, geomMin, FSL, diff, diffMin, gasK, gas,
    gA, gB, gAcalc, gBcalc, beamA: beamwidth(link.dishA, fGHz), beamB: beamwidth(link.dishB, fGHz), fixed, rain, modes,
    best, working, top, next, ref: best || working[0] || modes[0] || null, marginRequired: hi
  };
}

export function calculateLink(link: Link, A: Site, B: Site): LinkResult {
  const errors: string[] = [];
  const geoOk = [A.lat, A.lon, B.lat, B.lon].every(Number.isFinite) && Math.abs(A.lat) <= 90 && Math.abs(B.lat) <= 90;
  let geo: Geodesic | null = null;
  if (geoOk) {
    const v = vincenty(A.lat, A.lon, B.lat, B.lon);
    if (v.km > 0.01) geo = v;
    else errors.push('Площадки совпадают или стоят ближе 10 м друг к другу.');
  } else errors.push('У площадок не заданы корректные координаты.');
  const { path, warnings } = buildPath(link, A, B, geo);
  const c = link.climate;
  const k = c.k, kMin = c.kMin;
  const uNorm = 100 - c.availabilityPct;
  const D = path.D;
  const channels = link.channels
    .map((ch, i) => ({ ch, n: (i + 1) as 1 | 2 }))
    .filter(({ ch, n }) => (n === 1 || ch.enabled) && ch.freqMHz > 0);
  if (!channels.length) errors.push('Укажите частоту канала 1.');
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
  const ctx: Ctx = { link, path, k, kMin, slope: Math.abs(path.HA - path.HB) / D, hLow: Math.min(path.HA, path.HB), uNorm, ci };
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
      sub = r.modes.length ? 'Уровень сигнала ниже порога во всех режимах. Нужны антенны больше, выше мощность или короче пролёт.' : 'Добавьте режимы модуляции ППУ.';
    }
  } else {
    title = allOk ? `Пролёт ${nm} рабочий. Два канала дают ${fmt(totalRate, 1)} Мбит/с в пределах нормы`
      : someOk ? `Норму выполняет только один канал: ${fmt(totalRate, 1)} Мбит/с`
      : anyWork ? 'Связь будет, но норму не выполняет ни один канал' : 'Сигнала не хватает ни в одном канале';
    sub = results.map((r) => `${r.tag} (${r.label}): ${r.best ? `${r.best.name}, ${fmt(r.best.rateMbps, 1)} Мбит/с, перерывы ≈ ${downtime(r.best.u)} в год` : 'норма не выполняется'}`).join('. ') + `. Допустимо ${downtime(uNorm)} в год.`;
  }
  const label = level === 'ok' ? 'Норма выполнена' : level === 'warn' ? 'Норма выполнена не везде' : errors.length ? 'Ошибка данных' : 'Связи нет';

  const base: LinkResult = {
    ok: !errors.length, errors, warnings, siteA: A, siteB: B, climate: link.climate, geo, path, k, kMin, geom, geomMin,
    clearance: { rel: geom.crit ? geom.crit.rel : null, ...cs }, tiltA, tiltB, channels: results, multi, coChannel, samePol, xpd,
    uNorm, totalRate, verdict: { level, label, title, sub }, recs: [], polarization: { channels: [], pair: null }
  };
  if (!errors.length && results.length) {
    base.polarization = comparePolarization(base, ctx);
    base.recs = buildRecommendations(base);
  }
  return base;
}

export type { Ctx as ChannelContext };
