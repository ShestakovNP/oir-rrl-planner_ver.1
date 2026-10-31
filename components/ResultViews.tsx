/** Read-only views of a LinkResult: verdict, recommendations, profile chart, azimuths, modes, polarization, steps. */
import { useEffect, useRef, useState } from 'react';
import type { Link } from '../data/types';
import { geometry, interpolate, surfaceRuns, type Level, type LinkResult } from '../data/calc/link';
import { setHover, useHover } from '../state/hover';
import { downtime, fmt, ghz, pct, polLong } from '../data/calc/format';
import { n360 } from '../data/calc/geo';
import { Icon, Rich } from './ui';
import { protectionRows } from '../data/calc/protectionText';
import { exportChart, type LegendItem } from './chartExport';

export function Verdict({ r }: { r: LinkResult }) {
  const c = r.channels[0];
  const rel = r.clearance.rel;
  return (
    <>
      <div className={`verdict ${r.verdict.level}`} aria-live="polite">
        <span className="lbl">{r.verdict.label}</span>
        <div className="ttl">{r.verdict.title}</div>
        <div className="sub2">{r.verdict.sub}</div>
      </div>
      <div className="facts">
        <div className="fact"><span className="k">Длина пролёта</span><span className="v">{fmt(r.path.D, 2)}</span><span className="s">км</span></div>
        <div className="fact"><span className="k">Просвет</span><span className="v">{rel == null ? '—' : rel > 3 ? '> 300%' : Math.round(rel * 100) + '%'}</span><span className="s">{r.clearance.label.toLowerCase()}</span></div>
        {r.multi ? (
          <div className="fact"><span className="k">Скорость в норме</span><span className="v">{fmt(r.totalRate, 1)}</span><span className="s">Мбит/с, сумма стволов</span></div>
        ) : (
          <div className="fact"><span className="k">Запас{c?.ref ? ' ' + c.ref.name : ''}</span><span className="v">{c?.ref ? fmt(c.ref.margin, 1) : '—'}</span><span className="s">дБ</span></div>
        )}
      </div>
    </>
  );
}

export function Recommendations({ r }: { r: LinkResult }) {
  if (!r.recs.length) return <p className="hint">Рекомендаций нет.</p>;
  return (
    <div className="recs">
      {r.recs.map((x, i) => (
        <div key={i} className={`rec ${x.level}`}>
          <span className="bar" />
          <div><h4>{x.title}</h4><p><Rich text={x.text} /></p></div>
        </div>
      ))}
    </div>
  );
}

/* ---------- profile chart ---------- */
const nice = (range: number, count: number) => {
  const raw = range / count, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
};

