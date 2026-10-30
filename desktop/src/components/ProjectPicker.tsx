/** Project switcher: a drop-down list under the field, favourites on top (up to 5), search, quick actions. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../state/store';
import type { Project } from '../data/types';
import { Icon, useDismiss } from './ui';

export const MAX_FAVORITES = 5;

const date = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

export function ProjectPicker({ onNewProject, onCleanup, onDeleteOne }: { onNewProject(): void; onCleanup(): void; onDeleteOne(id: string): Promise<void> }) {
  const { projects, project, selectProject, settings, setSetting } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [askDel, setAskDel] = useState<string | null>(null);
  const close = useCallback(() => { setOpen(false); setQ(''); setAskDel(null); }, []);
  const ref = useDismiss(open, close);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const favIds = (settings.favoriteProjects ?? []).filter((id) => projects.some((p) => p.id === id));
  const isFav = (id: string) => favIds.includes(id);
  const ql = q.trim().toLowerCase();
  const match = (p: Project) => !ql || p.name.toLowerCase().includes(ql);
  const favs = useMemo(() => favIds.map((id) => projects.find((p) => p.id === id)!).filter(match), [favIds.join(), projects, ql]);
  const rest = useMemo(() => projects.filter((p) => !isFav(p.id) && match(p)).sort((a, b) => b.updatedAt - a.updatedAt), [favIds.join(), projects, ql]);
  const flat = [...favs, ...rest];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, flat.findIndex((p) => p.id === project?.id)));
    setTimeout(() => search.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open) setActive(0); }, [ql]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggleFav = (id: string) => {
    if (isFav(id)) setSetting('favoriteProjects', favIds.filter((x) => x !== id));
    else if (favIds.length < MAX_FAVORITES) setSetting('favoriteProjects', [...favIds, id]);
  };
  const pick = (id: string) => { close(); if (id !== project?.id) void selectProject(id); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Escape' && askDel) { e.stopPropagation(); setAskDel(null); }
    else if (e.key === 'Enter' && flat[active] && !askDel) { e.preventDefault(); pick(flat[active].id); }
  };

  const row = (p: Project, i: number) => {
    const fav = isFav(p.id), cur = p.id === project?.id;
    const full = !fav && favIds.length >= MAX_FAVORITES;
    if (askDel === p.id)
      return (
        <div key={p.id} data-i={i} className="pp-row pp-ask" onClick={(e) => e.stopPropagation()}>
          <span className="pp-ask-t">Удалить «{p.name || 'Без названия'}» вместе с объектами и пролётами?</span>
          <button type="button" className="btn sm danger-fill" autoFocus onClick={() => { setAskDel(null); void onDeleteOne(p.id); }}>Удалить</button>
          <button type="button" className="btn sm" onClick={() => setAskDel(null)}>Нет</button>
        </div>
      );
    return (
      <div key={p.id} data-i={i} role="option" aria-selected={cur} className={`pp-row ${cur ? 'cur' : ''} ${i === active ? 'act' : ''}`}
        onMouseEnter={() => setActive(i)} onClick={() => pick(p.id)}>
        <span className="pp-check">{cur ? <Icon name="check" /> : null}</span>
        <span className="pp-name" title={p.name}>{p.name || 'Без названия'}</span>
        <span className="pp-date">{date(p.updatedAt)}</span>
        <button type="button" className={`pp-star ${fav ? 'on' : ''}`} disabled={full}
          title={fav ? 'Убрать из избранного' : full ? `В избранном уже ${MAX_FAVORITES} проектов — сначала уберите один` : 'Закрепить в избранном'}
          aria-label={fav ? 'Убрать из избранного' : 'Закрепить в избранном'} aria-pressed={fav}
          onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }}>
          <Icon name="star" />
        </button>
        <button type="button" className="pp-del" title="Удалить этот проект" aria-label={`Удалить проект ${p.name}`}
          onClick={(e) => { e.stopPropagation(); setAskDel(p.id); }}>
          <Icon name="trash" />
        </button>
      </div>
    );
  };

  return (
    <div className="pp" ref={ref}>
      <button type="button" className={`pp-field ${open ? 'open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label="Текущий проект"
        onClick={() => (open ? close() : setOpen(true))} onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); } }}>
        {project && isFav(project.id) ? <Icon name="star" className="icon pp-field-star" /> : null}
        <span className="pp-field-name">{project?.name ?? (projects.length ? 'Выберите проект' : 'Нет проектов')}</span>
        <Icon name="chevron" className="icon pp-chev" />
      </button>
      {open ? (
        <div className="pp-drop" onKeyDown={onKey}>
          {projects.length > 5 ? (
            <div className="pp-search"><Icon name="search" /><input ref={search} className="input" placeholder="Найти проект" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск проекта" /></div>
          ) : <input ref={search} className="pp-hidden-focus" aria-hidden="true" tabIndex={-1} readOnly />}
          <div className="pp-list" role="listbox" ref={listRef}>
            {favs.length ? <div className="pp-label">Избранные <span>{favIds.length} из {MAX_FAVORITES}</span></div> : null}
            {favs.map((p, i) => row(p, i))}
            {rest.length ? <div className="pp-label">{favs.length ? 'Остальные' : 'Проекты'}{!favs.length && projects.length > 1 ? <span>☆ — закрепить</span> : null}</div> : null}
            {rest.map((p, i) => row(p, favs.length + i))}
            {!flat.length ? <div className="pp-empty">{projects.length ? 'Ничего не найдено' : 'Проектов пока нет'}</div> : null}
          </div>
          <div className="pp-foot">
            <button type="button" onClick={() => { close(); onNewProject(); }}><Icon name="plus" />Новый проект</button>
            <button type="button" disabled={!projects.length} onClick={() => { close(); onCleanup(); }}><Icon name="trash" />Очистить список проектов…</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
