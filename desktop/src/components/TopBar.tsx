/** Top bar: brand, place search, base map, network state, file and settings menus. */
import { useCallback, useState } from 'react';
import { Brand } from '../brand/Logo';
import { TILE_PROVIDERS } from '../config';
import { parseLatLon, searchPlaces, type Place } from '../net/geocode';
import { useNetState } from '../net/online';
import { useStore, type Theme } from '../state/store';
import { Icon, useDismiss } from './ui';

export type FileAction =
  | 'export-project' | 'import' | 'export-csv' | 'import-csv' | 'report-project' | 'backup' | 'about' | 'clear-tiles' | 'update';

interface Props {
  onPlace(p: Place): void;
  onAction(a: FileAction): void;
  guideOpen: boolean;
  onGuide(): void;
  /** Build number of a newer release found on GitHub (null = none found). */
  updateAvailable?: number | null;
}

export function TopBar({ onPlace, onAction, guideOpen, onGuide, updateAvailable }: Props) {
  const { settings, setSetting, project } = useStore();
  const net = useNetState();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<'file' | 'view' | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeSearch = useCallback(() => { setFound(null); setMsg(null); }, []);
  const fileRef = useDismiss(menu === 'file', closeMenu);
  const viewRef = useDismiss(menu === 'view', closeMenu);
  const searchRef = useDismiss(found !== null || msg !== null, closeSearch);

  const run = async () => {
    if (!q.trim()) return;
    // Coordinates: straight to the map with a marker, no list to click through.
    const c = parseLatLon(q.trim());
    if (c) { setFound(null); setMsg(null); onPlace(c); return; }
    setBusy(true); setMsg(null); setFound(null);
    try {
      const r = await searchPlaces(q.trim());
      if (!r.length) setMsg('Ничего не найдено. Попробуйте уточнить запрос или ввести координаты.');
      else setFound(r);
    } catch (e) {
      setMsg((e as Error).message + ' Поиск по координатам работает и без сети: например, 56.5486, 84.0703.');
    } finally { setBusy(false); }
  };
  const act = (a: FileAction) => { closeMenu(); onAction(a); };
  const themes: [Theme, string][] = [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']];

  return (
    <header className="topbar">
      <Brand />
      <div className="search" ref={searchRef}>
        <Icon name="search" />
        <input
          className="input" placeholder="Поиск места или координаты" aria-label="Поиск места или координат" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
        />
        {busy || found || msg ? (
          <div className="results">
            {busy ? <div className="msg">Ищу…</div> : null}
            {msg ? <div className="msg">{msg}</div> : null}
            {found?.map((p, i) => (
              <button key={i} type="button" onClick={() => { onPlace(p); setFound(null); }}>
                {p.name}<small>{p.detail}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grow" />
      <span className={`net ${net}`} title="Карта и поиск работают через интернет. Расчёты, данные и отчёты — без него.">
        {net === 'online' ? 'В сети' : net === 'offline' ? 'Нет сети' : 'Сеть нестабильна'}
      </span>
      <select className="select" style={{ width: 190 }} aria-label="Подложка карты" value={settings.providerId} onChange={(e) => setSetting('providerId', e.target.value)}>
        {TILE_PROVIDERS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <div className="menu-wrap" ref={fileRef}>
        <button type="button" className="btn" aria-expanded={menu === 'file'} onClick={() => setMenu(menu === 'file' ? null : 'file')}><Icon name="file" />Файл</button>
        {menu === 'file' ? (
          <div className="menu" role="menu">
            <div className="label">Проект{project ? ` «${project.name}»` : ''}</div>
            <button role="menuitem" type="button" disabled={!project} onClick={() => act('report-project')}><Icon name="pdf" />Отчёт PDF по всем пролётам</button>
            <button role="menuitem" type="button" disabled={!project} onClick={() => act('export-project')}><Icon name="download" />Экспорт проекта<small>.json</small></button>
            <button role="menuitem" type="button" disabled={!project} onClick={() => act('export-csv')}><Icon name="download" />Экспорт объектов<small>.csv</small></button>
            <button role="menuitem" type="button" disabled={!project} onClick={() => act('import-csv')}><Icon name="upload" />Импорт объектов<small>.csv</small></button>
            <hr />
            <div className="label">Все данные</div>
            <button role="menuitem" type="button" onClick={() => act('import')}><Icon name="upload" />Импорт проекта или копии<small>.json</small></button>
            <button role="menuitem" type="button" onClick={() => act('backup')}><Icon name="download" />Резервная копия всех данных<small>.json</small></button>
          </div>
        ) : null}
      </div>
      {updateAvailable ? <button type="button" className="btn sm primary" data-tip={`Доступна сборка №${updateAvailable}`} onClick={() => onAction('update')}><Icon name="refresh" />Обновить</button> : null}
      <button type="button" className={`btn ghost help-btn ${guideOpen ? 'on' : ''} ${!settings.guideDone ? 'fresh' : ''} ${guideOpen ? '' : 'has-tip'}`} data-tip={guideOpen ? undefined : "Первые шаги: как начать работу"} aria-label="Первые шаги — гид по программе" aria-pressed={guideOpen} onClick={onGuide}>?</button>
      <div className="menu-wrap" ref={viewRef}>
        <button type="button" className="btn ghost" aria-label="Настройки" aria-expanded={menu === 'view'} onClick={() => setMenu(menu === 'view' ? null : 'view')}><Icon name="moon" /></button>
        {menu === 'view' ? (
          <div className="menu" role="menu">
            <div className="label">Тема</div>
            {themes.map(([k, t]) => (
              <button key={k} role="menuitemradio" aria-checked={settings.theme === k} type="button" onClick={() => { setSetting('theme', k); closeMenu(); }}>
                {t}{settings.theme === k ? <small>✓</small> : null}
              </button>
            ))}
            <hr />
            <button role="menuitem" type="button" onClick={() => act('update')}><Icon name="refresh" />Обновить приложение</button>
            <button role="menuitem" type="button" onClick={() => act('clear-tiles')}>Очистить кэш карты</button>
            <button role="menuitem" type="button" onClick={() => act('about')}><Icon name="info" />О программе и данных</button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