export function ProfileChart({ r, height = 260, linkId, notify }: { r: LinkResult; height?: number; linkId?: string; notify?(t: string, e?: boolean): void }) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [saving, setSaving] = useState(false);
  const hover = useHover();
  const [W, setW] = useState(480);
  const [k, setK] = useState(r.k);
  const [show, setShow] = useState<'all' | 'main' | 'a' | 'b'>('all');
  useEffect(() => setK(r.k), [r.k]);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const lowest = r.channels.length ? r.channels.reduce((a, b) => (b.fGHz < a.fGHz ? b : a)) : null;
  const G = Math.abs(k - r.k) < 1e-6 ? r.geom : geometry(r.path, k, lowest ? lowest.fGHz : 6);
  const P = r.path, s = G.s, H = height;
  /* space diversity: the second antennas get their own ray, Fresnel zone and narrow point */
  const sdDiv = r.channels.find((ch) => ch.div?.scheme === 'sd')?.div ?? null;
  const fRef = lowest ? lowest.fGHz : 6;
  const branches = sdDiv ? ([['a', sdDiv.a], ['b', sdDiv.b]] as const).flatMap(([key, b]) => {
    if (!b) return [];
    const P2 = key === 'a' ? { ...P, hA: b.h, HA: P.gA0 + b.h } : { ...P, hB: b.h, HB: P.gB0 + b.h };
    return [{ key, h: b.h, name: key === 'a' ? r.siteA.name : r.siteB.name, P2, G2: geometry(P2, k, fRef) }];
  }) : [];
  const view = branches.some((b) => b.key === show) || show === 'main' ? show : 'all';
  const shownB = branches.filter((b) => view === 'all' || view === b.key);
  const showMain = view === 'all' || view === 'main', showSecond = shownB.length > 0;
  const ml = 40, mr = 14, mt = 28, mb = 24;
  let ymin = Infinity, ymax = -Infinity;
  s.forEach((o) => { ymin = Math.min(ymin, o.g); ymax = Math.max(ymax, o.los + o.F1, o.top); });
  if (showSecond) shownB.forEach((b) => b.G2.s.forEach((o) => { ymax = Math.max(ymax, o.los + o.F1); }));
  ymin = Math.floor(ymin - 4); ymax = Math.ceil(ymax + 6);
  const X = (d: number) => ml + ((W - ml - mr) * d) / P.D;
  const Y = (v: number) => mt + (H - mt - mb) * (1 - (v - ymin) / (ymax - ymin));
  const ys = nice(ymax - ymin, 6), xs = nice(P.D, W < 420 ? 4 : 7);
  const yt: number[] = []; for (let v = Math.ceil(ymin / ys) * ys; v <= ymax; v += ys) yt.push(v);
  const xt: number[] = []; for (let d = 0; d <= P.D + 1e-9; d += xs) xt.push(d);
  const fz = s.map((o) => `${X(o.d)},${Y(o.los + o.F1)}`).join(' ') + ' ' + s.slice().reverse().map((o) => `${X(o.d)},${Y(o.los - o.F1)}`).join(' ');
  const runs = surfaceRuns(s);
  const runPoly = (from: number, to: number) => {
    const part = s.slice(Math.max(0, from - 1), Math.min(s.length, to + 2));
    return part.map((o) => `${X(o.d)},${Y(o.top)}`).join(' ') + ' ' + part.slice().reverse().map((o) => `${X(o.d)},${Y(o.g)}`).join(' ');
  };
  const runLine = (from: number, to: number) => s.slice(from, to + 1).map((o) => `${X(o.d)},${Y(o.g)}`).join(' ');
  const hasManual = runs.some((r0) => r0.kind === 'c');
  const hasKind = (kd: string) => runs.some((r0) => r0.kind === kd);
  /* reflection from water (shown at the calculation k only) */
  const rc = Math.abs(k - r.k) < 1e-6 ? r.channels.find((ch) => ch.refl && !ch.refl.blocked && ch.refl.rho >= 0.1) : undefined;
  const refl = rc?.refl ?? null;
  const reflG = refl ? (() => { const i = s.findIndex((o) => o.d >= refl.d); const o = s[Math.max(0, i)]; return o ? o.g : 0; })() : 0;
  const legend: (LegendItem & { v: string; on: boolean })[] = [
    { label: 'Рельеф', v: '--ground', color: '', on: true },
    { label: 'Здания', v: '--building', color: '', on: hasKind('b') },
    { label: 'Лес', v: '--forest', color: '', on: hasKind('f') },
    { label: 'Вода', v: '--water', color: '', on: hasKind('w') },
    { label: 'Препятствия (вручную)', v: '--clutter', color: '', on: hasManual },
    { label: 'Зона Френеля' + (lowest && r.multi ? ` (${ghz(lowest.ch.freqMHz)})` : ''), v: '--fresnel-edge', color: '', on: true },
    { label: 'Луч', v: '--accent', color: '', line: true, on: showMain },
    { label: 'Вторая антенна: луч и зона Френеля', v: '--sd', color: '', line: true, on: showSecond },
    { label: 'Отражение от воды', v: '--water', color: '', line: true, on: !!refl },
    { label: 'Узкое место', v: '--bad', color: '', line: true, on: !!G.crit }
  ];
  const save = async (format: 'png' | 'jpeg') => {
    if (!svgRef.current) return;
    setSaving(true);
    try {
      const cs = getComputedStyle(document.documentElement);
      const items = legend.filter((x) => x.on).map((x) => ({ ...x, color: cs.getPropertyValue(x.v).trim() || '#888' }));
      const nm = `${r.siteA.name || 'A'} — ${r.siteB.name || 'B'}`;
      const sub = `${fmt(P.D, 2)} км · k = ${fmt(k, 2)} · ${r.channels.map((ch) => ch.label).join(', ')}`;
      const fileName = `Профиль ${nm}`.replace(/[\\/:*?"<>|]+/g, '_');
      const res = await exportChart(svgRef.current, { format, fileName, title: `Профиль трассы ${nm}`, subtitle: sub, legend: items });
      if (res && notify) notify(res === 'download' ? 'Изображение профиля скачано.' : `Изображение профиля сохранено: ${res}`);
    } catch (e) {
      notify?.((e as Error).message || 'Не удалось сохранить изображение.', true);
    } finally {
      setSaving(false);
    }
  };
  const ground = `${X(0)},${H - mb} ` + s.map((o) => `${X(o.d)},${Math.min(H - mb, Y(o.g))}`).join(' ') + ` ${X(P.D)},${H - mb}`;
  const c = G.crit;
  /* cursor: from the map or from the chart itself */
  const hd = linkId && hover && hover.linkId === linkId ? hover.t * P.D : null;
  let cur: (typeof s)[number] | null = null;
  if (hd != null) {
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid].d < hd) lo = mid; else hi = mid; }
    const a = s[lo], b = s[hi], f = b.d > a.d ? (hd - a.d) / (b.d - a.d) : 0;
    const lerp = (x: number, y: number) => x + (y - x) * f;
    const top = lerp(a.top, b.top), los = lerp(a.los, b.los);
    cur = { d: hd, g: lerp(a.g, b.g), top, los, F1: lerp(a.F1, b.F1), H: los - top };
  }
  const terrain = hd != null ? interpolate(P.pts, hd) : null;
  const curB = hd == null ? [] : branches.map((b) => {
    const ss = b.G2.s;
    let lo = 0, hi = ss.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ss[mid].d < hd) lo = mid; else hi = mid; }
    const a0 = ss[lo], b0 = ss[hi], f = b0.d > a0.d ? (hd - a0.d) / (b0.d - a0.d) : 0;
    const L = (x: number, y: number) => x + (y - x) * f;
    return { key: b.key, name: b.name, h: b.h, H: L(a0.H, b0.H), F1: L(a0.F1, b0.F1), los: L(a0.los, b0.los) };
  });
  const onMove = (e: { clientX: number; currentTarget: SVGSVGElement }) => {
    if (!linkId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setHover({ linkId, t: Math.max(0, Math.min(1, (x - ml) / (W - ml - mr))), source: 'chart' });
  };
  const tipW = branches.length ? 270 : 206, tipX = cur ? (X(cur.d) + 12 + tipW > W - mr ? X(cur.d) - 12 - tipW : X(cur.d) + 12) : 0;
  return (
    <div className="section" style={{ gap: 8 }}>
      <div ref={box}>
        <svg ref={svgRef} className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Профиль трассы" onMouseMove={onMove} onMouseLeave={() => linkId && setHover(null)}>
          {yt.map((v) => (
            <g key={v}><line className="grid" x1={ml} x2={W - mr} y1={Y(v)} y2={Y(v)} /><text className="tick" x={ml - 6} y={Y(v) + 3.5} textAnchor="end">{Math.round(v)}</text></g>
          ))}
          {xt.map((d) => <text key={d} className="tick" x={X(d)} y={H - 7} textAnchor="middle">{fmt(d, xs < 1 ? 1 : 0)}</text>)}
          <text className="tick" x={W - 2} y={H - 7} textAnchor="end">км</text>
          {showMain ? <polygon className="fz" points={fz} /> : null}
          {showSecond ? shownB.map((b) => <polygon key={'fz' + b.key} className="fz2" points={b.G2.s.map((o) => `${X(o.d)},${Y(o.los + o.F1)}`).join(' ') + ' ' + b.G2.s.slice().reverse().map((o) => `${X(o.d)},${Y(o.los - o.F1)}`).join(' ')} />) : null}
          <polygon className="ground" points={ground} />
          {runs.filter((r0) => r0.kind !== 'w').map((r0, i) => (
            <polygon key={'r' + i} className={r0.kind === 'b' ? 'bld' : r0.kind === 'f' ? 'forest' : 'clutter'} points={runPoly(r0.from, r0.to)} />
          ))}
          {runs.filter((r0) => r0.kind === 'w').map((r0, i) => (
            <polyline key={'w' + i} className="water" points={runLine(r0.from, r0.to)} />
          ))}
          {showMain ? <line className="los" x1={X(0)} y1={Y(P.HA)} x2={X(P.D)} y2={Y(P.HB)} /> : null}
          {showSecond ? shownB.map((b) => <line key={'l' + b.key} className="los2" x1={X(0)} y1={Y(b.P2.HA)} x2={X(P.D)} y2={Y(b.P2.HB)} />) : null}
          <line className="mast" x1={X(0)} y1={Y(P.gA0)} x2={X(0)} y2={Y(P.HA)} />
          <line className="mast" x1={X(P.D)} y1={Y(P.gB0)} x2={X(P.D)} y2={Y(P.HB)} />
          <text className="lbl" x={X(0) + 6} y={Y(P.HA) - 8}>{r.siteA.name} · {fmt(P.hA, 0)} м</text>
          <text className="lbl" x={X(P.D) - 6} y={Y(P.HB) - 8} textAnchor="end">{fmt(P.hB, 0)} м · {r.siteB.name}</text>
          {refl ? (
            <g>
              <polyline className="refl-ray" points={`${X(0)},${Y(P.HA)} ${X(refl.d)},${Y(reflG)} ${X(P.D)},${Y(P.HB)}`} />
              <circle className="refl" cx={X(refl.d)} cy={Y(reflG)} r={4.5} />
            </g>
          ) : null}
          {c && showMain ? (
            <g>
              <line className="crit" x1={X(c.d)} x2={X(c.d)} y1={Y(c.top)} y2={Y(c.los)} />
              <circle className="critdot" cx={X(c.d)} cy={Y(c.top)} r={3.5} />
            </g>
          ) : null}
          {branches.map((b) => (
            <g key={'ant' + b.key}>
              <line className="mast2" x1={X(b.key === 'a' ? 0 : P.D)} x2={X(b.key === 'a' ? 0 : P.D)} y1={Y((b.key === 'a' ? P.gA0 : P.gB0) + b.h)} y2={Y(b.key === 'a' ? P.HA : P.HB)} />
              <circle className="sd-ant" cx={X(b.key === 'a' ? 0 : P.D)} cy={Y((b.key === 'a' ? P.gA0 : P.gB0) + b.h)} r={4.5} />
              <text className="lbl sd-lbl" x={X(b.key === 'a' ? 0 : P.D) + (b.key === 'a' ? 8 : -8)} y={Y((b.key === 'a' ? P.gA0 : P.gB0) + b.h) + 4} textAnchor={b.key === 'a' ? 'start' : 'end'}>{fmt(b.h, 0)} м</text>
              {shownB.includes(b) && b.G2.crit ? (
                <g>
                  <line className="crit2" x1={X(b.G2.crit.d)} x2={X(b.G2.crit.d)} y1={Y(b.G2.crit.top)} y2={Y(b.G2.crit.los)} />
                  <rect className="critdot2" x={X(b.G2.crit.d) - 3.5} y={Y(b.G2.crit.top) - 3.5} width={7} height={7} />
                </g>
              ) : null}
            </g>
          ))}
          {cur && terrain ? (
            <g className="cursor" pointerEvents="none">
              <line className="cur-line" x1={X(cur.d)} x2={X(cur.d)} y1={mt - 6} y2={H - mb} />
              {showMain ? <line className="cur-fz" x1={X(cur.d)} x2={X(cur.d)} y1={Y(cur.los + cur.F1)} y2={Y(cur.los - cur.F1)} /> : null}
              {showMain ? <circle className="cur-dot" cx={X(cur.d)} cy={Y(cur.los)} r={4} /> : null}
              {curB.filter((q) => shownB.some((b) => b.key === q.key)).map((q) => <circle key={'cd' + q.key} className="cur-dot2" cx={X(cur.d)} cy={Y(q.los)} r={4} />)}
              <circle className="cur-top" cx={X(cur.d)} cy={Y(cur.top)} r={3.5} />
              {(() => {
                const pctTxt = (H0: number, F: number) => `${fmt(H0, 1)} м${F > 0 ? ` · ${H0 / F > 3 ? '> 300' : Math.round((H0 / F) * 100)}% R₁` : ''}`;
                const cls = (H0: number, F: number) => `cur-txt ${F > 0 && H0 / F < 0.577 ? (H0 < 0 ? 'bad' : 'warn') : 'ok'}`;
                const lines: { t: string; c: string; b?: boolean }[] = [
                  { t: `${fmt(cur.d, 2)} км от «${r.siteA.name}»`, c: 'cur-txt', b: true },
                  { t: `Земля ${fmt(terrain.g, 0)} м${terrain.t === 'w' ? ', вода' : terrain.c > 0 ? `, ${terrain.t === 'b' ? 'здание' : terrain.t === 'f' ? 'лес' : 'препятствие'} ${fmt(terrain.c, 0)} м` : ''}`, c: 'cur-txt' }
                ];
                if (showMain) {
                  lines.push({ t: `${branches.length ? 'Основная: луч' : 'Луч'} на высоте ${fmt(cur.los, 0)} м, R₁ = ${fmt(cur.F1, 1)} м`, c: 'cur-txt' });
                  lines.push({ t: `${branches.length ? 'Основная: просвет' : 'Просвет'} ${pctTxt(cur.H, cur.F1)}`, c: cls(cur.H, cur.F1), b: true });
                }
                curB.filter((q) => shownB.some((b) => b.key === q.key)).forEach((q) => {
                  if (!showMain) lines.push({ t: `Вторая «${q.name}» (${fmt(q.h, 0)} м): луч ${fmt(q.los, 0)} м, R₁ = ${fmt(q.F1, 1)} м`, c: 'cur-txt' });
                  lines.push({ t: `Вторая «${q.name}»${showMain ? ` (${fmt(q.h, 0)} м)` : ''}: просвет ${pctTxt(q.H, q.F1)}`, c: cls(q.H, q.F1), b: true });
                });
                return (
                  <>
                    <rect className="cur-tip" x={tipX} y={mt} width={tipW} height={lines.length * 17 + 10} rx={6} />
                    {lines.map((l, i) => <text key={i} className={l.c} x={tipX + 10} y={mt + 17 + i * 17} fontWeight={l.b ? 700 : undefined}>{l.t}</text>)}
                  </>
                );
              })()}
            </g>
          ) : null}
        </svg>
      </div>
      <div className="legend">
        {legend.filter((x) => x.on).map((x) => (
          <span key={x.label}><i style={x.line ? { background: `var(${x.v})`, height: 2 } : x.v === '--fresnel-edge' ? { background: 'var(--fresnel)', border: '1px dashed var(--fresnel-edge)' } : { background: `var(${x.v})` }} />{x.label}</span>
        ))}
      </div>
      {branches.length ? (
        <div className="kctl">
          <span>Показать:</span>
          <div className="seg" role="group" aria-label="Какие антенны показать">
            {([['all', 'Все антенны'], ['main', 'Основная'], ...branches.map((b) => [b.key, branches.length > 1 ? `Вторая на «${b.name}»` : 'Вторая'] as const)] as [typeof show, string][]).map(([v, t]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setShow(v)}>{t}</button>)}
          </div>
        </div>
      ) : null}
      <div className="kctl">
        <label htmlFor="kslider">Рефракция k</label>
        <input id="kslider" type="range" min={0.5} max={2} step={0.01} value={k} onChange={(e) => setK(+e.target.value)} />
        <span className="num">{fmt(k, 2)}</span>
        <button type="button" className="btn sm" onClick={() => setK(r.k)}>Обычная {fmt(r.k, 2)}</button>
        <button type="button" className="btn sm" onClick={() => setK(r.kMin)}>Плохая погода {fmt(r.kMin, 2)}</button>
        <span className="kctl-sp" />
        <span>Сохранить график:</span>
        <button type="button" className="btn sm" disabled={saving} onClick={() => void save('png')} title="Сохранить профиль как картинку PNG (без потерь, для документов)"><Icon name="download" />PNG</button>
        <button type="button" className="btn sm" disabled={saving} onClick={() => void save('jpeg')} title="Сохранить профиль как картинку JPEG (меньше размер, для почты и мессенджеров)"><Icon name="download" />JPEG</button>
      </div>
      {refl ? (
        <p className="hint">
          Голубой пунктир — луч, отражённый от воды на {fmt(refl.d, 2)} км{r.multi && rc ? ` (${rc.tag})` : ''}: он складывается с прямым лучом, и в зависимости от рефракции сигнал усиливается или ослабевает до {fmt(refl.worst, 1)} дБ. Подробности — в рекомендациях и на вкладке «Подробно».
        </p>
      ) : null}
      {showSecond ? shownB.map((b) => b.G2.crit ? (
        <p key={'h' + b.key} className="hint">
          Вторая антенна на «{b.name}» ({fmt(b.h, 0)} м): узкое место на {fmt(b.G2.crit.d, 2)} км, до препятствия {fmt(b.G2.crit.H, 1)} м — {b.G2.crit.rel > 3 ? `в ${fmt(b.G2.crit.rel, 0)} раз больше` : Math.round(b.G2.crit.rel * 100) + '%'} радиуса зоны Френеля.{b.G2.crit.rel < 0.577 ? ' Просвета мало: вторая антенна будет принимать слабее основной.' : ''}
        </p>
      ) : null) : null}
      {c && showMain ? (
        <p className="hint">
          {branches.length ? 'Основная антенна: узкое место' : 'Узкое место'} — {fmt(c.d, 2)} км от «{r.siteA.name}»: до препятствия {fmt(c.H, 1)} м, это {c.rel > 3 ? `в ${fmt(c.rel, 0)} раз больше` : Math.round(c.rel * 100) + '%'} радиуса зоны Френеля ({fmt(c.F1, 1)} м). Открытой трасса считается от 58%.
        </p>
      ) : null}
    </div>
  );
}

