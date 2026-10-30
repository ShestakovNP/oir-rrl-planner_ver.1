/** PDF reports: one link, or a whole project (summary page + one section per link). */
import { PdfDoc } from './pdf/writer';
import type { Link, Project } from '../data/types';
import { surfaceRuns, type Level, type LinkResult } from '../data/calc/link';
import { downtime, fmt, ghz, pct, polLong, polName, stripMarks } from '../data/calc/format';
import { formatDms, n360 } from '../data/calc/geo';
import { APP_NAME, ORG_FULL } from '../config';

export interface ReportItem { link: Link; result: LinkResult }

const C = {
  ink: '#1a2129', muted: '#5a6876', body: '#36414c', line: '#d3dbe2', soft: '#f2f5f8', accent: '#1d5bb8', accentSoft: '#e2ebf8',
  ok: '#1c7f47', okSoft: '#e1f2e8', warn: '#9a6513', warnSoft: '#f7ebd6', bad: '#b53a2a', badSoft: '#f8e3df',
  ground: '#c3cad1', groundEdge: '#6f7b86', forest: '#3b8a57', building: '#b0703f', water: '#2b8fe0', clutter: '#7f8f6a', fresnel: '#cfdcf0', fresnelEdge: '#7d9fd4', navy: '#0e2a47', teal: '#38c6b0', blue: '#4fa3ff'
};
const SEM: Record<Level, string> = { ok: C.ok, warn: C.warn, bad: C.bad, info: C.accent };
const SEMS: Record<Level, string> = { ok: C.okSoft, warn: C.warnSoft, bad: C.badSoft, info: C.accentSoft };

type Cell = string | { t: string; bold?: boolean; color?: string; fill?: string };
type Row = Cell[] & { bg?: string; mark?: string };
interface Col { t: string; w: number; align?: 'right' }

class Layout {
  readonly M = 42;
  readonly CW: number;
  readonly BOTTOM: number;
  y = 0;
  constructor(readonly pdf: PdfDoc) {
    this.CW = pdf.W - 2 * this.M;
    this.BOTTOM = pdf.H - 48;
  }
  newPage() { this.pdf.addPage(); this.y = this.M + 14; }
  need(h: number) { if (this.y + h > this.BOTTOM) this.newPage(); }
  para(t: string, o: { size?: number; color?: string; bold?: boolean } = {}) {
    const size = o.size ?? 9.5, lh = size * 1.38;
    const lines = this.pdf.wrap(stripMarks(t), this.CW, size, o.bold ? 'B' : 'R');
    if (lines.length <= 8) this.need(lines.length * lh);
    lines.forEach((l) => { this.need(lh); this.pdf.text(this.M, this.y + size, l, { size, bold: o.bold, color: o.color ?? C.ink }); this.y += lh; });
  }
  h1(t: string) {
    this.pdf.wrap(t, this.CW, 19, 'B').forEach((l) => { this.pdf.text(this.M, this.y + 19, l, { size: 19, bold: true }); this.y += 25; });
    this.y += 4;
  }
  h2(t: string, follow = 60) {
    this.need(30 + follow);
    this.y += 10;
    this.pdf.text(this.M, this.y + 13, t, { size: 13, bold: true });
    this.y += 20;
    this.pdf.line(this.M, this.y, this.M + this.CW, this.y, { stroke: C.accent, w: 1 });
    this.y += 8;
  }
  h3(t: string) { this.need(70); this.y += 4; this.pdf.text(this.M, this.y + 10, t, { size: 10.5, bold: true }); this.y += 16; }
  table(cols: Col[], rows: Row[], o: { size?: number } = {}) {
    const { pdf, M, CW } = this;
    const size = o.size ?? 8.6, pad = 4, lh = size * 1.3, hs = size - 0.6;
    const tw = cols.reduce((s, c) => s + c.w, 0), ws = cols.map((c) => (c.w * CW) / tw);
    const hl = cols.map((c, i) => pdf.wrap(c.t, ws[i] - 2 * pad, hs, 'B'));
    const hh = Math.max(...hl.map((l) => l.length)) * hs * 1.25 + 2 * pad;
    const head = () => {
      this.need(hh + lh + 2 * pad);
      let x = M;
      pdf.rect(M, this.y, CW, hh, { fill: C.soft });
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? x + ws[i] - pad : x + pad;
        hl[i].forEach((l, li) => pdf.text(tx, this.y + pad + hs + li * hs * 1.25, l, { size: hs, bold: true, color: C.muted, align: c.align }));
        x += ws[i];
      });
      this.y += hh;
    };
    head();
    rows.forEach((r) => {
      const cells = r.map((c) => (typeof c === 'string' ? { t: c } : c));
      const lines = cells.map((c, i) => pdf.wrap(stripMarks(c.t), ws[i] - 2 * pad, size, c.bold ? 'B' : 'R'));
      const rh = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad;
      if (this.y + rh > this.BOTTOM) { this.newPage(); head(); }
      let x = M;
      if (r.bg) pdf.rect(M, this.y, CW, rh, { fill: r.bg });
      cells.forEach((c, i) => {
        if (c.fill) pdf.rect(x, this.y, ws[i], rh, { fill: c.fill });
        lines[i].forEach((l, li) => {
          const tx = cols[i].align === 'right' ? x + ws[i] - pad : x + pad;
          pdf.text(tx, this.y + pad + size + li * lh, l, { size, bold: c.bold, color: c.color ?? C.ink, align: cols[i].align });
        });
        x += ws[i];
      });
      if (r.mark) pdf.rect(M, this.y, 2.5, rh, { fill: r.mark });
      this.y += rh;
      pdf.line(M, this.y, M + CW, this.y, { stroke: C.line, w: 0.5 });
    });
    this.y += 6;
  }
}

