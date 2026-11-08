/** Detail panel of one link: results, inputs, terrain profile and full calculation. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Channel, Climate, Link, ModMode, ProfilePoint, Protection, ProtectionScheme } from '../data/types';
import { SCHEME_NAMES, SCHEME_SHORT, defaultProtection } from '../data/calc/protection';
import { channelsShareFrequency, type LinkResult } from '../data/calc/link';
import { dishGain } from '../data/calc/physics';
import { DEFAULT_GOST, GOST_RAIN_XI, GOST_REGIONS, gostRainRate, kOfG, regionStats } from '../data/calc/gost';
import { fmt, ghz } from '../data/calc/format';
import { useStore } from '../state/store';
import { fetchTerrainProfile } from '../net/elevation';
import { applyClutter, fetchClutterObjects } from '../net/clutter';
import { fetchCanopy } from '../net/canopy';
import type { Canopy } from '../data/canopy';
import { vincenty } from '../data/calc/geo';
import { Field, Icon, NumField, parseNum } from './ui';
import { ModesEditor, incomplete } from './ModesEditor';
import { uid } from '../data/ids';
import { Azimuths, ModesTable, PolarizationView, ProfileChart, Recommendations, Steps, Verdict } from './ResultViews';

type Tab = 'result' | 'input' | 'profile' | 'detail';

interface Props {
  link: Link;
  result: LinkResult | undefined;
  onClose(): void;
  onDelete(): void;
  onReport(): void;
  onFocus(): void;
  notify(text: string, error?: boolean): void;
  /** Terrain and map objects are being loaded automatically. */
  loading?: boolean;
  /** Tab to open first: a new link starts with the inputs, an existing one with the result. */
  initialTab?: 'input' | 'result';
}

/**
 * Inputs typed but not applied yet, per link. Kept outside the component so that closing the
 * panel or opening another link does not lose them; «Применить» writes them and recalculates.
 */
const drafts = new Map<string, Partial<Link>>();

