/** Text rows describing the protection scheme of one channel, shared by the screen and the PDF. */
import type { ChannelResult, LinkResult } from './link';
import { SCHEME_NAMES } from './protection';
import { downtime, fmt, pct } from './format';
import { GOST_RAIN_XI } from './gost';

export interface ProtRow { t: string; s: string; v: string }

const relTxt = (x: number | null) => (x == null ? '—' : x > 3 ? '> 300%' : Math.round(x * 100) + '%');

export function protectionRows(r: LinkResult, c: ChannelResult): ProtRow[] {
  const d = c.div;
  if (!d) return [];
  const rows: ProtRow[] = [{ t: 'Схема резервирования', s: '', v: SCHEME_NAMES[d.scheme] }];
  if (d.scheme === 'hsb') rows.push({ t: 'Потери в делителях HSB', s: 'на двух концах, уже в уровне сигнала', v: fmt(d.hsbLoss, 1) + ' дБ' });
  const branch = (b: NonNullable<typeof d.a>, nm: string) =>
    rows.push({ t: `Вторая антенна на «${nm}»`, s: `разнос ${fmt(b.S, 1)} м, просвет ${relTxt(b.rel)} (в плохую погоду ${relTxt(b.relMin)}), разница уровней ${fmt(Math.abs(b.V), 1)} дБ`, v: `I = ${fmt(b.I, 1)}` });
  if (d.a) branch(d.a, r.siteA.name || 'A');
  if (d.b) branch(d.b, r.siteB.name || 'B');
  if (d.scheme === 'fd') rows.push({ t: 'Выигрыш от частотного разнесения', s: r.method === 'gost' ? 'ГОСТ Р 53363-2009, (14.8)' : 'МСЭ-R P.530', v: `I = ${fmt(d.I, 1)}` });
  const gost = r.method === 'gost';
  if ((d.scheme === 'sd' || d.scheme === 'fd') && gost)
    rows.push({ t: 'Многолучёвые замирания p мл', s: `без резервирования → с ним, % худшего месяца, при запасе ${c.ref ? c.ref.name : ''} (ГОСТ Р 53363-2009, раздел 14)`, v: `${pct(d.mpPlain)} → ${pct(d.mpDiv)}` });
  else if (d.scheme === 'sd' || d.scheme === 'fd')
    rows.push({ t: 'Перерывы из-за многолучёвости', s: `без резервирования → с ним, при запасе ${c.ref ? c.ref.name : ''}`, v: `${downtime(d.mpPlain)} → ${downtime(d.mpDiv)}` });
  return rows;
}

/** Rows about interference from other links at the same objects. */
export function interferenceRows(r: LinkResult, c: ChannelResult): ProtRow[] {
  if (!c.intf) return [];
  const prx = c.ref ? c.ref.prx : NaN;
  return c.intf.list.map((x) => ({
    t: `Помеха от пролёта «${x.name}»`,
    s: `на «${x.at === 'A' ? r.siteA.name : r.siteB.name}», ${fmt(x.fMHz, 0)} МГц, угол ${fmt(x.theta, 1)}°, усиление антенны в эту сторону ${fmt(x.gTheta, 1)} дБи${x.samePol ? ', та же поляризация' : x.xpd > 0 ? `, развязка поляризаций ${fmt(x.xpd, 0)} дБ` : ', поляризация другая, XPD не указана'}`,
    v: Number.isFinite(prx) ? `${fmt(x.I, 1)} дБм · C/I ${fmt(prx - x.I, 1)} дБ` : `${fmt(x.I, 1)} дБм`
  }));
}

/** Percentage for small probabilities with three significant digits (no exponent: the PDF font has no superscripts). */
export const pctE = (x: number) => {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0 %';
  if (x >= 0.01) return fmt(x, x >= 1 ? 2 : 4) + ' %';
  const d = Math.min(12, 2 - Math.floor(Math.log10(x)));
  return fmt(x, d) + ' %';
};

/** Steps of ГОСТ Р 53363-2009 for one channel (reference mode). */
export function gostRows(r: LinkResult, c: ChannelResult): ProtRow[] {
  const g = c.gost, m = c.ref, mg = m?.g;
  if (!g) return [];
  const rows: ProtRow[] = [
    { t: 'Рефракция по ГОСТ', s: `район ${g.params.region} (${g.params.season === 'winter' ? 'зима' : 'лето'}); ḡ = ${fmt(g.gMean * 1e8, 1)}, σ = ${fmt(g.sigma * 1e8, 1)}${Math.abs(g.sigmaR - g.sigma) > 1e-10 ? `, σ(R) = ${fmt(g.sigmaR * 1e8, 1)}` : ''} (·10^−8 1/м)`, v: `k = ${fmt(r.k, 2)} … ${fmt(r.kMin, 2)}` },
    { t: 'Тип трассы', s: `средняя высота антенн ${fmt(g.hMean, 0)} м н.у.м., наклон ${fmt(g.eps, 1)} мрад, просвет p(ḡ) = ${fmt(g.pRel, 2)}`, v: g.kind === 'hilly' ? 'пересечённая' : g.kind === 'mountain' ? 'горная (13.24)' : 'высокогорная (13.3)' }
  ];
  if (m && mg) {
    rows.push({ t: `Многолучёвость, ${m.name}`, s: `p₀ ${pctE(mg.p0)}; гладкие ${pctE(mg.pFlat)}, селективные ${pctE(mg.pSel)}${Number.isFinite(mg.Fsel) ? ` (F сел = ${fmt(mg.Fsel, 1)} дБ)` : ''}${mg.I > 1 ? `, разнесение I = ${fmt(mg.I, 1)}` : ''}`, v: pctE(mg.pMl) });
    rows.push({ t: 'Субрефракция', s: 'раздел 12, % худшего месяца', v: pctE(mg.pSub) });
    rows.push({ t: 'Дождь', s: `ξ = ${fmt((GOST_RAIN_XI[g.params.rainTerritory] ?? GOST_RAIN_XI[0]).xi, 2)}, J = ${fmt(g.J, 1)} мм/ч, γ = ${fmt(g.gamma, 3)} дБ/км`, v: `AS ${pctE(mg.rainAS)}` });
    rows.push({ t: 'SESR', s: `многолучёвость ${pctE(mg.sesrMl)} + дождь ${pctE(mg.sesrRain)} + субрефракция ${pctE(mg.sesrSub)}${g.params.sesrNormPct ? `; норма ${pctE(g.params.sesrNormPct)}` : ''}`, v: pctE(mg.sesr) });
    rows.push({ t: 'Коэффициент неготовности K нг', s: `аппаратура ${pctE(mg.kApp)} + дождь ${pctE(mg.kRain)} + многолучёвость ${pctE(mg.kMl)} + субрефракция ${pctE(mg.kSub)}`, v: `${pctE(m.u)} · ${downtime(m.u)}` });
  }
  g.notes.forEach((n) => rows.push({ t: 'Примечание', s: n, v: '' }));
  return rows;
}