const row = (cells: Cell[], extra: { bg?: string; mark?: string } = {}): Row => Object.assign(cells, extra);

function roundRect(x: number, y: number, w: number, h: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}

/** The ОИР mark drawn with vector primitives (same geometry as src/brand/oir-mark.svg). */
function drawMark(pdf: PdfDoc, x: number, y: number, s: number) {
  const k = s / 64, P = (px: number, py: number): [number, number] => [x + px * k, y + py * k];
  pdf.poly(roundRect(x, y, s, s, 15 * k), { fill: C.navy });
  const lens: [number, number][] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; lens.push(P((1 - t) ** 2 * 15 + 2 * (1 - t) * t * 32 + t * t * 49, (1 - t) ** 2 * 22.5 + 2 * (1 - t) * t * 11 + t * t * 29.5)); }
  for (let i = 0; i <= 12; i++) { const t = i / 12; lens.push(P((1 - t) ** 2 * 49 + 2 * (1 - t) * t * 32 + t * t * 15, (1 - t) ** 2 * 29.5 + 2 * (1 - t) * t * 41 + t * t * 22.5)); }
  pdf.poly(lens, { fill: '#2f7fa8', stroke: C.teal, w: 1.6 * k });
  pdf.line(...P(15, 22.5), ...P(49, 29.5), { stroke: '#ffffff', w: 1.8 * k });
  pdf.line(...P(15, 22.5), ...P(15, 48), { stroke: '#ffffff', w: 3 * k });
  pdf.line(...P(49, 29.5), ...P(49, 48), { stroke: '#ffffff', w: 3 * k });
  pdf.circle(...P(15, 22.5), 3.4 * k, { fill: C.teal, stroke: '#ffffff', w: 1.4 * k });
  pdf.circle(...P(49, 29.5), 3.4 * k, { fill: C.blue, stroke: '#ffffff', w: 1.4 * k });
}

