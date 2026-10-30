/** Modal forms: new site by coordinates, new link, about / data location. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseCoord } from '../data/calc/geo';
import { useStore } from '../state/store';
import { APP_NAME, APP_VERSION, ORG_FULL, TILE_PROVIDERS } from '../config';
import { OirMark } from '../brand/Logo';
import { tileCacheStats } from '../map/tileCache';
import { Field, parseNum } from './ui';

function Modal({ title, children, onClose, onSubmit, submit, wide }: { title: string; children: ReactNode; onClose(): void; onSubmit?(): void; submit?: string; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <h2>{title}</h2>
        {children}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>{onSubmit ? 'Отмена' : 'Закрыть'}</button>
          {onSubmit ? <button type="submit" className="btn primary">{submit ?? 'OK'}</button> : null}
        </div>
      </form>
    </div>
  );
}

export function AddSiteDialog({ onClose, onCreate, initial }: { onClose(): void; onCreate(d: { name: string; code: string; lat: number; lon: number; groundM: number | null }): void; initial?: { lat: number; lon: number } }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [lat, setLat] = useState(initial ? initial.lat.toFixed(6) : '');
  const [lon, setLon] = useState(initial ? initial.lon.toFixed(6) : '');
  const [g, setG] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = () => {
    const la = parseCoord(lat), lo = parseCoord(lon), gr = g.trim() ? parseNum(g) : null;
    if (!name.trim()) return setErr('Укажите название площадки.');
    if (!Number.isFinite(la) || Math.abs(la) > 90) return setErr('Широта должна быть от −90 до 90.');
    if (!Number.isFinite(lo) || Math.abs(lo) > 180) return setErr('Долгота должна быть от −180 до 180.');
    if (gr != null && !Number.isFinite(gr)) return setErr('Высота земли должна быть числом или пустой.');
    onCreate({ name: name.trim(), code: code.trim(), lat: la, lon: lo, groundM: gr });
  };
  return (
    <Modal title="Новая площадка" onClose={onClose} onSubmit={submit} submit="Добавить">
      <div className="grid2">
        <Field label="Название" htmlFor="ns-name" className="span2"><input id="ns-name" ref={ref} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="например, Шегарка" /></Field>
        <Field label="Широта" htmlFor="ns-lat"><input id="ns-lat" className="input num" value={lat} onChange={(e) => setLat(e.target.value)} placeholder={`56°33'50.19" или 56.5639`} /></Field>
        <Field label="Долгота" htmlFor="ns-lon"><input id="ns-lon" className="input num" value={lon} onChange={(e) => setLon(e.target.value)} placeholder={`84°04'43.34" или 84.0787`} /></Field>
        <Field label="Номер БС / код" htmlFor="ns-code"><input id="ns-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="необязательно" /></Field>
        <Field label="Высота земли, м" htmlFor="ns-g" hint="подтянется из профиля SRTM"><input id="ns-g" className="input num" value={g} onChange={(e) => setG(e.target.value)} placeholder="необязательно" /></Field>
      </div>
      {err ? <div className="notice">{err}</div> : null}
    </Modal>
  );
}

export function NewLinkDialog({ onClose, onCreate, onPickOnMap, initialA }: { onClose(): void; onCreate(a: string, b: string): void; onPickOnMap(): void; initialA?: string }) {
  const { sites } = useStore();
  const sorted = [...sites].sort((x, y) => x.name.localeCompare(y.name, 'ru'));
  const [a, setA] = useState(initialA ?? sorted[0]?.id ?? '');
  const [b, setB] = useState(sorted.find((s) => s.id !== (initialA ?? sorted[0]?.id))?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Новый пролёт" onClose={onClose} onSubmit={() => (a && b && a !== b ? onCreate(a, b) : setErr('Выберите две разные площадки.'))} submit="Создать">
      <div className="grid2">
        <Field label="Площадка A" htmlFor="nl-a"><select id="nl-a" className="select" value={a} onChange={(e) => setA(e.target.value)}>{sorted.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}</select></Field>
        <Field label="Площадка B" htmlFor="nl-b"><select id="nl-b" className="select" value={b} onChange={(e) => setB(e.target.value)}>{sorted.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}</select></Field>
      </div>
      <p>Можно выбрать площадки прямо на карте: <button type="button" className="btn sm" onClick={onPickOnMap}>Выбрать на карте</button></p>
      <p className="hint">Если есть интернет, профиль рельефа загрузится автоматически.</p>
      {err ? <div className="notice">{err}</div> : null}
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose(): void }) {
  const { repo } = useStore();
  const [loc, setLoc] = useState('…');
  const [tiles, setTiles] = useState<string>('…');
  useEffect(() => {
    void repo.location().then(setLoc).catch(() => setLoc('—'));
    void tileCacheStats().then((s) => setTiles(`${s.tiles} тайлов, около ${Math.round(s.approxMb)} МБ`));
  }, [repo]);
  return (
    <Modal title="О программе и данных" onClose={onClose} wide>
      <div className="about-mark"><OirMark size={56} /><div><b>{APP_NAME}</b><div className="hint">{ORG_FULL} · версия {APP_VERSION}</div></div></div>
      <div className="section">
        <h3>Где хранятся данные</h3>
        <p>Все проекты, площадки, пролёты и справочник хранятся только на этом компьютере, в файле базы данных:</p>
        <p className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{loc}</p>
        <p className="hint">Резервная копия: «Файл» → «Резервная копия всех данных». Восстановить её — «Файл» → «Импорт проекта или копии». Можно также скопировать сам файл базы при закрытой программе.</p>
      </div>
      <div className="section">
        <h3>Интернет</h3>
        <p className="hint">Сеть нужна только для подложек карты, поиска мест и загрузки рельефа. Расчёты, данные и отчёты работают без интернета. Кэш карты: {tiles}.</p>
        <p className="hint">Сервисы: {TILE_PROVIDERS.map((t) => t.name).join(', ')}; поиск — OSM Nominatim; рельеф — OpenTopoData (SRTM 30 м); здания и лес на трассе — OpenStreetMap (Overpass API). Других обращений в сеть нет: ни аналитики, ни регистрации, ни собственных серверов.</p>
      </div>
      <div className="section">
        <h3>Методика</h3>
        <p className="hint">МСЭ-R P.525, P.526 (препятствие-нож), P.530 (многолучёвость, дождь), P.838, P.676; геодезия — WGS-84 (Винсенти). Шрифт отчётов — Liberation Sans (SIL OFL 1.1).</p>
      </div>
    </Modal>
  );
}