/* ---------- azimuths ---------- */
function Dial({ az, mag }: { az: number; mag: number | null }) {
  const c = 38, r = 32;
  const tick = [...Array(12)].map((_, i) => {
    const a = (i * 30 * Math.PI) / 180, r2 = i % 3 ? r - 4 : r - 8;
    return <line key={i} className="tk" x1={c + r * Math.sin(a)} y1={c - r * Math.cos(a)} x2={c + r2 * Math.sin(a)} y2={c - r2 * Math.cos(a)} />;
  });
  const end = (a: number) => [c + (r - 10) * Math.sin((a * Math.PI) / 180), c - (r - 10) * Math.cos((a * Math.PI) / 180)];
  const [nx, ny] = end(az);
  const m = mag != null ? end(mag) : null;
  return (
    <svg className="dial" viewBox="0 0 76 76" aria-hidden="true">
      <circle className="rim" cx={c} cy={c} r={r + 3} />
      {tick}
      <text className="N" x={c} y={15} textAnchor="middle">С</text>
      <text x={c + 23} y={c + 3} textAnchor="middle">В</text>
      <text x={c} y={c + 28} textAnchor="middle">Ю</text>
      <text x={c - 23} y={c + 3} textAnchor="middle">З</text>
      {m ? <line className="nm" x1={c} y1={c} x2={m[0]} y2={m[1]} /> : null}
      <line className="nd" x1={c} y1={c} x2={nx} y2={ny} />
      <circle cx={c} cy={c} r={2.5} fill="var(--accent)" />
    </svg>
  );
}