function profileChart(L: Layout, r: LinkResult) {
  const { pdf, M, CW } = L;
  const ph = 210;
  L.h2('Профиль трассы', ph + 30);
  const P = r.path, s = r.geom.s;
  const ml = 34, mr = 10, mt = 16, mb = 20, X0 = M + ml, X1 = M + CW - mr, Y0 = L.y + mt, Y1 = L.y + ph - mb;
  let ymin = Infinity, ymax = -Infinity;
  s.forEach((o) => { ymin = Math.min(ymin, o.g); ymax = Math.max(ymax, o.los + o.F1, o.top); });
  ymin = Math.floor(ymin - 4); ymax = Math.ceil(ymax + 6);
  const X = (d: number) => X0 + ((X1 - X0) * d) / P.D, Y = (v: number) => Y1 - ((Y1 - Y0) * (v - ymin)) / (ymax - ymin);
  const nice = (range: number, n: number) => { const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), q = raw / p; return (q < 1.5 ? 1 : q < 3 ? 2 : q < 7 ? 5 : 10) * p; };
  const ys = nice(ymax - ymin, 6);
  for (let v = Math.ceil(ymin / ys) * ys; v <= ymax; v += ys) { pdf.line(X0, Y(v), X1, Y(v), { stroke: '#e6ebef', w: 0.4 }); pdf.text(X0 - 4, Y(v) + 3, String(Math.round(v)), { size: 7, color: C.muted, align: 'right' }); }
  const xs = nice(P.D, 8);
  for (let d = 0; d <= P.D + 1e-9; d += xs) pdf.text(X(d), Y1 + 11, fmt(d, xs < 1 ? 1 : 0), { size: 7, color: C.muted, align: 'center' });
  pdf.text(X1, Y1 + 19, 'км', { size: 7, color: C.muted, align: 'right' });
  pdf.text(M, Y0 - 5, 'м', { size: 7, color: C.muted });
  pdf.poly([...s.map((o) => [X(o.d), Y(o.los + o.F1)] as [number, number]), ...s.slice().reverse().map((o) => [X(o.d), Y(o.los - o.F1)] as [number, number])], { fill: C.fresnel, stroke: C.fresnelEdge, w: 0.5, dash: [2, 2] });
  pdf.poly([[X(0), Y1], ...s.map((o) => [X(o.d), Math.min(Y1, Y(o.g))] as [number, number]), [X(P.D), Y1]], { fill: C.ground, stroke: C.groundEdge, w: 0.6 });
  const runs = surfaceRuns(s);
  runs.filter((r0) => r0.kind !== 'w').forEach((r0) => {
    const part = s.slice(Math.max(0, r0.from - 1), Math.min(s.length, r0.to + 2));
    pdf.poly([...part.map((o) => [X(o.d), Y(o.top)] as [number, number]), ...part.slice().reverse().map((o) => [X(o.d), Y(o.g)] as [number, number])], { fill: r0.kind === 'b' ? C.building : r0.kind === 'f' ? C.forest : C.clutter });
  });
  runs.filter((r0) => r0.kind === 'w').forEach((r0) => {
    const part = s.slice(r0.from, r0.to + 1);
    for (let i = 1; i < part.length; i++) pdf.line(X(part[i - 1].d), Y(part[i - 1].g), X(part[i].d), Y(part[i].g), { stroke: C.water, w: 3 });
    if (part.length === 1) pdf.circle(X(part[0].d), Y(part[0].g), 1.5, { fill: C.water });
  });
  pdf.line(X(0), Y(P.HA), X(P.D), Y(P.HB), { stroke: C.accent, w: 1.2 });
  pdf.line(X(0), Y(P.gA0), X(0), Y(P.HA), { stroke: C.ink, w: 1.5 });
  pdf.line(X(P.D), Y(P.gB0), X(P.D), Y(P.HB), { stroke: C.ink, w: 1.5 });
  pdf.text(X(0) + 5, Y(P.HA) - 5, `${r.siteA.name} · ${fmt(P.hA, 0)} м`, { size: 8, bold: true });
  pdf.text(X(P.D) - 5, Y(P.HB) - 5, `${fmt(P.hB, 0)} м · ${r.siteB.name}`, { size: 8, bold: true, align: 'right' });
  const c = r.geom.crit;
  if (c) { const cx = X(c.d); pdf.line(cx, Y(c.top), cx, Y(c.los), { stroke: C.bad, w: 1, dash: [2, 2] }); pdf.circle(cx, Y(c.top), 2.2, { fill: C.bad }); }
  L.y += ph;
  let lx = M;
  ([['Рельеф', C.ground], ['Здания', C.building], ['Лес', C.forest], ['Вода', C.water], ['Зона Френеля', C.fresnel], ['Луч', C.accent], ['Узкое место', C.bad]] as const).forEach(([t, col]) => {
    pdf.rect(lx, L.y + 2, 10, 6, { fill: col });
    pdf.text(lx + 14, L.y + 8, t, { size: 7.5, color: C.muted });
    lx += pdf.width(t, 7.5) + 30;
  });
  L.y += 16;
  if (c) {
    const relTxt = c.rel > 3 ? `в ${fmt(c.rel, 0)} раз больше` : `${Math.round(c.rel * 100)}%`;
    const lowest = r.channels.reduce((a, b) => (b.fGHz < a.fGHz ? b : a));
    L.para(`Самое узкое место — на ${fmt(c.d, 2)} км от объекта «${r.siteA.name}»: между лучом и верхушкой препятствия ${fmt(c.H, 1)} м, это ${relTxt} радиуса зоны Френеля (${fmt(c.F1, 1)} м${r.multi ? ' на ' + ghz(lowest.ch.freqMHz) : ''}). ${r.clearance.label}.`, { size: 9 });
  }
}

