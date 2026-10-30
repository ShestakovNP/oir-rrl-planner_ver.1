/** Detail panel of one link: results, inputs, terrain profile and full calculation. */
import { useEffect, useMemo, useState } from 'react';
import type { Channel, Climate, Link, ModMode, ProfilePoint } from '../data/types';
import { channelsShareFrequency, type LinkResult } from '../data/calc/link';
import { dishGain } from '../data/calc/physics';
import { fmt, ghz } from '../data/calc/format';
import { useStore } from '../state/store';
import { fetchTerrainProfile } from '../net/elevation';
import { applyClutter, fetchClutterObjects } from '../net/clutter';
import { Field, Icon, NumField, parseNum } from './ui';
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
}

export function LinkPanel({ link, result, onClose, onDelete, onReport, onFocus, notify }: Props) {
  const { sites, updateLink } = useStore();
  const [tab, setTab] = useState<Tab>('result');
  const A = sites.find((s) => s.id === link.siteA), B = sites.find((s) => s.id === link.siteB);
  const set = (patch: Partial<Link>) => updateLink({ ...link, ...patch });
  const tabs: [Tab, string][] = [['result', 'Итог'], ['input', 'Исходные данные'], ['profile', 'Профиль'], ['detail', 'Подробно']];

  return (
    <aside className="panel wide" aria-label="Пролёт">
      <div className="panel-head">
        <div className="panel-title">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Пролёт{result ? ` · ${fmt(result.path.D, 2)} км` : ''}</div>
            <h2>{A?.name ?? '?'} — {B?.name ?? '?'}</h2>
          </div>
          <button className="btn sm" type="button" onClick={onFocus} title="Показать на карте"><Icon name="target" /></button>
          <button className="btn sm" type="button" onClick={onReport} disabled={!result?.ok}><Icon name="pdf" />PDF</button>
          <button className="btn sm danger" type="button" onClick={onDelete} title="Удалить пролёт"><Icon name="trash" /></button>
          <button className="btn sm ghost" type="button" onClick={onClose} title="Закрыть"><Icon name="close" /></button>
        </div>
        <div className="tabs" role="tablist">
          {tabs.map(([k, t]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>)}
        </div>
      </div>
      <div className="panel-body">
        {!A || !B ? <div className="notice">Одна из площадок пролёта удалена.</div> : null}
        {result && tab === 'result' ? (
          <>
            <Verdict r={result} />
            <div className="section"><h3>Рекомендации</h3><Recommendations r={result} /></div>
            <div className="section"><h3>Профиль трассы <span className="hint">наведите курсор на график или на линию пролёта на карте</span></h3><ProfileChart r={result} linkId={link.id} /></div>
            <div className="section"><h3>Направление антенн <span className="hint">азимут от севера по часовой стрелке</span></h3><Azimuths r={result} decl={link.declination} /></div>
          </>
        ) : null}
        {tab === 'input' ? <Inputs link={link} set={set} /> : null}
        {tab === 'profile' && A && B ? <ProfileTab link={link} result={result} set={set} notify={notify} /> : null}
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

/* ---------------- inputs ---------------- */

function Inputs({ link, set }: { link: Link; set(p: Partial<Link>): void }) {
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
      <div className="section">
        <h3>Площадки и подвес антенн</h3>
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
        <h3>Каналы на антенне <span className="hint">до двух диапазонов на разных поляризациях</span></h3>
        {([0, 1] as const).map((i) => <ChannelEditor key={i} i={i} link={link} ch={link.channels[i]} setCh={(p) => setCh(i, p)} />)}
        {channelsShareFrequency(link) ? (
          <div className="chan">
            <div className="chan-head"><b>Развязка поляризаций антенн</b><span className="tag">каналы на одной частоте</span></div>
            <p className="hint">Каналы работают на одной частоте в ортогональных поляризациях (схема CCDP), поэтому их взаимная помеха ограничена только кросс-поляризационной развязкой антенн (XPD). Для каналов в разных частотных диапазонах параметр не применяется. Значение XPD принимается по паспорту антенны.</p>
            <div className="grid2">
              <Field label={`XPD антенны «${A?.name ?? 'A'}», дБ`} htmlFor={id('xA')}><NumField id={id('xA')} value={link.xpdA} nullable placeholder="из паспорта" onChange={(v) => set({ xpdA: v })} /></Field>
              <Field label={`XPD антенны «${B?.name ?? 'B'}», дБ`} htmlFor={id('xB')}><NumField id={id('xB')} value={link.xpdB} nullable placeholder="из паспорта" onChange={(v) => set({ xpdB: v })} /></Field>
            </div>
            {link.xpdA == null || link.xpdB == null ? <div className="notice">Пока XPD не введена, помеха между каналами не учитывается и запас завышен. Это касается только случая, когда оба канала в одном диапазоне частот.</div> : null}
          </div>
        ) : null}
      </div>

      <div className="section">
        <h3>Климат и норма</h3>
        <div className="grid2">
          <Field label="Рефракция k, обычная" htmlFor={id('k')}><NumField id={id('k')} value={link.climate.k} min={0.3} max={5} onChange={(v) => setCl({ k: v ?? 1.33 })} /></Field>
          <Field label="k в плохую погоду" htmlFor={id('km')} hint="субрефракция"><NumField id={id('km')} value={link.climate.kMin} min={0.3} max={5} onChange={(v) => setCl({ kMin: v ?? 0.67 })} /></Field>
          <Field label="Градиент рефракции dN1" htmlFor={id('dn')} hint="центр России ≈ −350…−450"><NumField id={id('dn')} value={link.climate.dN1} onChange={(v) => setCl({ dN1: v ?? -400 })} /></Field>
          <Field label="Дождь R₀,₀₁, мм/ч" htmlFor={id('rr')} hint="превышается 0,01 % времени"><NumField id={id('rr')} value={link.climate.rainR001} min={0} onChange={(v) => setCl({ rainR001: v ?? 30 })} /></Field>
          <Field label="Затухание в газах, дБ/км" htmlFor={id('gas')} hint="пусто — по частоте"><NumField id={id('gas')} value={link.climate.gasDbPerKm} nullable placeholder="авто" onChange={(v) => setCl({ gasDbPerKm: v })} /></Field>
          <Field label="Пересчёт месяц → год" htmlFor={id('qy')}><NumField id={id('qy')} value={link.climate.monthToYear} min={0} max={1} onChange={(v) => setCl({ monthToYear: v ?? 0.25 })} /></Field>
          <Field label="Норма доступности, %" htmlFor={id('av')} hint="например, 99,98517" className="span2"><NumField id={id('av')} value={link.climate.availabilityPct} min={90} max={100} onChange={(v) => setCl({ availabilityPct: v ?? 99.98517 })} /></Field>
        </div>
      </div>

      <div className="section">
        <h3>Заметки</h3>
        <textarea id={id('notes')} className="textarea" rows={3} value={link.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Заметки к пролёту" style={{ fontFamily: 'var(--f-ui)' }} />
      </div>
    </>
  );
}

function ChannelEditor({ i, link, ch, setCh }: { i: 0 | 1; link: Link; ch: Channel; setCh(p: Partial<Channel>): void }) {
  const { library } = useStore();
  const id = (s: string) => `${link.id}-c${i}-${s}`;
  const fG = ch.freqMHz / 1000;
  const setMode = (k: number, patch: Partial<ModMode>) => setCh({ modes: ch.modes.map((m, j) => (j === k ? { ...m, ...patch } : m)) });
  return (
    <div className="chan">
      <div className="chan-head">
        {i === 0 ? <b>Канал 1</b> : <label className="check"><input type="checkbox" checked={ch.enabled} onChange={(e) => setCh({ enabled: e.target.checked })} /> Канал 2 на той же антенне</label>}
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
            <Field label="Объединение, дБ" htmlFor={id('omt')} hint="ОМТ/диплексер, на конце"><NumField id={id('omt')} value={ch.combinerLossDb} min={0} onChange={(v) => setCh({ combinerLossDb: v ?? 0 })} /></Field>
          </div>
          <Field label="ППУ из справочника" htmlFor={id('radio')} hint="подставит режимы, мощность и пороги">
            <select id={id('radio')} className="select" value="" onChange={(e) => {
              const r = library.radios.find((x) => x.id === e.target.value);
              if (r) setCh({ radioName: r.name, modes: r.modes.map((m) => ({ ...m })) });
            }}>
              <option value="">{ch.radioName || 'Выбрать…'}</option>
              {library.radios.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <div className="tbl-wrap">
            <table className="tbl edit">
              <thead><tr><th>Режим</th><th className="n">Мбит/с</th><th className="n">Мощность, дБм</th><th className="n">Порог, дБм</th><th /></tr></thead>
              <tbody>
                {ch.modes.map((m, k) => (
                  <tr key={k}>
                    <td><input id={id('mn' + k)} className="input" value={m.name} onChange={(e) => setMode(k, { name: e.target.value })} aria-label="Режим" /></td>
                    <td><NumField id={id('mr' + k)} value={m.rateMbps} onChange={(v) => setMode(k, { rateMbps: v ?? 0 })} ariaLabel="Скорость" /></td>
                    <td><NumField id={id('mp' + k)} value={m.txDbm} onChange={(v) => setMode(k, { txDbm: v ?? 0 })} ariaLabel="Мощность передатчика" /></td>
                    <td><NumField id={id('mt' + k)} value={m.thresholdDbm} onChange={(v) => setMode(k, { thresholdDbm: v ?? -70 })} ariaLabel="Порог приёмника" /></td>
                    <td><button type="button" className="x" aria-label="Удалить режим" onClick={() => setCh({ modes: ch.modes.filter((_, j) => j !== k) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button type="button" className="btn sm" onClick={() => { const l = ch.modes[ch.modes.length - 1]; setCh({ modes: [...ch.modes, l ? { ...l, name: 'Новый' } : { name: 'QPSK', rateMbps: 40, txDbm: 20, thresholdDbm: -80 }] }); }}><Icon name="plus" />Режим</button></div>
        </>
      ) : <p className="hint">Включите, если на эту антенну ставится второй диапазон.</p>}
    </div>
  );
}

/* ---------------- profile ---------------- */

const fmtPts = (pts: ProfilePoint[]) =>
  pts.map((p) => `${p.d.toFixed(3).replace('.', ',')}; ${(+p.g.toFixed(1)).toString().replace('.', ',')}; ${(+p.c.toFixed(1)).toString().replace('.', ',')}`).join('\n');

function parsePts(text: string): { pts: ProfilePoint[]; bad: number[] } {
  const pts: ProfilePoint[] = [], bad: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || !/^[-+\d.,]/.test(s)) return;
    const parts = /[;\t]/.test(s) ? s.split(/[;\t]+/) : /\s/.test(s) ? s.split(/\s+/) : s.split(',');
    const v = parts.map((x) => x.trim()).filter(Boolean).map(parseNum);
    if (v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) { bad.push(i + 1); return; }
    pts.push({ d: v[0], g: v[1], c: Number.isFinite(v[2]) ? Math.max(0, v[2]) : 0 });
  });
  pts.sort((a, b) => a.d - b.d);
  return { pts, bad };
}

function ProfileTab({ link, result, set, notify }: { link: Link; result: LinkResult | undefined; set(p: Partial<Link>): void; notify(t: string, e?: boolean): void }) {
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
        base = base.map((p) => ({ ...p, c: 0 }));
      }
      setBusy('Ищу здания и лес на трассе (OpenStreetMap)…'); setProgress(0.6);
      const objs = await fetchClutterObjects(A.lat, A.lon, B.lat, B.lon, { forestHeight: forestH });
      setProgress(0.9);
      const res = applyClutter(base, A.lat, A.lon, B.lat, B.lon, objs, { forestHeight: forestH });
      Object.assign(patch, { profile: res.profile, clutterSource: 'osm', clutterFetchedAt: Date.now(), clutterSummary: res.summary });
      set(patch);
      setText(fmtPts(res.profile));
      notify(res.summary);
    } catch (e) {
      if (patch.profileSource) { set({ ...patch, profile: base }); setText(fmtPts(base)); }
      notify(`${(e as Error).message || 'Не удалось загрузить данные.'}${patch.profileSource ? ' Рельеф загружен, здания и лес — нет: повторите позже или задайте их вручную.' : ''}`, true);
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
      {result ? <ProfileChart r={result} height={240} linkId={link.id} /> : null}
      <div className="section">
        <h3>Рельеф, здания и лес с карты</h3>
        <p className="hint">Высоты земли — из открытой базы SRTM 30 м (OpenTopoData). Здания и лесные массивы на трассе — из OpenStreetMap (Overpass API): высота здания берётся из карты (высота или этажность), если её нет — типовая для вида здания; для леса — высота, указанная ниже. Ключи не нужны. После загрузки всё хранится в программе и работает без интернета.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={() => void loadAll(true)} disabled={!!busy}><Icon name="mountain" />{link.profileSource === 'srtm' ? 'Загрузить заново' : 'Загрузить рельеф, здания и лес'}</button>
          <button type="button" className="btn" onClick={() => void loadAll(false)} disabled={!!busy || link.profile.length < 2} title="Рельеф не трогать, обновить только здания и лес">Обновить только здания и лес</button>
          <Field label="Высота леса, м" htmlFor={`${link.id}-fh`}><NumField id={`${link.id}-fh`} value={forestH} min={0} max={60} onChange={(v) => set({ forestHeight: v ?? 20 })} /></Field>
        </div>
        {busy ? <><div className="hint">{busy}</div><div className="progress" aria-label={busy}><div style={{ width: `${Math.max(8, progress * 100)}%` }} /></div></> : null}
        <div className="kv">
          <div className="t">Рельеф</div>
          <div className="r" style={{ fontFamily: 'var(--f-ui)' }}>{link.profileSource === 'srtm' ? `SRTM, ${date(link.profileFetchedAt)}` : link.profileSource === 'manual' ? 'введён вручную' : 'не задан'}</div>
          <div className="t">Здания и лес<small>{link.clutterSummary || ''}</small></div>
          <div className="r" style={{ fontFamily: 'var(--f-ui)' }}>{link.clutterSource === 'osm' ? `OpenStreetMap, ${date(link.clutterFetchedAt)}` : link.clutterSource === 'manual' ? 'вручную' : 'не заданы'}</div>
        </div>
        <p className="hint">Данные OpenStreetMap бывают неполными: в сёлах и на окраинах часть зданий и лесов может быть не нанесена. Сверяйте с обследованием трассы и при необходимости правьте вручную.</p>
      </div>
      <details className="section">
        <summary className="sub" style={{ cursor: 'pointer' }}>Задать препятствия вручную</summary>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
          <Field label="Высота по всей трассе, м" htmlFor={`${link.id}-cl`}><NumField id={`${link.id}-cl`} value={clutter} nullable min={0} onChange={setClutter} /></Field>
          <button type="button" className="btn" onClick={fillClutter} disabled={link.profile.length < 2}>Применить ко всем точкам</button>
        </div>
        <p className="hint">Кроме 50 м у каждой площадки. Отдельные участки правьте в таблице ниже (третье число в строке).</p>
      </details>
      <div className="section">
        <h3>Точки профиля <span className="hint">расстояние, км; земля, м; здания/лес, м</span></h3>
        <textarea id={`${link.id}-profile`} className="textarea" rows={12} spellCheck={false} value={text} onChange={(e) => applyText(e.target.value)} aria-label="Точки профиля" />
        {parsed.bad.length ? <div className="notice">Не прочитаны строки: {parsed.bad.slice(0, 8).join(', ')}. Они пропущены.</div> : null}
        <p className="hint">Можно вставить столбцы из Excel или DRRL. Первая точка — «{A.name}», последняя — «{B.name}». Если длина профиля не совпадает с расстоянием по координатам, профиль растягивается.</p>
      </div>
    </>
  );
}
