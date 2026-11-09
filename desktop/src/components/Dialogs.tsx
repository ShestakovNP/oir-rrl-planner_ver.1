/** Modal forms: new site by coordinates, new link, about / data location. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseCoord } from '../data/calc/geo';
import { useStore } from '../state/store';
import { APP_NAME, APP_VERSION, BUILD_NUMBER, COMPANY, ORG_FULL, TEAM_LEAD, TILE_PROVIDERS } from '../config';
import { OirMark } from '../brand/Logo';
import { tileCacheStats } from '../map/tileCache';
import { Field, Icon, parseNum } from './ui';

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
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = () => {
    const la = parseCoord(lat), lo = parseCoord(lon);
    if (!name.trim()) return setErr('Укажите название объекта.');
    if (!Number.isFinite(la) || Math.abs(la) > 90) return setErr('Широта должна быть от −90 до 90.');
    if (!Number.isFinite(lo) || Math.abs(lo) > 180) return setErr('Долгота должна быть от −180 до 180.');
    onCreate({ name: name.trim(), code: code.trim(), lat: la, lon: lo, groundM: null });
  };
  return (
    <Modal title="Новый объект" onClose={onClose} onSubmit={submit} submit="Добавить">
      <div className="grid2">
        <Field label="Название" htmlFor="ns-name" className="span2"><input id="ns-name" ref={ref} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="например, БС Северная" /></Field>
        <Field label="Широта" htmlFor="ns-lat"><input id="ns-lat" className="input num" value={lat} onChange={(e) => setLat(e.target.value)} placeholder={`56°33'50.19" или 56.5639`} /></Field>
        <Field label="Долгота" htmlFor="ns-lon"><input id="ns-lon" className="input num" value={lon} onChange={(e) => setLon(e.target.value)} placeholder={`84°04'43.34" или 84.0787`} /></Field>
        <Field label="Номер БС / код" htmlFor="ns-code" className="span2"><input id="ns-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="необязательно" /></Field>
      </div>
      {err ? <div className="notice">{err}</div> : null}
    </Modal>
  );
}

export function NewLinkDialog({ onClose, onCreate, onPickOnMap, initialA }: { onClose(): void; onCreate(a: string, b: string): void; onPickOnMap(): void; initialA?: string }) {
  const { sites, links } = useStore();
  const sorted = [...sites].sort((x, y) => x.name.localeCompare(y.name, 'ru'));
  const linked = (x: string, y: string) => links.some((l) => (l.siteA === x && l.siteB === y) || (l.siteA === y && l.siteB === x));
  // Default B: an object not yet linked with A, so a third object pairs with an existing one in one click.
  const firstFree = (x: string) => sorted.find((s) => s.id !== x && !linked(x, s.id))?.id ?? sorted.find((s) => s.id !== x)?.id ?? '';
  const [a, setA] = useState(initialA ?? sorted[0]?.id ?? '');
  const [b, setB] = useState(() => firstFree(initialA ?? sorted[0]?.id ?? ''));
  const [err, setErr] = useState<string | null>(null);
  const changeA = (v: string) => { setA(v); setErr(null); if (v === b || linked(v, b)) setB(firstFree(v)); };
  const submit = () => {
    if (!a || !b || a === b) return setErr('Выберите два разных объекта.');
    if (linked(a, b)) return setErr('Пролёт между этими объектами уже есть — выберите другой объект B.');
    onCreate(a, b);
  };
  return (
    <Modal title="Новый пролёт" onClose={onClose} onSubmit={submit} submit="Создать">
      <div className="grid2">
        <Field label="Объект A" htmlFor="nl-a"><select id="nl-a" className="select" value={a} onChange={(e) => changeA(e.target.value)}>{sorted.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}</select></Field>
        <Field label="Объект B" htmlFor="nl-b"><select id="nl-b" className="select" value={b} onChange={(e) => { setB(e.target.value); setErr(null); }}>{sorted.filter((s) => s.id !== a).map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}{linked(a, s.id) ? ' — пролёт уже есть' : ''}</option>)}</select></Field>
      </div>
      <p>Можно выбрать объекты прямо на карте: <button type="button" className="btn sm" onClick={onPickOnMap}>Выбрать на карте</button></p>
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
      <div className="about-mark"><OirMark size={56} /><div><b>{APP_NAME}</b><div className="hint">{ORG_FULL} · версия {APP_VERSION}{BUILD_NUMBER ? ` · сборка №${BUILD_NUMBER}` : ''}</div></div></div>
      <div className="section about-dev">
        <h3>Разработчик</h3>
        <p>Разработано {ORG_FULL.replace('Отдел', 'Отделом')} (ОИР), {COMPANY}.</p>
        <p>Руководитель группы — {TEAM_LEAD}.</p>
      </div>
      <div className="section">
        <h3>Где хранятся данные</h3>
        <p>Все проекты, объекты, пролёты и справочник хранятся только на этом компьютере, в файле базы данных:</p>
        <p className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{loc}</p>
        <p className="hint">Резервная копия: «Файл» → «Резервная копия всех данных». Восстановить её — «Файл» → «Импорт проекта или копии». Можно также скопировать сам файл базы при закрытой программе.</p>
      </div>
      <div className="section">
        <h3>Интернет</h3>
        <p className="hint">Сеть нужна только для подложек карты, поиска мест и загрузки рельефа. Расчёты, данные и отчёты работают без интернета. Кэш карты: {tiles}.</p>
        <p className="hint">Сервисы: {TILE_PROVIDERS.map((t) => t.name).join(', ')}; поиск — OSM Nominatim; рельеф — OpenTopoData (SRTM 30 м); здания, лес и вода на трассе — OpenStreetMap (Overpass API); деревья — спутниковая карта высот деревьев Meta и WRI и карта растительности ESA WorldCover (открытые данные на AWS, CC BY 4.0); обновления программы — выпуски на GitHub. Других обращений в сеть нет: ни аналитики, ни регистрации, ни собственных серверов.</p>
      </div>
      <div className="section">
        <h3>Методика</h3>
        <p className="hint">МСЭ-R P.525, P.526 (дифракция на препятствиях, метод Дейгу), P.530 (многолучёвость, дождь), P.838, P.676, F.699; ГОСТ Р 53363-2009 (по выбору в «Климат и норма»); геодезия — WGS-84 (Винсенти). Шрифт отчётов — Liberation Sans (SIL OFL 1.1).</p>
      </div>
    </Modal>
  );
}

/** Bulk removal of projects from the list (the project register). */
export function ProjectsCleanupDialog({ onClose, onDelete, onDeleteOne }: { onClose(): void; onDelete(ids: string[]): Promise<void>; onDeleteOne(id: string): Promise<void> }) {
  const { projects, project, settings } = useStore();
  const fav = new Set(settings.favoriteProjects ?? []);
  const sorted = projects.slice().sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)) || b.updatedAt - a.updatedAt);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askOne, setAskOne] = useState<string | null>(null);
  const delOne = async (id: string) => {
    setAskOne(null);
    const n2 = new Set(sel); n2.delete(id); setSel(n2); setConfirm(false);
    await onDeleteOne(id);
  };
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); setConfirm(false); };
  const n = sel.size;
  const word = (k: number) => (k % 10 === 1 && k % 100 !== 11 ? 'проект' : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 10 || k % 100 >= 20) ? 'проекта' : 'проектов');
  const run = async () => {
    if (!n) return;
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try { await onDelete([...sel]); onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal title="Очистить список проектов" onClose={onClose} wide>
      <p className="hint">Удалите проект кнопкой с корзиной в его строке или отметьте несколько и удалите разом. Удаляются проект, его объекты, пролёты и профили; справочник ППУ и антенн не меняется. Перед удалением можно сохранить копию: «Файл» → «Резервная копия всех данных».</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm" onClick={() => { setSel(new Set(sorted.filter((p) => !fav.has(p.id)).map((p) => p.id))); setConfirm(false); }}>Выбрать все, кроме избранных</button>
        <button type="button" className="btn sm" onClick={() => { setSel(new Set(sorted.map((p) => p.id))); setConfirm(false); }}>Выбрать все</button>
        <button type="button" className="btn sm" disabled={!n} onClick={() => { setSel(new Set()); setConfirm(false); }}>Снять выбор</button>
      </div>
      <div className="cleanup-list">
        {sorted.map((p) => (
          <label key={p.id} className={`cleanup-row ${sel.has(p.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
            <span className="nm">{fav.has(p.id) ? <span className="fav" title="Избранный">★</span> : null}{p.name || 'Без названия'}{p.id === project?.id ? <small> · открыт сейчас</small> : null}</span>
            <span className="dt">изменён {new Date(p.updatedAt).toLocaleDateString('ru-RU')}</span>
            {askOne === p.id ? (
              <span className="row-ask" onClick={(e) => e.preventDefault()}>
                <button type="button" className="btn sm danger-fill" onClick={() => void delOne(p.id)}>Удалить</button>
                <button type="button" className="btn sm" onClick={() => setAskOne(null)}>Нет</button>
              </span>
            ) : (
              <button type="button" className="btn sm ghost row-del" title="Удалить только этот проект" onClick={(e) => { e.preventDefault(); setAskOne(p.id); }}><Icon name="trash" /></button>
            )}
          </label>
        ))}
      </div>
      {confirm ? <div className="notice">Удалить {n} {word(n)} без возможности восстановления? Нажмите «Удалить» ещё раз, чтобы подтвердить.</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn danger" disabled={!n || busy} onClick={() => void run()}>
          {busy ? 'Удаляю…' : confirm ? `Да, удалить ${n} ${word(n)}` : n ? `Удалить выбранные (${n})` : 'Удалить выбранные'}
        </button>
      </div>
    </Modal>
  );
}