function linkSection(L: Layout, it: ReportItem, project: Project | null, date: string) {
  const { pdf, M, CW } = L;
  const { link, result: r } = it;
  const A = r.siteA, B = r.siteB;
  L.newPage();
  L.y = M;
  drawMark(pdf, M, L.y - 2, 13);
  pdf.text(M + 19, L.y + 8.5, `${APP_NAME.toUpperCase()} · РАСЧЁТ ПРОЛЁТА${project ? ' · ' + project.name.toUpperCase() : ''}`, { size: 7.5, color: C.muted });
  pdf.text(M + CW, L.y + 8.5, date, { size: 7.5, color: C.muted, align: 'right' });
  L.y += 22;
  L.h1(`${A.name} — ${B.name}`);

  /* verdict */
  const V = r.verdict, vc = SEM[V.level], vs = SEMS[V.level];
  const tl = pdf.wrap(V.title, CW - 24, 12, 'B'), sl = pdf.wrap(V.sub, CW - 24, 9.5, 'R');
  const vh = 14 + tl.length * 16 + 6 + sl.length * 13 + 12 + 20;
  pdf.rect(M, L.y, CW, vh, { fill: vs });
  pdf.rect(M, L.y, 3, vh, { fill: vc });
  let yy = L.y + 14;
  pdf.text(M + 14, yy + 8, V.label.toUpperCase(), { size: 8, bold: true, color: vc });
  yy += 14;
  tl.forEach((l) => { pdf.text(M + 14, yy + 12, l, { size: 12, bold: true }); yy += 16; });
  yy += 4;
  sl.forEach((l) => { pdf.text(M + 14, yy + 9.5, l, { size: 9.5 }); yy += 13; });
  L.y += vh + 10;
  const facts: [string, string, string][] = [
    ['Длина пролёта', fmt(r.path.D, 2), 'км'],
    ['Просвет', r.clearance.rel == null ? '—' : r.clearance.rel > 3 ? '> 300%' : Math.round(r.clearance.rel * 100) + '%', r.clearance.label.toLowerCase()],
    r.multi ? ['Скорость в норме', fmt(r.totalRate, 1), 'Мбит/с, сумма каналов'] : ['Запас' + (r.channels[0]?.ref ? ' ' + r.channels[0].ref.name : ''), r.channels[0]?.ref ? fmt(r.channels[0].ref.margin, 1) : '—', 'дБ']
  ];
  const fw = (CW - 20) / 3;
  facts.forEach((f, i) => {
    const x = M + i * (fw + 10);
    pdf.rect(x, L.y, fw, 52, { fill: C.soft });
    pdf.text(x + 10, L.y + 14, f[0], { size: 8, color: C.muted });
    pdf.text(x + 10, L.y + 34, f[1], { size: 16, bold: true });
    pdf.text(x + 10, L.y + 46, f[2], { size: 8, color: C.muted });
  });
  L.y += 62;

  /* sites */
  L.h2('Объекты и антенны');
  L.table([{ t: 'Параметр', w: 42 }, { t: A.name, w: 29 }, { t: B.name, w: 29 }], [
    row(['Номер / код', A.code || '—', B.code || '—']),
    row(['Широта', formatDms(A.lat, true) + ` (${fmt(A.lat, 6)})`, formatDms(B.lat, true) + ` (${fmt(B.lat, 6)})`]),
    row(['Долгота', formatDms(A.lon, false) + ` (${fmt(A.lon, 6)})`, formatDms(B.lon, false) + ` (${fmt(B.lon, 6)})`]),
    row(['Высота земли, м', fmt(r.path.gA0, 0), fmt(r.path.gB0, 0)]),
    row(['Высота подвеса антенны, м', fmt(r.path.hA, 0), fmt(r.path.hB, 0)]),
    row(['Высота антенны над уровнем моря, м', fmt(r.path.HA, 0), fmt(r.path.HB, 0)]),
    row(['Антенна', `${link.antennaA ? link.antennaA + ', ' : ''}${fmt(link.dishA, 1)} м`, `${link.antennaB ? link.antennaB + ', ' : ''}${fmt(link.dishB, 1)} м`]),
    ...(r.coChannel ? [row(['Развязка поляризаций (XPD), дБ', link.xpdA != null ? fmt(link.xpdA, 0) : 'не указана', link.xpdB != null ? fmt(link.xpdB, 0) : 'не указана'])] : []),
    row(['Потери в фидере, дБ', fmt(link.feederA, 1), fmt(link.feederB, 1)])
  ]);

  L.h2('Радиоканалы');
  L.table([{ t: 'Параметр', w: 42 }, ...r.channels.map((c) => ({ t: r.multi ? 'Канал ' + c.n : 'Канал', w: 58 / r.channels.length }))], [
    row(['ППУ (приёмо-передающее устройство)', ...r.channels.map((c) => c.ch.radioName || '—')]),
    row(['Частота, МГц', ...r.channels.map((c) => fmt(c.ch.freqMHz, 0))]),
    row(['Полоса, МГц', ...r.channels.map((c) => fmt(c.ch.bwMHz, 0))]),
    row(['Поляризация', ...r.channels.map((c) => polName(c.pol))]),
    row(['Коэффициент усиления антенны A, дБ', ...r.channels.map((c) => fmt(c.gA, 1) + (c.ch.gainA == null ? ' (расчётный)' : ''))]),
    row(['Коэффициент усиления антенны B, дБ', ...r.channels.map((c) => fmt(c.gB, 1) + (c.ch.gainB == null ? ' (расчётный)' : ''))]),
    row(['Ширина луча A / B', ...r.channels.map((c) => `${fmt(c.beamA, 1)}° / ${fmt(c.beamB, 1)}°`)]),
    row(['Потери на объединение, дБ (каждый конец)', ...r.channels.map((c) => fmt(c.ch.combinerLossDb, 1))]),
    row(['Прочие потери на пролёте, дБ', ...r.channels.map(() => fmt(link.otherLoss, 1))])
  ]);

  profileChart(L, r);

  if (r.geo) {
    L.h2('Наведение антенн');
    const decl = link.declination;
    L.table([{ t: '', w: 40 }, { t: A.name, w: 30 }, { t: B.name, w: 30 }], [
      row(['Азимут истинный', fmt(r.geo.az1, 1) + '°', fmt(r.geo.az2, 1) + '°']),
      ...(decl != null ? [row([`Азимут по компасу (склонение ${fmt(decl, 1)}°)`, fmt(n360(r.geo.az1 - decl), 1) + '°', fmt(n360(r.geo.az2 - decl), 1) + '°'])] : []),
      row(['Угол места', fmt(r.tiltA, 2) + '°', fmt(r.tiltB, 2) + '°']),
      row(['Направление', `на «${B.name}»`, `на «${A.name}»`]),
      ...r.channels.filter((c) => c.ref).map((c) => row([`Ожидаемый уровень при юстировке${r.multi ? ', ' + c.tag : ''}`, fmt(c.ref!.prx, 1) + ' дБм', fmt(c.ref!.prx, 1) + ' дБм']))
    ]);
  }

  L.h2('Результаты по режимам модуляции');
  L.para(`Допустимая неготовность: ${pct(r.uNorm)} в год (${downtime(r.uNorm)}), доступность ${fmt(r.climate.availabilityPct, 5)} %. «Запас» — на сколько децибел сигнал может ослабнуть, прежде чем связь оборвётся.`, { size: 8.5, color: C.muted });
  L.y += 4;
  r.channels.forEach((c) => {
    if (r.multi) L.h3(`Канал ${c.n} · ${c.label}`);
    L.table(
      [{ t: 'Режим', w: 14 }, { t: 'Мбит/с', w: 10, align: 'right' }, { t: 'Мощность, дБм', w: 12, align: 'right' }, { t: 'Порог, дБм', w: 11, align: 'right' }, { t: 'Сигнал, дБм', w: 11, align: 'right' }, { t: 'Запас, дБ', w: 10, align: 'right' }, { t: 'Перерывы в год', w: 13, align: 'right' }, { t: 'Доступность', w: 13, align: 'right' }, { t: 'Итог', w: 12 }],
      c.modes.map((m) => {
        const lv: Level = m.margin <= 0 ? 'bad' : m.ok ? 'ok' : 'warn';
        return row([{ t: m.name, bold: true }, fmt(m.rateMbps, 1), fmt(m.txDbm, 1), fmt(m.thresholdDbm, 1), fmt(m.prx, 1), fmt(m.margin, 1), m.margin > 0 ? downtime(m.u) : 'всегда', m.margin > 0 ? fmt(100 - m.u, 4) + ' %' : '—', { t: lv === 'ok' ? 'В норме' : lv === 'warn' ? 'Ниже нормы' : 'Нет связи', bold: true, color: SEM[lv], fill: SEMS[lv] }]);
      })
    );
  });

  if (r.polarization.channels.length) {
    L.h2('Выбор поляризации');
    r.polarization.channels.forEach((pc) => {
      if (r.multi) L.h3(`Канал ${pc.n} · ${pc.freq}`);
      L.table([{ t: 'Поляризация', w: 34 }, { t: 'Ослабление в ливень', w: 20, align: 'right' }, { t: 'Перерывы в год' + (pc.refName ? ' на ' + pc.refName : ''), w: 22, align: 'right' }, { t: 'Макс. скорость в норме', w: 24, align: 'right' }],
        pc.options.map((o) => row([{ t: polLong(o.pol) + (o.current ? ' (сейчас)' : ''), bold: o.current }, fmt(o.rainA001, 1) + ' дБ', o.ref ? (o.ref.margin > 0 ? downtime(o.ref.u) : 'всегда') : '—', o.best ? `${o.best.name}, ${fmt(o.best.rateMbps, 1)} Мбит/с` : 'нет'], o.winner ? { bg: C.okSoft, mark: C.ok } : {})));
      L.para(pc.verdict, { size: 9 });
      L.y += 4;
    });
    if (r.polarization.pair) { L.h3('Раскладка двух каналов'); L.para(r.polarization.pair, { size: 9 }); }
  }

  L.h2('Рекомендации');
  r.recs.forEach((rec) => {
    const hl = pdf.wrap(rec.title, CW - 14, 10, 'B'), pl = pdf.wrap(stripMarks(rec.text), CW - 14, 9, 'R');
    const rh = hl.length * 13 + pl.length * 12.4 + 10;
    if (L.y + rh > L.BOTTOM) L.newPage();
    pdf.rect(M, L.y + 2, 3, rh - 8, { fill: SEM[rec.level] });
    let ry = L.y;
    hl.forEach((l) => { pdf.text(M + 12, ry + 10, l, { size: 10, bold: true }); ry += 13; });
    pl.forEach((l) => { pdf.text(M + 12, ry + 9, l, { size: 9, color: C.body }); ry += 12.4; });
    L.y += rh;
  });

  L.h2('Расчёт по шагам');
  const steps: Row[] = [
    row(['Длина пролёта', { t: r.geo ? 'по координатам, эллипсоид WGS-84' : 'по профилю', color: C.muted }, { t: fmt(r.path.D, 3) + ' км', bold: true }]),
    row(['Угол места A / B', { t: `при k = ${fmt(r.k, 2)}`, color: C.muted }, { t: `${fmt(r.tiltA, 2)}° / ${fmt(r.tiltB, 2)}°`, bold: true }]),
    row(['Допустимая неготовность', { t: 'из нормы', color: C.muted }, { t: `${pct(r.uNorm)} · ${downtime(r.uNorm)}`, bold: true }])
  ];
  r.channels.forEach((c) => {
    steps.push(row([{ t: r.multi ? `Канал ${c.n} · ${c.label}` : c.label, bold: true, color: C.accent }, '', ''], { bg: C.accentSoft }));
    steps.push(row(['Потери в свободном пространстве', { t: 'ослабление из-за расстояния', color: C.muted }, { t: fmt(c.FSL, 1) + ' дБ', bold: true }]));
    steps.push(row(['Коэффициент усиления антенн A / B', { t: c.ch.gainA == null || c.ch.gainB == null ? 'расчётный из диаметра или по паспорту' : 'по паспорту', color: C.muted }, { t: `${fmt(c.gA, 1)} / ${fmt(c.gB, 1)} дБ`, bold: true }]));
    steps.push(row(['Потери на препятствии', { t: `при k = ${fmt(r.k, 2)}; в плохую погоду ${fmt(c.diffMin, 1)} дБ`, color: C.muted }, { t: fmt(c.diff, 1) + ' дБ', bold: true }]));
    steps.push(row(['Затухание в газах', { t: `${fmt(c.gasK, 3)} дБ/км`, color: C.muted }, { t: fmt(c.gas, 2) + ' дБ', bold: true }]));
    if (c.refl) {
      const w = c.refl;
      steps.push(row(['Отражение от воды', { t: w.blocked ? `точка на ${fmt(w.d, 2)} км закрыта` : `на ${fmt(w.d, 2)} км, ψ ${fmt(w.psi, 1)} мрад, ρ ${fmt(w.rho, 2)}`, color: C.muted }, { t: w.blocked ? 'нет' : w.rho < 0.1 ? 'не влияет' : w.loss > 0 ? `−${fmt(w.loss, 1)} дБ` : `+${fmt(-w.loss, 1)} дБ (не учтено)`, bold: true }]));
      if (!w.blocked && w.rho >= 0.1) steps.push(row(['Худшее замирание от отражения', { t: `при k = ${fmt(w.kWorst, 2)}; разнесение A/B ${fmt(w.spacingA, 1)}/${fmt(w.spacingB, 1)} м`, color: C.muted }, { t: fmt(w.worst, 1) + ' дБ', bold: true }]));
    }
    if (c.ref) steps.push(row([`Сигнал на приёмнике, ${c.ref.name}`, { t: `мощность ${fmt(c.ref.txDbm, 1)} дБм + антенны − потери`, color: C.muted }, { t: fmt(c.ref.prx, 1) + ' дБм', bold: true }]));
    steps.push(row(['Запас, нужный для нормы', { t: 'чтобы перерывов было не больше допустимого', color: C.muted }, { t: fmt(c.marginRequired, 1) + ' дБ', bold: true }]));
    steps.push(row(['Дождь: ослабление в ливень', { t: `${fmt(r.climate.rainR001, 0)} мм/ч, ${fmt(c.rain.gamma, 3)} дБ/км`, color: C.muted }, { t: fmt(c.rain.A001, 1) + ' дБ', bold: true }]));
  });
  L.table([{ t: 'Величина', w: 38 }, { t: 'Пояснение', w: 38 }, { t: 'Значение', w: 24, align: 'right' }], steps);

  L.h2('Исходные данные: климат и норма');
  const cl = r.climate;
  L.table([{ t: 'Параметр', w: 60 }, { t: 'Значение', w: 40, align: 'right' }], [
    row(['Рефракция k (обычная / плохая погода)', `${fmt(cl.k, 2)} / ${fmt(cl.kMin, 2)}`]),
    row(['Градиент рефракции dN1', fmt(cl.dN1, 0)]),
    row(['Интенсивность дождя, превышаемая 0,01 % времени', fmt(cl.rainR001, 0) + ' мм/ч']),
    row(['Затухание в газах', cl.gasDbPerKm != null ? fmt(cl.gasDbPerKm, 3) + ' дБ/км' : 'по частоте (МСЭ-R P.676)']),
    row(['Пересчёт худшего месяца на год', fmt(cl.monthToYear, 2)]),
    row(['Норма доступности', fmt(cl.availabilityPct, 5) + ' %'])
  ]);

  if (link.profile.length >= 2) {
    L.h2(`Профиль местности: точки (${link.profileSource === 'srtm' ? 'SRTM 30 м' : 'введён вручную'})`);
    const pts = link.profile, per = Math.ceil(pts.length / 2);
    const rows: Row[] = [];
    for (let i = 0; i < per; i++) {
      const a = pts[i], b = pts[i + per];
      rows.push(row([a ? fmt(a.d, 3) : '', a ? fmt(a.g, 1) : '', a ? fmt(a.c, 1) : '', b ? fmt(b.d, 3) : '', b ? fmt(b.g, 1) : '', b ? fmt(b.c, 1) : '']));
    }
    L.table([{ t: 'км', w: 16, align: 'right' }, { t: 'Земля, м', w: 17, align: 'right' }, { t: 'Лес/здания, м', w: 17, align: 'right' }, { t: 'км', w: 16, align: 'right' }, { t: 'Земля, м', w: 17, align: 'right' }, { t: 'Лес/здания, м', w: 17, align: 'right' }], rows, { size: 8 });
  }
  if (link.notes) { L.h2('Заметки', 20); L.para(link.notes, { size: 9.5, color: C.body }); }
}