export function LinkPanel({ link, result, onClose, onDelete, onReport, onFocus, notify, loading, initialTab = 'result' }: Props) {
  const { sites, updateLink } = useStore();
  const [tab, setTab] = useState<Tab>(initialTab);
  const body = useRef<HTMLDivElement>(null);
  // Each tab opens from the top, not at the scroll position of the previous tab.
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 0; }, [tab, link.id]);
  // The first-steps guide follows which tabs have been opened.
  useEffect(() => { window.dispatchEvent(new CustomEvent('oir:link-tab', { detail: tab })); }, [tab, link.id]);
  const A = sites.find((s) => s.id === link.siteA), B = sites.find((s) => s.id === link.siteB);
  const set = (patch: Partial<Link>) => updateLink({ ...link, ...patch });
  const [draft, setDraftState] = useState<Partial<Link>>(() => drafts.get(link.id) ?? {});
  useEffect(() => { setDraftState(drafts.get(link.id) ?? {}); }, [link.id]);
  const dirty = Object.keys(draft).length > 0;
  const edited: Link = { ...link, ...draft };
  const setDraft = (patch: Partial<Link>) => setDraftState((d) => { const n = { ...d, ...patch }; drafts.set(link.id, n); return n; });
  const apply = () => {
    if (dirty) updateLink({ ...link, ...draft });
    drafts.delete(link.id);
    setDraftState({});
    setTab('result');
    notify(dirty ? 'Исходные данные применены, пролёт пересчитан.' : 'Изменений нет — показан текущий расчёт.');
  };
  const discard = () => { drafts.delete(link.id); setDraftState({}); };
  const tabs: [Tab, string][] = [['input', 'Исходные данные'], ['profile', 'Профиль'], ['detail', 'Итог'], ['result', 'Подробно']];

  return (
    <aside className="panel wide" aria-label="Пролёт">
      <div className="panel-head">
        <div className="panel-title">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Пролёт{result ? ` · ${fmt(result.path.D, 2)} км` : ''}</div>
            <h2>{A?.name ?? '?'} — {B?.name ?? '?'}</h2>
          </div>
          <button className="btn sm" type="button" onClick={onFocus} title="Показать на карте"><Icon name="target" /></button>
          <button className="btn sm" data-guide="pdf" type="button" onClick={onReport} disabled={!result?.ok}><Icon name="pdf" />PDF</button>
          <button className="btn sm danger" type="button" onClick={onDelete} title="Удалить пролёт"><Icon name="trash" /></button>
          <button className="btn sm ghost" type="button" onClick={onClose} title="Закрыть"><Icon name="close" /></button>
        </div>
        <div className="tabs" role="tablist">
          {tabs.map(([k, t]) => <button key={k} role="tab" data-guide={'ltab-' + k} type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>)}
        </div>
      </div>
      <div className="panel-body" ref={body}>
        {!A || !B ? <div className="notice">Один из объектов пролёта удалён.</div> : null}
        {loading ? <div className="auto-load" role="status"><span className="spin" />Загружаю рельеф, здания, лес и воду на трассе… Расчёт обновится сам.</div> : null}
        {result && tab === 'result' ? (
          <>
            <Verdict r={result} />
            <div className="section"><h3>Рекомендации</h3><Recommendations r={result} /></div>
            <div className="section"><h3>Профиль трассы <span className="hint">наведите курсор на график или на линию пролёта на карте</span></h3><ProfileChart r={result} linkId={link.id} notify={notify} /></div>
            <div className="section"><h3>Направление антенн <span className="hint">азимут от севера по часовой стрелке</span></h3><Azimuths r={result} decl={link.declination} /></div>
          </>
        ) : null}
        {dirty && tab !== 'input' ? <div className="notice draft-note">Во вкладке «Исходные данные» есть непримененные изменения — расчёт показан без них. <button type="button" className="btn sm primary" onClick={apply}>Применить</button></div> : null}
        {tab === 'input' ? <Inputs link={edited} set={setDraft} dirty={dirty} onApply={apply} onDiscard={discard} /> : null}
        {tab === 'profile' && A && B ? <ProfileTab link={link} result={result} set={set} notify={notify} autoLoading={!!loading} /> : null}
        {result && tab === 'detail' ? (
          <>
            <div className="section"><h3>Результаты по режимам</h3><ModesTable r={result} /></div>
            <div className="section"><h3>Какую поляризацию выбрать</h3><PolarizationView r={result} /></div>
            <div className="section"><h3>Расчёт по шагам</h3><Steps r={result} link={link} /></div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

/* ---------------- protection ---------------- */

const SCHEME_HINT: Record<ProtectionScheme, string> = {
  '1+0': 'Одна антенна и одно ППУ на каждом конце.',
  hsb: 'Два ППУ на одну антенну через делитель: при отказе оборудования работает резервное. От замираний не спасает, а делитель добавляет потери.',
  sd: 'На объекте вторая антенна на другой высоте со своим приёмником. Пока одна попадает в замирание от многолучёвости, другая принимает. От дождя не спасает.',
  fd: 'Два ствола на разных частотах по одной трассе. Помогает от многолучёвости, но требует вторую частоту.'
};

function ProtectionEditor({ link, set, nameA, nameB }: { link: Link; set(p: Partial<Link>): void; nameA: string; nameB: string }) {
  const p = link.protection;
  const scheme: ProtectionScheme = p?.scheme ?? '1+0';
  const choose = (s: ProtectionScheme) => set({ protection: s === '1+0' ? { ...(p ?? defaultProtection(link, '1+0')), scheme: '1+0' } : { ...(p && p.scheme !== '1+0' ? p : defaultProtection(link, s)), scheme: s } });
  const upd = (patch: Partial<Protection>) => set({ protection: { ...(p ?? defaultProtection(link, scheme)), ...patch } });
  const id = (s: string) => `${link.id}-pr-${s}`;
  return (
    <div className="section">
      <h3>Схема резервирования пролёта</h3>
      <div className="scheme-grid" role="radiogroup" aria-label="Схема резервирования">
        {(['1+0', 'hsb', 'sd', 'fd'] as ProtectionScheme[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={scheme === s} className={`scheme ${scheme === s ? 'on' : ''}`} onClick={() => choose(s)}>
            <b>{SCHEME_SHORT[s]}</b><span>{SCHEME_NAMES[s].replace(/ \(.*\)$/, '')}</span>
          </button>
        ))}
      </div>
      <p className="hint">{SCHEME_HINT[scheme]}</p>
      {scheme === 'hsb' && p ? (
        <div className="grid2">
          <Field label="Потери в делителе на каждом конце, дБ" htmlFor={id('hsb')} hint="несимметричный ≈ 1,5 дБ, симметричный ≈ 3,5 дБ"><NumField id={id('hsb')} value={p.hsbLossDb} min={0} max={10} onChange={(v) => upd({ hsbLossDb: v ?? 0 })} /></Field>
        </div>
      ) : null}
      {scheme === 'sd' && p ? (
        <>
          <div className="grid2">
            {([['A', nameA, 'sdA', 'hA2', 'dishA2', 'feederA2', link.hA], ['B', nameB, 'sdB', 'hB2', 'dishB2', 'feederB2', link.hB]] as const).map(([side, nm, on, h, d, f, hMain]) => (
              <div key={side} className="sd-col">
                <label className="check"><input type="checkbox" checked={p[on]} onChange={(e) => upd({ [on]: e.target.checked } as Partial<Protection>)} /> Вторая антенна на «{nm}»</label>
                {p[on] ? (
                  <>
                    <Field label="Высота подвеса второй антенны, м" htmlFor={id(h)} hint={`основная — ${String(hMain).replace('.', ',')} м, разнос ${String(+Math.abs(hMain - p[h]).toFixed(1)).replace('.', ',')} м`}><NumField id={id(h)} value={p[h]} min={0} onChange={(v) => upd({ [h]: v ?? 0 } as Partial<Protection>)} /></Field>
                    <Field label="Диаметр второй антенны, м" htmlFor={id(d)}><NumField id={id(d)} value={p[d]} min={0.05} onChange={(v) => upd({ [d]: v ?? 0.6 } as Partial<Protection>)} /></Field>
                    <Field label="Потери в фидере второй антенны, дБ" htmlFor={id(f)}><NumField id={id(f)} value={p[f]} min={0} onChange={(v) => upd({ [f]: v ?? 0 } as Partial<Protection>)} /></Field>
                  </>
                ) : <p className="hint">Без второй антенны: направление на этот объект не улучшается.</p>}
              </div>
            ))}
          </div>
          {!p.sdA && !p.sdB ? <div className="notice">Отметьте хотя бы один объект со второй антенной.</div> : null}
          <p className="hint">Обычно разнос по высоте 10–15 м (не меньше 150 длин волн), вторую антенну ставят ниже основной. Просвет для неё проверяется отдельно — смотрите «Итог» и «Подробно».</p>
        </>
      ) : null}
      {scheme === 'fd' && p ? (
        <div className="grid2">
          <Field label="Разнос частот Δf, МГц" htmlFor={id('df')} hint={`${(+((p.fdSpacingMHz / (link.channels[0].freqMHz || 1)) * 100).toFixed(1)).toString().replace('.', ',')} % от частоты ствола 1; обычно 2–5 %`}><NumField id={id('df')} value={p.fdSpacingMHz} min={0} onChange={(v) => upd({ fdSpacingMHz: v ?? 0 })} /></Field>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- inputs ---------------- */

function Inputs({ link, set, dirty, onApply, onDiscard }: { link: Link; set(p: Partial<Link>): void; dirty: boolean; onApply(): void; onDiscard(): void }) {
  const { sites, library } = useStore();
  const A = sites.find((s) => s.id === link.siteA), B = sites.find((s) => s.id === link.siteB);
  const setCh = (i: 0 | 1, patch: Partial<Channel>) => {
    const ch = [...link.channels] as Link['channels'];
    ch[i] = { ...ch[i], ...patch };
    set({ channels: ch });
  };
  const setCl = (patch: Partial<Climate>) => set({ climate: { ...link.climate, ...patch } });
  const pickAntenna = (side: 'A' | 'B', id: string) => {
    const m = library.antennas.find((a) => a.id === id);
    if (!m) return;
    const gainAt = (fMHz: number): number | null => {
      if (!m.gains.length) return null;
      const g = m.gains.slice().sort((a, b) => a.freqGHz - b.freqGHz), f = fMHz / 1000;
      if (f <= g[0].freqGHz) return g[0].gainDbi;
      for (let i = 1; i < g.length; i++) if (f <= g[i].freqGHz) { const t = (f - g[i - 1].freqGHz) / (g[i].freqGHz - g[i - 1].freqGHz); return +(g[i - 1].gainDbi + t * (g[i].gainDbi - g[i - 1].gainDbi)).toFixed(1); }
      return g[g.length - 1].gainDbi;
    };
    const ch = link.channels.map((c) => ({ ...c, [side === 'A' ? 'gainA' : 'gainB']: gainAt(c.freqMHz) })) as Link['channels'];
    set(side === 'A' ? { antennaA: m.name, dishA: m.diameterM, channels: ch } : { antennaB: m.name, dishB: m.diameterM, channels: ch });
  };
  const id = (s: string) => `${link.id}-${s}`;
  return (
    <>
      <div className="auto-note" role="note"><Icon name="info" />Заполните исходные данные и нажмите «Применить» внизу — пролёт будет рассчитан, результат откроется во вкладке «Подробно».</div>
      {dirty ? <div className="notice draft-note">Есть непримененные изменения. <button type="button" className="btn sm primary" onClick={onApply}>Применить</button></div> : null}
      <ProtectionEditor link={link} set={set} nameA={A?.name ?? 'A'} nameB={B?.name ?? 'B'} />
      <div className="section">
        <h3>Выбор высот подвеса антенн{link.protection?.scheme === 'sd' ? <span className="hint">основные антенны; вторые — в блоке «Схема резервирования»</span> : null}</h3>
        <div className="grid2">
          <div className="sub">{A?.name ?? 'A'}</div><div className="sub">{B?.name ?? 'B'}</div>
          <Field label="Высота подвеса, м" htmlFor={id('hA')} hint="над землёй"><NumField id={id('hA')} value={link.hA} min={0} onChange={(v) => set({ hA: v ?? 0 })} /></Field>
          <Field label="Высота подвеса, м" htmlFor={id('hB')} hint="над землёй"><NumField id={id('hB')} value={link.hB} min={0} onChange={(v) => set({ hB: v ?? 0 })} /></Field>
          <Field label="Антенна из справочника" htmlFor={id('antA')}>
            <select id={id('antA')} className="select" value="" onChange={(e) => pickAntenna('A', e.target.value)}>
              <option value="">{link.antennaA || 'Выбрать…'}</option>
              {library.antennas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Антенна из справочника" htmlFor={id('antB')}>
            <select id={id('antB')} className="select" value="" onChange={(e) => pickAntenna('B', e.target.value)}>
              <option value="">{link.antennaB || 'Выбрать…'}</option>
              {library.antennas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Диаметр антенны, м" htmlFor={id('dA')}><NumField id={id('dA')} value={link.dishA} min={0.05} onChange={(v) => set({ dishA: v ?? 0.6 })} /></Field>
          <Field label="Диаметр антенны, м" htmlFor={id('dB')}><NumField id={id('dB')} value={link.dishB} min={0.05} onChange={(v) => set({ dishB: v ?? 0.6 })} /></Field>
          <Field label="Потери в фидере, дБ" htmlFor={id('fA')}><NumField id={id('fA')} value={link.feederA} onChange={(v) => set({ feederA: v ?? 0 })} /></Field>
          <Field label="Потери в фидере, дБ" htmlFor={id('fB')}><NumField id={id('fB')} value={link.feederB} onChange={(v) => set({ feederB: v ?? 0 })} /></Field>
          <Field label="Прочие потери на пролёте, дБ" htmlFor={id('ol')} hint="разъёмы, обтекатели"><NumField id={id('ol')} value={link.otherLoss} onChange={(v) => set({ otherLoss: v ?? 0 })} /></Field>
          <Field label="Магнитное склонение, °" htmlFor={id('decl')} hint="для азимута по компасу; восточное +"><NumField id={id('decl')} value={link.declination} nullable placeholder="не задано" onChange={(v) => set({ declination: v })} /></Field>
        </div>
      </div>

      <div className="section">
        <h3>Основные параметры для двух диапазонов <span className="hint">частота, поляризация, ППУ и режимы — до двух стволов на одной антенне</span></h3>
        {([0, 1] as const).map((i) => <ChannelEditor key={i} i={i} link={link} ch={link.channels[i]} setCh={(p) => setCh(i, p)} />)}
        {channelsShareFrequency(link) ? (
          <div className="chan">
            <div className="chan-head"><b>Развязка поляризаций антенн</b><span className="tag">стволы на одной частоте</span></div>
            <p className="hint">Стволы работают на одной частоте в ортогональных поляризациях (схема CCDP), поэтому их взаимная помеха ограничена только кросс-поляризационной развязкой антенн (XPD). Для стволов в разных частотных диапазонах параметр не применяется. Значение XPD принимается по паспорту антенны.</p>
            <div className="grid2">
              <Field label={`XPD антенны «${A?.name ?? 'A'}», дБ`} htmlFor={id('xA')}><NumField id={id('xA')} value={link.xpdA} nullable placeholder="из паспорта" onChange={(v) => set({ xpdA: v })} /></Field>
              <Field label={`XPD антенны «${B?.name ?? 'B'}», дБ`} htmlFor={id('xB')}><NumField id={id('xB')} value={link.xpdB} nullable placeholder="из паспорта" onChange={(v) => set({ xpdB: v })} /></Field>
            </div>
            {link.xpdA == null || link.xpdB == null ? <div className="notice">Пока XPD не введена, помеха между стволами не учитывается и запас завышен. Это касается только случая, когда оба ствола в одном диапазоне частот.</div> : null}
          </div>
        ) : null}
      </div>

      <div className="section">
        <h3>Климат и норма</h3>
        <div className="method-row">
          <span className="method-label">Методика расчёта</span>
          <div className="seg" role="group" aria-label="Методика расчёта">
            <button type="button" aria-pressed={link.climate.method !== 'gost'} onClick={() => setCl({ method: 'itu' })}>МСЭ-R P.530</button>
            <button type="button" aria-pressed={link.climate.method === 'gost'} onClick={() => setCl({ method: 'gost', gost: { ...DEFAULT_GOST, ...(link.climate.gost ?? {}) } })}>ГОСТ Р 53363-2009</button>
          </div>
        </div>
        {link.climate.method === 'gost' ? (() => {
          const g = { ...DEFAULT_GOST, ...(link.climate.gost ?? {}) };
          const setG = (p: Partial<typeof g>) => setCl({ gost: { ...g, ...p } });
          const reg = GOST_REGIONS.find((r) => r.id === g.region) ?? GOST_REGIONS[1];
          const xi = (GOST_RAIN_XI[g.rainTerritory] ?? GOST_RAIN_XI[0]).xi;
          const okXY = A && B && [A.lat, A.lon, B.lat, B.lon].every(Number.isFinite);
          const J = okXY ? gostRainRate(xi, (A!.lat + B!.lat) / 2, (A!.lon + B!.lon) / 2) : null;
          const st = regionStats(g, 50);
          const n1 = (x: number, d = 1) => fmt(x, d);
          return (
            <>
              <p className="hint">Расчёт по ГОСТ Р 53363-2009: рефракция по климатическому району (приложение Б), субрефракция (раздел 12), интерференционные замирания — гладкие и селективные (13), разнесённый приём (14), SESR и коэффициент неготовности (15–18), дождь с интенсивностью по координатам пролёта (16, приложение В).</p>
              <div className="grid2">
                <Field label="Климатический район (прил. Б)" htmlFor={id('greg')} className="span2">
                  <select id={id('greg')} className="select" value={g.region} onChange={(e) => setG({ region: +e.target.value })}>
                    {GOST_REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id}. {r.name}</option>)}
                  </select>
                </Field>
                <Field label="Сезон" htmlFor={id('gsea')}>
                  <select id={id('gsea')} className="select" value={g.season} onChange={(e) => setG({ season: e.target.value as 'summer' | 'winter' })}>
                    <option value="summer">Летние месяцы</option>
                    <option value="winter" disabled={!reg.winter}>Зимние месяцы{reg.winter ? '' : ' (нет данных)'}</option>
                  </select>
                </Field>
                <Field label="Тип трассы" htmlFor={id('gter')}>
                  <select id={id('gter')} className="select" value={g.terrain} onChange={(e) => setG({ terrain: e.target.value as typeof g.terrain })}>
                    <option value="land">Сухопутная</option>
                    <option value="coast">Приморская (тёплые и умеренные моря)</option>
                    <option value="arctic">Побережье арктических морей</option>
                  </select>
                </Field>
                <Field label="Территория для дождя (прил. В)" htmlFor={id('gxi')} className="span2">
                  <select id={id('gxi')} className="select" value={g.rainTerritory} onChange={(e) => setG({ rainTerritory: +e.target.value })}>
                    {GOST_RAIN_XI.map((t, i) => <option key={i} value={i}>ξ = {String(t.xi).replace('.', ',')} — {t.name}</option>)}
                  </select>
                </Field>
                <Field label="Неготовность аппаратуры, %" htmlFor={id('gka')} hint="раздел 5; 0 — не учитывать"><NumField id={id('gka')} value={g.kAppPct} min={0} max={100} onChange={(v) => setG({ kAppPct: v ?? 0 })} /></Field>
                <Field label="Норма SESR, %" htmlFor={id('gsn')} hint="пусто — не проверять"><NumField id={id('gsn')} value={g.sesrNormPct} nullable min={0} placeholder="не задана" onChange={(v) => setG({ sesrNormPct: v })} /></Field>
                <Field label="Затухание в газах, дБ/км" htmlFor={id('gas')} hint="пусто — по частоте"><NumField id={id('gas')} value={link.climate.gasDbPerKm} nullable placeholder="авто" onChange={(v) => setCl({ gasDbPerKm: v })} /></Field>
                <Field label="Норма коэффициента готовности, %" htmlFor={id('av')} hint="K нг = 100 − норма"><NumField id={id('av')} value={link.climate.availabilityPct} min={90} max={100} onChange={(v) => setCl({ availabilityPct: v ?? 99.98517 })} /></Field>
              </div>
              <div className="gost-facts">
                <span>ḡ = {n1(st.gMean * 1e8)}·10⁻⁸ 1/м, σ = {n1(st.sigma * 1e8)}·10⁻⁸ 1/м</span>
                <span>k при ḡ: {fmt(kOfG(st.gMean), 2)}</span>
                <span>Интенсивность дождя J: {J != null ? n1(J) + ' мм/ч' : '—'}</span>
              </div>
              <p className="hint">Не реализованы: слабопересечённые (равнинные) трассы и трассы над водой по разделу 13.2 — для них расчёт идёт как для пересечённых; надёжность аппаратуры раздела 5 вводится готовым значением.</p>
            </>
          );
        })() : (
        <div className="grid2">
          <Field label="Рефракция k, обычная" htmlFor={id('k')}><NumField id={id('k')} value={link.climate.k} min={0.3} max={5} onChange={(v) => setCl({ k: v ?? 1.33 })} /></Field>
          <Field label="k в плохую погоду" htmlFor={id('km')} hint="субрефракция"><NumField id={id('km')} value={link.climate.kMin} min={0.3} max={5} onChange={(v) => setCl({ kMin: v ?? 0.67 })} /></Field>
          <Field label="Градиент рефракции dN1" htmlFor={id('dn')} hint="центр России ≈ −350…−450"><NumField id={id('dn')} value={link.climate.dN1} onChange={(v) => setCl({ dN1: v ?? -400 })} /></Field>
          <Field label="Дождь R₀,₀₁, мм/ч" htmlFor={id('rr')} hint="превышается 0,01 % времени"><NumField id={id('rr')} value={link.climate.rainR001} min={0} onChange={(v) => setCl({ rainR001: v ?? 30 })} /></Field>
          <Field label="Затухание в газах, дБ/км" htmlFor={id('gas')} hint="пусто — по частоте"><NumField id={id('gas')} value={link.climate.gasDbPerKm} nullable placeholder="авто" onChange={(v) => setCl({ gasDbPerKm: v })} /></Field>
          <Field label="Пересчёт месяц → год" htmlFor={id('qy')}><NumField id={id('qy')} value={link.climate.monthToYear} min={0} max={1} onChange={(v) => setCl({ monthToYear: v ?? 0.25 })} /></Field>
          <Field label="Норма доступности, %" htmlFor={id('av')} hint="например, 99,98517" className="span2"><NumField id={id('av')} value={link.climate.availabilityPct} min={90} max={100} onChange={(v) => setCl({ availabilityPct: v ?? 99.98517 })} /></Field>
        </div>
        )}
        {link.climate.method !== 'gost' && link.channels.some((c, i) => (i === 0 || c.enabled) && c.freqMHz >= 57000) ? (() => {
          const er = link.climate.eRain ?? { on: false, pdPct: 2, asrDb: 5, daDb2: 50 };
          const setEr = (p: Partial<typeof er>) => setCl({ eRain: { ...er, ...p } });
          const bad = er.on && er.daDb2 < er.asrDb * er.asrDb;
          return (
            <div className="chan" style={{ marginTop: 10 }}>
              <label className="check"><input type="checkbox" checked={er.on} onChange={(e) => setEr({ on: e.target.checked })} /> Дождь для E-band по местной статистике (метод моментов)</label>
              <p className="hint">Для диапазона 60–90 ГГц расчёт по МСЭ-R P.530 часто слишком оптимистичен. Метод моментов (Степанец И.В., СПбГУТ, 2024) строит распределение дождевых замираний по статистике вашего района: доля времени с дождём, среднее ослабление в дожде и его дисперсия. Данные берут из наблюдений на действующих пролётах или метеостатистики; без них оставьте выключенным.</p>
              {er.on ? (
                <div className="grid3">
                  <Field label="Вероятность дождя Pd, %" htmlFor={id('pd')}><NumField id={id('pd')} value={er.pdPct} min={0.001} max={100} onChange={(v) => setEr({ pdPct: v ?? 2 })} /></Field>
                  <Field label="Среднее ослабление в дожде, дБ" htmlFor={id('asr')}><NumField id={id('asr')} value={er.asrDb} min={0.01} onChange={(v) => setEr({ asrDb: v ?? 5 })} /></Field>
                  <Field label="Дисперсия ослабления, дБ²" htmlFor={id('da')}><NumField id={id('da')} value={er.daDb2} min={0.01} onChange={(v) => setEr({ daDb2: v ?? 50 })} /></Field>
                </div>
              ) : null}
              {bad ? <div className="notice">Дисперсия должна быть не меньше квадрата среднего ослабления ({String(+(er.asrDb * er.asrDb).toFixed(1)).replace('.', ',')} дБ²) — иначе распределение не строится, расчёт идёт по МСЭ-R.</div> : null}
            </div>
          );
        })() : null}
      </div>

      <div className="section">
        <h3>Заметки</h3>
        <textarea id={id('notes')} className="textarea" rows={3} value={link.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Заметки к пролёту" style={{ fontFamily: 'var(--f-ui)' }} />
      </div>
      <div className="apply-bar">
        <button type="button" className="btn primary apply-btn" onClick={onApply}><Icon name="check" />Применить</button>
        {dirty ? <button type="button" className="btn" onClick={onDiscard}>Отменить изменения</button> : null}
        <span className="hint">{dirty ? 'Изменения ещё не учтены в расчёте.' : 'Все изменения применены.'}</span>
      </div>
    </>
  );
}

function ChannelEditor({ i, link, ch, setCh }: { i: 0 | 1; link: Link; ch: Channel; setCh(p: Partial<Channel>): void }) {
  const { library, saveLibrary } = useStore();
  const filled = ch.modes.filter((m) => !incomplete(m));
  const inLib = library.radios.some((r) => r.name === ch.radioName);
  const saveRadio = () => {
    const name = ch.radioName || `ППУ ${ghz(ch.freqMHz)}`;
    saveLibrary({ ...library, radios: [...library.radios, { id: uid(), name, band: ghz(ch.freqMHz), modes: filled.map((m) => ({ ...m })), notes: '' }] });
    if (!ch.radioName) setCh({ radioName: name });
  };
  const id = (s: string) => `${link.id}-c${i}-${s}`;
  const fG = ch.freqMHz / 1000;
  return (
    <div className="chan">
      <div className="chan-head">
        {i === 0 ? <b>Ствол 1</b> : <label className="check"><input type="checkbox" checked={ch.enabled} onChange={(e) => setCh({ enabled: e.target.checked })} /> Ствол 2 на той же антенне</label>}
        {ch.enabled || i === 0 ? <span className="tag">{ghz(ch.freqMHz)} · {ch.pol}</span> : null}
      </div>
      {ch.enabled || i === 0 ? (
        <>
          <div className="grid3">
            <Field label="Частота, МГц" htmlFor={id('f')}><NumField id={id('f')} value={ch.freqMHz} min={100} max={100000} onChange={(v) => setCh({ freqMHz: v ?? 6000 })} /></Field>
            <Field label="Полоса, МГц" htmlFor={id('bw')}><NumField id={id('bw')} value={ch.bwMHz} min={0} onChange={(v) => setCh({ bwMHz: v ?? 28 })} /></Field>
            <Field label="Поляризация" htmlFor={id('pol')}>
              <select id={id('pol')} className="select" value={ch.pol} onChange={(e) => setCh({ pol: e.target.value as 'H' | 'V' })}>
                <option value="H">Горизонтальная</option><option value="V">Вертикальная</option>
              </select>
            </Field>
            <Field label="КУ антенны A, дБ" htmlFor={id('gA')} hint={`расчётный ${fmt(dishGain(link.dishA, fG), 1)} дБ`}><NumField id={id('gA')} value={ch.gainA} nullable placeholder="авто" onChange={(v) => setCh({ gainA: v })} /></Field>
            <Field label="КУ антенны B, дБ" htmlFor={id('gB')} hint={`расчётный ${fmt(dishGain(link.dishB, fG), 1)} дБ`}><NumField id={id('gB')} value={ch.gainB} nullable placeholder="авто" onChange={(v) => setCh({ gainB: v })} /></Field>
            <Field label="Корректировка порогов, дБ" htmlFor={id('thc')} hint="внесите значение из паспорта ППУ"><NumField id={id('thc')} value={ch.thrCorrDb ?? 0} min={-20} max={30} onChange={(v) => setCh({ thrCorrDb: v ?? 0 })} /></Field>
          </div>
          <p className="hint">Корректировка порогов прибавляется ко всем порогам в таблице ниже. Требуется внести значение из паспорта ППУ (например, ухудшение порога при включённом XPIC, для другой полосы или температуры): «+» — порог хуже, «−» — лучше. 0 — пороги как в таблице.</p>
          <Field label="ППУ из справочника" htmlFor={id('radio')} hint="подставит типы модуляции, мощность и пороги">
            <select id={id('radio')} className="select" value="" onChange={(e) => {
              const r = library.radios.find((x) => x.id === e.target.value);
              if (r) setCh({ radioName: r.name, modes: r.modes.map((m) => ({ ...m })) });
            }}>
              <option value="">{ch.radioName || 'Выбрать…'}</option>
              {library.radios.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <ModesEditor idBase={id('m')} modes={ch.modes} onChange={(modes) => setCh({ modes })} />
          {filled.length && !inLib ? <div><button type="button" className="btn sm" onClick={saveRadio}><Icon name="download" />Сохранить ППУ в справочник</button> <span className="hint">«{ch.radioName || `ППУ ${ghz(ch.freqMHz)}`}» — типы модуляции этого ствола</span></div> : null}
        </>
      ) : <p className="hint">Включите, если на эту антенну ставится второй диапазон.</p>}
    </div>
  );
}

/* ---------------- profile ---------------- */

const TYPE_OUT: Record<string, string> = { b: 'З', f: 'Л', w: 'В' };
const TYPE_IN: Record<string, 'b' | 'f' | 'w'> = { 'з': 'b', 'b': 'b', 'л': 'f', 'f': 'f', 'в': 'w', 'w': 'w' };
const fmtPts = (pts: ProfilePoint[]) =>
  pts.map((p) => `${p.d.toFixed(3).replace('.', ',')}; ${(+p.g.toFixed(1)).toString().replace('.', ',')}; ${(+p.c.toFixed(1)).toString().replace('.', ',')}${p.t ? '; ' + TYPE_OUT[p.t] : ''}`).join('\n');

function parsePts(text: string): { pts: ProfilePoint[]; bad: number[] } {
  const pts: ProfilePoint[] = [], bad: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || !/^[-+\d.,]/.test(s)) return;
    const parts = /[;\t]/.test(s) ? s.split(/[;\t]+/) : /\s/.test(s) ? s.split(/\s+/) : s.split(',');
    const raw = parts.map((x) => x.trim()).filter(Boolean);
    const tk = raw.length > 2 ? TYPE_IN[raw[raw.length - 1].toLowerCase()[0]] : undefined;
    const v = (tk ? raw.slice(0, -1) : raw).map(parseNum);
    if (v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) { bad.push(i + 1); return; }
    const pt: ProfilePoint = { d: v[0], g: v[1], c: Number.isFinite(v[2]) ? Math.max(0, v[2]) : 0 };
    if (tk) pt.t = tk;
    pts.push(pt);
  });
  pts.sort((a, b) => a.d - b.d);
  return { pts, bad };
}

function ProfileTab({ link, result, set, notify, autoLoading }: { link: Link; result: LinkResult | undefined; set(p: Partial<Link>): void; notify(t: string, e?: boolean): void; autoLoading: boolean }) {
  const { sites } = useStore();
  const A = sites.find((s) => s.id === link.siteA)!, B = sites.find((s) => s.id === link.siteB)!;
  const [text, setText] = useState(() => fmtPts(link.profile));
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [clutter, setClutter] = useState<number | null>(15);
  const forestH = link.forestHeight ?? 20;
  const parsed = useMemo(() => parsePts(text), [text]);
  useEffect(() => { setText(fmtPts(link.profile)); }, [link.id, link.profileFetchedAt, link.clutterFetchedAt]);

  /** Terrain from SRTM (optional) and then buildings + forest from OpenStreetMap. */
  const loadAll = async (withTerrain: boolean) => {
    let base = link.profile;
    const patch: Partial<Link> = {};
    try {
      if (withTerrain || base.length < 2) {
        setBusy('Загружаю рельеф SRTM…'); setProgress(0.1);
        base = await fetchTerrainProfile(A.lat, A.lon, B.lat, B.lon, (d, t) => setProgress(0.1 + 0.4 * (d / t)));
        Object.assign(patch, { profileSource: 'srtm', profileFetchedAt: Date.now() });
      } else {
        base = base.map((p) => ({ d: p.d, g: p.g, c: 0 }));
      }
      setBusy('Ищу здания, лес и водоёмы на трассе (OpenStreetMap)…'); setProgress(0.6);
      const objs = await fetchClutterObjects(A.lat, A.lon, B.lat, B.lon, { forestHeight: forestH });
      let canopy: Canopy | null = null, canopyError: string | undefined;
      if (link.satTrees !== false) {
        setBusy('Загружаю деревья со спутниковой карты высот…'); setProgress(0.7);
        try { canopy = await fetchCanopy(A.lat, A.lon, B.lat, B.lon, vincenty(A.lat, A.lon, B.lat, B.lon).km, forestH, (f) => setProgress(0.7 + 0.25 * f)); }
        catch (e) { canopyError = (e as Error).message || 'нет связи'; }
      }
      setProgress(0.97);
      const res = applyClutter(base, A.lat, A.lon, B.lat, B.lon, objs, { forestHeight: forestH, canopy, canopyError });
      Object.assign(patch, { profile: res.profile, clutterSource: 'osm', clutterFetchedAt: Date.now(), clutterSummary: res.summary, clutterSat: canopy?.source ?? null });
      set(patch);
      setText(fmtPts(res.profile));
      notify(res.summary);
    } catch (e) {
      if (patch.profileSource) { set({ ...patch, profile: base }); setText(fmtPts(base)); }
      notify(`${(e as Error).message || 'Не удалось загрузить данные.'}${patch.profileSource ? ' Рельеф загружен, здания, лес и вода — нет: повторите позже или задайте их вручную.' : ''}`, true);
    } finally {
      setBusy(null); setProgress(0);
    }
  };
  const applyText = (t: string) => {
    setText(t);
    const p = parsePts(t);
    if (p.pts.length >= 2) set({ profile: p.pts, profileSource: 'manual', clutterSource: 'manual' });
  };
  const fillClutter = () => {
    if (clutter == null || link.profile.length < 2) return;
    const D = link.profile[link.profile.length - 1].d;
    const pts = link.profile.map((p) => ({ ...p, c: p.d > 0.05 && p.d < D - 0.05 ? clutter : p.c }));
    set({ profile: pts, clutterSource: 'manual', clutterSummary: `Препятствия заданы вручную: ${clutter} м по всей трассе.` });
    setText(fmtPts(pts));
  };
  const date = (t?: number | null) => (t ? new Date(t).toLocaleDateString('ru-RU') : '');
  return (
    <>
      {result ? <ProfileChart r={result} height={240} linkId={link.id} notify={notify} /> : null}
      <div className="section">
        <h3>Рельеф, здания, лес и вода с карты <span className="hint">загружаются автоматически</span></h3>
        <p className="hint">Высоты земли — из открытой базы SRTM 30 м (OpenTopoData). Здания и водоёмы на трассе — из OpenStreetMap (Overpass API): высота здания берётся из карты (высота или этажность), если её нет — типовая для вида здания. Лес — по спутниковой карте высот деревьев Meta и WRI (пиксель около 1 м, реальная высота крон, просеки и поляны видны); если она недоступна — по карте растительности ESA WorldCover и лесным массивам OpenStreetMap с высотой, указанной ниже. Над водой рассчитывается отражение луча от водной глади (см. «Итог»). Загрузка идёт сама: при создании пролёта, после переноса объекта и при восстановлении сети, если раньше не получилось. Кнопки ниже — чтобы обновить вручную. Ключи не нужны; после загрузки всё хранится в программе и работает без интернета. Профиль, введённый вручную, программа не перезаписывает.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={() => void loadAll(true)} disabled={!!busy || autoLoading}><Icon name="mountain" />{link.profileSource === 'srtm' ? 'Загрузить заново' : 'Загрузить сейчас'}</button>
          <button type="button" className="btn" onClick={() => void loadAll(false)} disabled={!!busy || autoLoading || link.profile.length < 2} title="Рельеф не трогать, обновить только здания, лес и воду">Обновить только здания, лес и воду</button>
          <Field label="Высота леса, м" htmlFor={`${link.id}-fh`} hint="если нет карты высот деревьев"><NumField id={`${link.id}-fh`} value={forestH} min={0} max={60} onChange={(v) => set({ forestHeight: v ?? 20 })} /></Field>
        </div>
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={link.satTrees !== false} onChange={(e) => set({ satTrees: e.target.checked })} /> Лес по спутниковым данным (рекомендуется) — после изменения нажмите «Обновить только здания, лес и воду»
        </label>
        {busy ? <><div className="hint">{busy}</div><div className="progress" aria-label={busy}><div style={{ width: `${Math.max(8, progress * 100)}%` }} /></div></> : null}
        <div className="kv">
          <div className="t">Рельеф</div>
          <div className="r" style={{ fontFamily: 'var(--f-ui)' }}>{link.profileSource === 'srtm' ? `SRTM, ${date(link.profileFetchedAt)}` : link.profileSource === 'manual' ? 'введён вручную' : 'не задан'}</div>
          <div className="t">Здания, лес, вода<small>{link.clutterSummary || ''}</small></div>
          <div className="r" style={{ fontFamily: 'var(--f-ui)' }}>{link.clutterSource === 'osm' ? `OpenStreetMap${link.clutterSat === 'chm' ? ' + карта высот деревьев' : link.clutterSat === 'worldcover' ? ' + ESA WorldCover' : ''}, ${date(link.clutterFetchedAt)}` : link.clutterSource === 'manual' ? 'вручную' : 'не заданы'}</div>
        </div>
        <p className="hint">Данные OpenStreetMap бывают неполными: в сёлах и на окраинах часть зданий и мелких водоёмов может быть не нанесена. Спутниковая карта высот деревьев построена моделью по снимкам и даёт погрешность в несколько метров; рельеф SRTM в лесу частично включает кроны. Сверяйте с обследованием трассы и при необходимости правьте вручную.</p>
      </div>
      <details className="section">
        <summary className="sub" style={{ cursor: 'pointer' }}>Задать препятствия вручную</summary>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
          <Field label="Высота по всей трассе, м" htmlFor={`${link.id}-cl`}><NumField id={`${link.id}-cl`} value={clutter} nullable min={0} onChange={setClutter} /></Field>
          <button type="button" className="btn" onClick={fillClutter} disabled={link.profile.length < 2}>Применить ко всем точкам</button>
        </div>
        <p className="hint">Кроме 50 м у каждого объекта. Отдельные участки правьте в таблице ниже (третье число в строке).</p>
      </details>
      <div className="section">
        <h3>Точки профиля <span className="hint">расстояние, км; земля, м; высота препятствия, м; тип: З — здание, Л — лес, В — вода (необязательно)</span></h3>
        <textarea id={`${link.id}-profile`} className="textarea" rows={12} spellCheck={false} value={text} onChange={(e) => applyText(e.target.value)} aria-label="Точки профиля" />
        {parsed.bad.length ? <div className="notice">Не прочитаны строки: {parsed.bad.slice(0, 8).join(', ')}. Они пропущены.</div> : null}
        <p className="hint">Можно вставить столбцы из Excel. Первая точка — «{A.name}», последняя — «{B.name}». Если длина профиля не совпадает с расстоянием по координатам, профиль растягивается.</p>
      </div>
    </>
  );
}
