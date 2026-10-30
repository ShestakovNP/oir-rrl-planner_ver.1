/** Site editor: name, code, coordinates, ground height, links from this site. */
import { useEffect, useState } from 'react';
import type { Site } from '../data/types';
import { formatDms, parseCoord } from '../data/calc/geo';
import { fmt } from '../data/calc/format';
import { useStore } from '../state/store';
import { openExternal } from '../net/external';
import { Field, Icon } from './ui';

interface Props {
  site: Site;
  onClose(): void;
  onDelete(): void;
  onOpenLink(id: string): void;
  onStartLink(): void;
  onFocus(): void;
  onMove(): void;
  onAddSiteMap(): void;
  onAddSiteCoords(): void;
}

function CoordInput({ id, value, isLat, onChange }: { id: string; value: number; isLat: boolean; onChange(v: number): void }) {
  const [text, setText] = useState(Number.isFinite(value) ? value.toFixed(6) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(Number.isFinite(value) ? value.toFixed(6) : ''); setBad(false); }, [value]);
  return (
    <input
      id={id} className={`input num ${bad ? 'invalid' : ''}`} value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseCoord(e.target.value);
        const ok = Number.isFinite(v) && Math.abs(v) <= (isLat ? 90 : 180);
        setBad(!ok);
        if (ok) onChange(v);
      }}
      onBlur={() => { setText(Number.isFinite(value) ? value.toFixed(6) : ''); setBad(false); }}
    />
  );
}

export function SitePanel({ site, onClose, onDelete, onOpenLink, onStartLink, onFocus, onMove, onAddSiteMap, onAddSiteCoords }: Props) {
  const [needPair, setNeedPair] = useState(false);
  const { updateSite, links, sites, results } = useStore();
  const set = (patch: Partial<Site>) => updateSite({ ...site, ...patch });
  const mine = links.filter((l) => l.siteA === site.id || l.siteB === site.id);
  const id = (s: string) => `${site.id}-${s}`;
  return (
    <aside className="panel" aria-label="Объект">
      <div className="panel-head" style={{ paddingBottom: 12 }}>
        <div className="panel-title">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Объект{site.code ? ' · ' + site.code : ''}</div>
            <h2>{site.name || 'Без названия'}</h2>
          </div>
          <button className="btn sm" type="button" onClick={onFocus} title="Показать на карте"><Icon name="target" /></button>
          <button className="btn sm danger" type="button" onClick={onDelete} title="Удалить объект"><Icon name="trash" /></button>
          <button className="btn sm ghost" type="button" onClick={onClose} title="Закрыть"><Icon name="close" /></button>
        </div>
      </div>
      <div className="panel-body">
        <div className="section">
          <div className="grid2">
            <Field label="Название" htmlFor={id('name')} className="span2"><input id={id('name')} className="input" value={site.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Номер БС / код" htmlFor={id('code')} className="span2"><input id={id('code')} className="input" value={site.code} onChange={(e) => set({ code: e.target.value })} /></Field>
            <Field label="Широта" htmlFor={id('lat')} hint={formatDms(site.lat, true)}><CoordInput id={id('lat')} value={site.lat} isLat onChange={(v) => set({ lat: v })} /></Field>
            <Field label="Долгота" htmlFor={id('lon')} hint={formatDms(site.lon, false)}><CoordInput id={id('lon')} value={site.lon} isLat={false} onChange={(v) => set({ lon: v })} /></Field>
          </div>
          <p className="hint">Координаты можно вводить как 56.5486, 56,5486 или 56°32'55.06". Если точка стоит не там, наведите на неё курсор на карте и нажмите «Изменить положение» (или кнопку ниже), затем перетащите её и сохраните.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn sm primary" onClick={onMove}><Icon name="pin" />Изменить положение на карте</button>
            <button type="button" className="btn sm" onClick={() => void openExternal(`https://yandex.ru/maps/?pt=${site.lon},${site.lat}&z=16&l=sat%2Cskl`)}>Яндекс Карты</button>
            <button type="button" className="btn sm" onClick={() => void openExternal(`https://www.openstreetmap.org/?mlat=${site.lat}&mlon=${site.lon}#map=16/${site.lat}/${site.lon}`)}>OpenStreetMap</button>
          </div>
        </div>
        <div className="section">
          <h3>Пролёты <span className="hint">{mine.length || 'нет'}</span></h3>
          {mine.map((l) => {
            const other = sites.find((s) => s.id === (l.siteA === site.id ? l.siteB : l.siteA));
            const r = results.get(l.id);
            return (
              <button key={l.id} type="button" className="item" onClick={() => onOpenLink(l.id)}>
                <span className={`dot ${r?.verdict.level ?? ''}`} />
                <span className="t">→ {other?.name ?? '?'}</span>
                <span className="r">{r ? fmt(r.path.D, 2) + ' км' : ''}</span>
                <span className="s">{r ? r.verdict.label : ''}{r?.geo ? ` · азимут ${fmt(l.siteA === site.id ? r.geo.az1 : r.geo.az2, 1)}°` : ''}</span>
              </button>
            );
          })}
          {sites.length < 2 ? (
            <>
              <div><button type="button" className="btn sm need-pair" onClick={() => setNeedPair(true)} title="Сначала создайте ответный объект"><Icon name="link" />Новый пролёт отсюда</button></div>
              {needPair ? (
                <div className="notice need-pair-msg" role="alert">
                  <b>Требуется создать ответный объект.</b> Пролёт строится между двумя объектами, а в проекте пока только «{site.name || 'Без названия'}». Добавьте второй объект — на другом конце пролёта.
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button type="button" className="btn sm primary" onClick={onAddSiteMap}><Icon name="pin" />Поставить на карте</button>
                    <button type="button" className="btn sm" onClick={onAddSiteCoords}><Icon name="edit" />Ввести координаты</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            (() => {
              const linked = new Set(mine.map((l) => (l.siteA === site.id ? l.siteB : l.siteA)));
              const free = sites.filter((x) => x.id !== site.id && !linked.has(x.id));
              return free.length ? (
                <div><button type="button" data-guide="site-link" className="btn sm can-pair" onClick={onStartLink} title={`Можно соединить с: ${free.map((x) => x.name || 'Без названия').join(', ')}`}><Icon name="link" />Новый пролёт отсюда</button></div>
              ) : (
                <div><button type="button" className="btn sm" onClick={onStartLink} title="Со всеми объектами проекта пролёты уже есть"><Icon name="link" />Новый пролёт отсюда</button></div>
              );
            })()
          )}
        </div>
        <div className="section">
          <h3>Заметки</h3>
          <textarea id={id('notes')} className="textarea" style={{ fontFamily: 'var(--f-ui)' }} rows={4} value={site.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Заметки" />
        </div>
      </div>
    </aside>
  );
}