function methodology(L: Layout) {
  L.h2('Методика', 40);
  L.para('Потери в свободном пространстве, азимуты (эллипсоид WGS-84) и углы места рассчитываются точно. Дифракция на препятствии — модель одиночного препятствия-ножа. Многолучевые замирания — быстрый метод МСЭ-R P.530. Дождь — МСЭ-R P.530 и P.838. Затухание в газах — МСЭ-R P.676, стандартная атмосфера. Отражение от водной глади — двухлучевая модель: точка зеркального отражения на эквивалентной Земле, коэффициент отражения пресной воды по Френелю (диэлектрическая проницаемость по модели Дебая), фактор расходимости, рассеяние на волнении (σ = 0,1 м), подавление отражённого луча диаграммой антенн; в уровень сигнала входят только потери при расчётном k, худший случай при k от kmin до 3 приведён отдельно. Методика НИИР учитывает больше факторов, поэтому вероятности перерывов могут отличаться от расчёта в DRRL. Для рабочего проекта сверяйте результат с DRRL или Pathloss.', { size: 9, color: C.body });
}

export function buildReport(items: ReportItem[], project: Project | null): Uint8Array {
  const pdf = new PdfDoc();
  const L = new Layout(pdf);
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (items.length > 1) {
    L.newPage();
    L.y = L.M;
    drawMark(pdf, L.M, L.y, 30);
    pdf.text(L.M + 40, L.y + 13, 'ОИР', { size: 13, bold: true, color: C.navy });
    pdf.text(L.M + 40, L.y + 27, ORG_FULL, { size: 8.5, color: C.muted });
    pdf.text(L.M + L.CW, L.y + 13, date, { size: 8.5, color: C.muted, align: 'right' });
    L.y += 52;
    L.h1(project ? `Проект «${project.name}»` : 'Расчёт пролётов РРЛ');
    L.para(`Сводка по ${items.length} пролётам. Подробный расчёт каждого пролёта — на следующих страницах.`, { size: 10, color: C.muted });
    if (project?.notes) L.para(project.notes, { size: 9.5, color: C.body });
    L.h2('Сводка');
    L.table([{ t: 'Пролёт', w: 30 }, { t: 'Длина, км', w: 10, align: 'right' }, { t: 'Частоты', w: 16 }, { t: 'Скорость в норме, Мбит/с', w: 14, align: 'right' }, { t: 'Перерывы в год', w: 13, align: 'right' }, { t: 'Итог', w: 17 }],
      items.map(({ result: r }) => {
        const worst = r.channels.map((c) => c.best?.u ?? NaN).filter(Number.isFinite);
        return row([{ t: `${r.siteA.name} — ${r.siteB.name}`, bold: true }, fmt(r.path.D, 2), r.channels.map((c) => ghz(c.ch.freqMHz)).join(', '), fmt(r.totalRate, 1), worst.length ? downtime(Math.max(...worst)) : '—', { t: r.verdict.label, bold: true, color: SEM[r.verdict.level], fill: SEMS[r.verdict.level] }]);
      }));
    methodology(L);
  }
  items.forEach((it) => linkSection(L, it, project, date));
  if (items.length === 1) methodology(L);
  const n = pdf.pageCount;
  for (let i = 0; i < n; i++) {
    pdf.setPage(i);
    pdf.line(L.M, pdf.H - 34, L.M + L.CW, pdf.H - 34, { stroke: C.line, w: 0.5 });
    pdf.text(L.M, pdf.H - 22, `${APP_NAME} · ${ORG_FULL}${project ? ' · ' + project.name : ''}`, { size: 7.5, color: C.muted });
    pdf.text(L.M + L.CW, pdf.H - 22, `${i + 1} / ${n}`, { size: 7.5, color: C.muted, align: 'right' });
  }
  const title = items.length === 1 ? `Расчёт пролёта РРЛ ${items[0].result.siteA.name} — ${items[0].result.siteB.name}` : `Расчёт пролётов РРЛ${project ? ' — ' + project.name : ''}`;
  return pdf.build({ title, author: ORG_FULL });
}