export function Azimuths({ r, decl }: { r: LinkResult; decl: number | null }) {
  if (!r.geo) return <p className="hint">Задайте координаты обоих объектов.</p>;
  const card = (from: string, to: string, az: number, tilt: number) => (
    <div className="azc">
      <Dial az={az} mag={decl} />
      <div>
        <div className="t">«{from}» → «{to}»</div>
        <div className="big">{fmt(az, 1)}°</div>
        <div className="sm">{decl != null ? <>по компасу {fmt(n360(az - decl), 1)}°<br /></> : null}угол места {fmt(tilt, 2)}°</div>
      </div>
    </div>
  );
  return <div className="az">{card(r.siteA.name, r.siteB.name, r.geo.az1, r.tiltA)}{card(r.siteB.name, r.siteA.name, r.geo.az2, r.tiltB)}</div>;
}

/* ---------- modes ---------- */
const lvl = (ok: boolean, margin: number): Level => (margin <= 0 ? 'bad' : ok ? 'ok' : 'warn');
export function ModesTable({ r }: { r: LinkResult }) {
  return (
    <>
      {r.channels.map((c) => (
        <div key={c.n} className="section" style={{ gap: 6 }}>
          {r.multi ? <div className="sub"><span className="tag">{c.tag}</span> {c.label}</div> : null}
          {c.modes.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Режим</th><th className="n">Мбит/с</th><th className="n">Сигнал, дБм</th><th className="n">Запас, дБ</th><th className="n">Перерывы/год</th><th>Итог</th></tr></thead>
                <tbody>
                  {c.modes.map((m, i) => {
                    const l = lvl(m.ok, m.margin);
                    return (
                      <tr key={i} title={m.deg > 0.05 ? `Соседний ствол отнимает ${fmt(m.deg, 1)} дБ` : undefined}>
                        <td><b>{m.name}</b></td>
                        <td className="n">{fmt(m.rateMbps, 1)}</td>
                        <td className="n">{fmt(m.prx, 1)}</td>
                        <td className="n">{fmt(m.margin, 1)}</td>
                        <td className="n">{m.margin > 0 ? downtime(m.u) : 'всегда'}</td>
                        <td><span className={`pill ${l}`}>{l === 'ok' ? 'В норме' : l === 'warn' ? 'Ниже нормы' : 'Нет связи'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="hint">Добавьте режимы модуляции во вкладке «Исходные данные».</p>}
        </div>
      ))}
      <p className="hint">Допустимо: {pct(r.uNorm)} в год, это {downtime(r.uNorm)}.</p>
    </>
  );
}

/* ---------- polarization ---------- */
export function PolarizationView({ r }: { r: LinkResult }) {
  const p = r.polarization;
  return (
    <>
      {p.channels.map((pc) => (
        <div key={pc.n} className="section" style={{ gap: 6 }}>
          {r.multi ? <div className="sub"><span className="tag">{pc.tag}</span> {pc.freq}</div> : null}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Поляризация</th><th className="n">В ливень</th><th className="n">Перерывы{pc.refName ? ' на ' + pc.refName : ''}</th><th className="n">Макс. в норме</th></tr></thead>
              <tbody>
                {pc.options.map((o) => (
                  <tr key={o.pol} className={o.winner ? 'win' : ''}>
                    <td>{o.current ? <b>{polLong(o.pol)}</b> : polLong(o.pol)} {o.current ? <span className="tag">сейчас</span> : null} {o.winner ? <span className="pill ok">стабильнее</span> : null}</td>
                    <td className="n">{fmt(o.rainA001, 1)} дБ</td>
                    <td className="n">{o.ref ? (o.ref.margin > 0 ? downtime(o.ref.u) : 'всегда') : '—'}</td>
                    <td className="n">{o.best ? `${o.best.name}, ${fmt(o.best.rateMbps, 1)}` : 'нет'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="polv hint" style={{ color: 'var(--ink-2)' }}><Rich text={pc.verdict} /></p>
        </div>
      ))}
      {p.pair ? <div className="notice info polv"><Rich text={p.pair} /></div> : null}
    </>
  );
}

/* ---------- steps ---------- */
export function Steps({ r, link }: { r: LinkResult; link: Link }) {
  const row = (t: string, s: string, v: string, key: string) => [
    <div key={key + 't'} className="t">{t}{s ? <small>{s}</small> : null}</div>,
    <div key={key + 'r'} className="r">{v}</div>
  ];
  return (
    <div className="kv">
      {row('Длина пролёта', r.geo ? 'по координатам, WGS-84' : 'по профилю', fmt(r.path.D, 3) + ' км', 'd')}
      {r.geo ? row('Азимут A → B / B → A', 'истинный', `${fmt(r.geo.az1, 1)}° / ${fmt(r.geo.az2, 1)}°`, 'az') : null}
      {row('Высоты антенн над уровнем моря', 'земля + подвес', `${fmt(r.path.HA, 0)} / ${fmt(r.path.HB, 0)} м`, 'h')}
      {row('Угол места A / B', `при k = ${fmt(r.k, 2)}`, `${fmt(r.tiltA, 2)}° / ${fmt(r.tiltB, 2)}°`, 't')}
      {row('Потери в фидерах и прочие', 'общие для стволов', fmt(link.feederA + link.feederB + link.otherLoss, 1) + ' дБ', 'f')}
      {row('Допустимая неготовность', 'в год', `${pct(r.uNorm)} · ${downtime(r.uNorm)}`, 'u')}
      {r.channels.map((c) => [
        <div key={'s' + c.n} className="sec">{r.multi ? `Ствол ${c.n} · ` : ''}{c.label}</div>,
        ...row('Потери в свободном пространстве', '', fmt(c.FSL, 1) + ' дБ', c.n + 'fsl'),
        ...row('Коэффициент усиления антенн A / B', c.ch.gainA == null || c.ch.gainB == null ? 'расчётный из диаметра (КИП 55 %) или по паспорту' : 'по паспорту', `${fmt(c.gA, 1)} / ${fmt(c.gB, 1)} дБ`, c.n + 'g'),
        ...row('Ширина луча A / B', '', `${fmt(c.beamA, 1)}° / ${fmt(c.beamB, 1)}°`, c.n + 'bw'),
        ...row('Потери на объединение', 'на двух концах', fmt(2 * c.ch.combinerLossDb, 1) + ' дБ', c.n + 'omt'),
        ...row('Потери на препятствии', `в плохую погоду ${fmt(c.diffMin, 1)} дБ`, fmt(c.diff, 1) + ' дБ', c.n + 'df'),
        ...row('Затухание в газах', `${fmt(c.gasK, 3)} дБ/км`, fmt(c.gas, 2) + ' дБ', c.n + 'gas'),
        ...(c.refl ? [
          ...row('Отражение от воды', c.refl.blocked ? `точка на ${fmt(c.refl.d, 2)} км закрыта препятствием` : `на ${fmt(c.refl.d, 2)} км, угол ${fmt(c.refl.psi, 1)} мрад, |Γ| ${fmt(c.refl.gamma, 2)}, расхождение ${fmt(c.refl.divergence, 2)}, волнение ${fmt(c.refl.roughness, 2)}, антенны ${fmt(c.refl.discA + c.refl.discB, 1)} дБ → ρ ${fmt(c.refl.rho, 2)}`, c.refl.blocked ? 'нет' : c.refl.rho < 0.1 ? 'не влияет' : c.refl.loss > 0 ? `−${fmt(c.refl.loss, 1)} дБ` : `+${fmt(-c.refl.loss, 1)} дБ (не учтено)`, c.n + 'wr'),
          ...(c.refl.blocked || c.refl.rho < 0.1 ? [] : row('Худшее замирание от отражения', `при k = ${fmt(c.refl.kWorst, 2)}; шаг разнесения по высоте A / B ${fmt(c.refl.spacingA, 1)} / ${fmt(c.refl.spacingB, 1)} м`, fmt(c.refl.worst, 1) + ' дБ', c.n + 'ww'))
        ] : []),
        ...(c.ref ? row(`Сигнал на приёмнике, ${c.ref.name}`, `мощность ${fmt(c.ref.txDbm, 1)} дБм + антенны − потери${c.refl && c.refl.applied > 0 ? ' − отражение' : ''}`, fmt(c.ref.prx, 1) + ' дБм', c.n + 'p') : []),
        ...protectionRows(r, c).flatMap((x, i) => row(x.t, x.s, x.v, c.n + 'pr' + i)),
        ...row('Запас, нужный для нормы', '', fmt(c.marginRequired, 1) + ' дБ', c.n + 'mr'),
        ...row('Дождь: ослабление в ливень', `${fmt(r.climate.rainR001, 0)} мм/ч, ${fmt(c.rain.gamma, 3)} дБ/км`, fmt(c.rain.A001, 1) + ' дБ', c.n + 'rain')
      ])}
    </div>
  );
}
