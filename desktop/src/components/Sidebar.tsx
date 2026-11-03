/** Left column: project switcher and the lists of sites, links and equipment. */
import { useCallback, useState } from 'react';
import { useStore } from '../state/store';
import { fmt, ghz } from '../data/calc/format';
import { FREQ_UNITS, GAIN_UNITS, LENGTH_UNITS, findUnit } from '../data/units';
import { Icon, useDismiss } from './ui';
import { ProjectPicker } from './ProjectPicker';

export type ListTab = 'sites' | 'links' | 'equipment';
export type Selection =
  | { kind: 'site'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'radio'; id: string }
  | { kind: 'antenna'; id: string }
  | null;

interface Props {
  tab: ListTab;
  setTab(t: ListTab): void;
  selection: Selection;
  select(s: Selection): void;
  onAddSiteMap(): void;
  onAddSiteCoords(): void;
  onAddLink(): void;
  onNewProject(): void;
  onExportProject(): void;
  onImportProject(): void;
  onRenameProject(): void;
  onDeleteProject(): void;
  onCleanupProjects(): void;
  onDeleteProjectById(id: string): Promise<void>;
  onDeleteSite(id: string): Promise<void>;
  onDeleteLink(id: string): Promise<void>;
  onAddRadio(): void;
  onAddAntenna(): void;
}

export function Sidebar(p: Props) {
  const { projects, project, sites, links, results, library, saveLibrary } = useStore();
  const delRadio = (id: string) => { saveLibrary({ ...library, radios: library.radios.filter((x) => x.id !== id) }); if (p.selection?.kind === 'radio' && p.selection.id === id) p.select(null); };
  const delAntenna = (id: string) => { saveLibrary({ ...library, antennas: library.antennas.filter((x) => x.id !== id) }); if (p.selection?.kind === 'antenna' && p.selection.id === id) p.select(null); };
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<'project' | 'site' | null>(null);
  const [askDel, setAskDel] = useState<string | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const projRef = useDismiss(menu === 'project', close);
  const siteRef = useDismiss(menu === 'site', close);
  const ql = q.trim().toLowerCase();
  const name = (id: string) => sites.find((s) => s.id === id)?.name ?? '?';
  const fSites = sites.filter((s) => !ql || s.name.toLowerCase().includes(ql) || s.code.toLowerCase().includes(ql)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const fLinks = links.filter((l) => !ql || `${name(l.siteA)} ${name(l.siteB)}`.toLowerCase().includes(ql));

  return (
    <nav className="sidebar" aria-label="Проект">
      <div className="project">
        <span className="sub">Проект</span>
        <div className="project-row">
          <ProjectPicker onNewProject={p.onNewProject} onCleanup={p.onCleanupProjects} onDeleteOne={p.onDeleteProjectById} />
          <div className="menu-wrap" ref={projRef}>
            <button type="button" className={`btn sm primary ${menu === 'project' ? '' : 'has-tip'}`} data-tip={menu === "project" ? undefined : "Создать проект"} aria-label="Создать проект и другие действия с проектами" aria-expanded={menu === 'project'} onClick={() => setMenu(menu === 'project' ? null : 'project')}><Icon name="menu" /></button>
            {menu === 'project' ? (
              <div className="menu" role="menu">
                <button role="menuitem" type="button" onClick={() => { close(); p.onNewProject(); }}><Icon name="plus" />Новый проект</button>
                <button role="menuitem" type="button" disabled={!project} onClick={() => { close(); p.onRenameProject(); }}><Icon name="edit" />Переименовать</button>
                <hr />
                <button role="menuitem" type="button" disabled={!project} onClick={() => { close(); p.onDeleteProject(); }}><Icon name="trash" />Удалить проект</button>
                <button role="menuitem" type="button" disabled={!projects.length} onClick={() => { close(); p.onCleanupProjects(); }}><Icon name="trash" />Очистить список проектов…</button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="exchange-row">
          <button type="button" className="btn sm has-tip" data-tip="Сохранить проект в файл, чтобы отправить коллеге" disabled={!project} onClick={p.onExportProject}><Icon name="download" />Экспорт проекта</button>
          <button type="button" className="btn sm has-tip" data-tip="Открыть проект из файла, в том числе вернувшийся от коллеги" onClick={p.onImportProject}><Icon name="upload" />Импорт проекта</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" data-guide="tab-sites" type="button" aria-selected={p.tab === 'sites'} onClick={() => p.setTab('sites')}>Объекты <span className="count">{sites.length}</span></button>
        <button role="tab" data-guide="tab-links" type="button" aria-selected={p.tab === 'links'} onClick={() => p.setTab('links')}>Пролёты <span className="count">{links.length}</span></button>
        <button role="tab" type="button" aria-selected={p.tab === 'equipment'} onClick={() => p.setTab('equipment')}>Справочник</button>
      </div>
      {p.tab !== 'equipment' ? (
        <div className="list-tools">
          <input className="input" placeholder={p.tab === 'sites' ? 'Найти объект' : 'Найти пролёт'} aria-label="Фильтр списка" value={q} onChange={(e) => setQ(e.target.value)} />
          {p.tab === 'sites' ? (
            <div className="menu-wrap" ref={siteRef}>
              <button type="button" data-guide="add-site" className="btn primary" disabled={!project} onClick={() => setMenu(menu === 'site' ? null : 'site')} aria-expanded={menu === 'site'}><Icon name="plus" />Объект</button>
              {menu === 'site' ? (
                <div className="menu" role="menu">
                  <button role="menuitem" type="button" onClick={() => { close(); p.onAddSiteMap(); }}><Icon name="pin" />Поставить на карте</button>
                  <button role="menuitem" type="button" onClick={() => { close(); p.onAddSiteCoords(); }}><Icon name="edit" />Ввести координаты</button>
                </div>
              ) : null}
            </div>
          ) : (
            <button type="button" data-guide="add-link" className="btn primary" disabled={sites.length < 2} onClick={p.onAddLink}><Icon name="plus" />Пролёт</button>
          )}
        </div>
      ) : null}
      <div className="list">
        {!project && p.tab !== 'equipment' ? (
          <div className="empty"><b>Нет проекта</b><span>Создайте проект, чтобы добавлять объекты и пролёты.</span><button type="button" className="btn primary" onClick={p.onNewProject}>Создать проект</button></div>
        ) : p.tab === 'sites' ? (
          fSites.length ? fSites.map((s) => {
            const nLinks = links.filter((l) => l.siteA === s.id || l.siteB === s.id).length;
            if (askDel === s.id)
              return (
                <div key={s.id} className="item-ask" role="alert">
                  <div>Удалить объект «{s.name || 'Без названия'}»?{nLinks ? <small> Вместе с ним удалятся пролёты: {nLinks}.</small> : null}</div>
                  <div className="item-ask-btns">
                    <button type="button" className="btn sm danger-fill" autoFocus onClick={() => { setAskDel(null); void p.onDeleteSite(s.id); }}>Удалить</button>
                    <button type="button" className="btn sm" onClick={() => setAskDel(null)}>Нет</button>
                  </div>
                </div>
              );
            return (
              <div key={s.id} className="item-wrap">
                <button type="button" className="item" aria-current={p.selection?.kind === 'site' && p.selection.id === s.id} onClick={() => p.select({ kind: 'site', id: s.id })}>
                  <span className="dot site" />
                  <span className="t">{s.name || 'Без названия'}</span>
                  <span className="r">{s.code}</span>
                  <span className="s">{fmt(s.lat, 5)}, {fmt(s.lon, 5)}</span>
                </button>
                <button type="button" className="item-del" title="Удалить объект" aria-label={`Удалить объект ${s.name}`} onClick={() => setAskDel(s.id)}><Icon name="trash" /></button>
              </div>
            );
          }) : <div className="empty"><b>{q ? 'Ничего не найдено' : 'Объектов пока нет'}</b>{q ? null : <span>Нажмите «Объект» и кликните по карте или введите координаты. Объекты можно загрузить из CSV через меню «Файл».</span>}</div>
        ) : p.tab === 'links' ? (
          fLinks.length ? fLinks.map((l) => {
            const r = results.get(l.id);
            const ch = l.channels.filter((c, i) => i === 0 || c.enabled).map((c) => ghz(c.freqMHz)).join(' + ');
            if (askDel === l.id)
              return (
                <div key={l.id} className="item-ask" role="alert">
                  <div>Удалить пролёт «{name(l.siteA)} — {name(l.siteB)}»?<small> Объекты останутся, удалятся профиль и настройки пролёта.</small></div>
                  <div className="item-ask-btns">
                    <button type="button" className="btn sm danger-fill" autoFocus onClick={() => { setAskDel(null); void p.onDeleteLink(l.id); }}>Удалить</button>
                    <button type="button" className="btn sm" onClick={() => setAskDel(null)}>Нет</button>
                  </div>
                </div>
              );
            return (
              <div key={l.id} className="item-wrap">
                <button type="button" className="item" aria-current={p.selection?.kind === 'link' && p.selection.id === l.id} onClick={() => p.select({ kind: 'link', id: l.id })}>
                  <span className={`dot ${r?.verdict.level ?? ''}`} />
                  <span className="t">{name(l.siteA)} — {name(l.siteB)}</span>
                  <span className="r">{r ? fmt(r.path.D, 2) + ' км' : ''}</span>
                  <span className="s">{ch}{r ? ` · ${r.totalRate > 0 ? fmt(r.totalRate, 1) + ' Мбит/с в норме' : r.verdict.label}` : ''}</span>
                </button>
                <button type="button" className="item-del" title="Удалить пролёт" aria-label={`Удалить пролёт ${name(l.siteA)} — ${name(l.siteB)}`} onClick={() => setAskDel(l.id)}><Icon name="trash" /></button>
              </div>
            );
          }) : <div className="empty"><b>{q ? 'Ничего не найдено' : 'Пролётов пока нет'}</b>{q ? null : <span>Нажмите «Пролёт» и выберите два объекта — в списке или прямо на карте.</span>}</div>
        ) : (
          <>
            <div className="list-tools" style={{ padding: '10px 6px 4px', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><span className="sub">ППУ</span><div className="hint" style={{ fontSize: 11.5 }}>приёмо-передающие устройства</div></div>
              <button type="button" className="btn sm" onClick={p.onAddRadio}><Icon name="plus" />Добавить</button>
            </div>
            {library.radios.length ? null : <div className="empty small"><span>Справочник ППУ пуст. Нажмите «Добавить» и внесите данные из паспорта или сохраните ППУ из проекта коллеги.</span></div>}
            {library.radios.map((r) => askDel === r.id ? (
              <div key={r.id} className="item-ask" role="alert">
                <div>Удалить ППУ «{r.name || 'Без названия'}» из справочника?<small> Уже настроенные пролёты не изменятся.</small></div>
                <div className="item-ask-btns">
                  <button type="button" className="btn sm danger-fill" autoFocus onClick={() => { setAskDel(null); delRadio(r.id); }}>Удалить</button>
                  <button type="button" className="btn sm" onClick={() => setAskDel(null)}>Нет</button>
                </div>
              </div>
            ) : (
              <div key={r.id} className="item-wrap">
                <button type="button" className="item" aria-current={p.selection?.kind === 'radio' && p.selection.id === r.id} onClick={() => p.select({ kind: 'radio', id: r.id })}>
                  <Icon name="radio" />
                  <span className="t">{r.name || 'Без названия'}</span>
                  <span className="r">{r.band}</span>
                  <span className="s">{r.modes.map((m) => m.name).join(', ') || 'нет типов модуляции'}</span>
                </button>
                <button type="button" className="item-del" title="Удалить ППУ" aria-label={`Удалить ППУ ${r.name}`} onClick={() => setAskDel(r.id)}><Icon name="trash" /></button>
              </div>
            ))}
            <div className="list-tools" style={{ padding: '16px 6px 4px', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="sub">Антенны</span>
              <button type="button" className="btn sm" onClick={p.onAddAntenna}><Icon name="plus" />Добавить</button>
            </div>
            {library.antennas.length ? null : <div className="empty small"><span>Антенн нет. Нажмите «Добавить».</span></div>}
            {library.antennas.map((a) => askDel === a.id ? (
              <div key={a.id} className="item-ask" role="alert">
                <div>Удалить антенну «{a.name || 'Без названия'}» из справочника?<small> Уже настроенные пролёты не изменятся.</small></div>
                <div className="item-ask-btns">
                  <button type="button" className="btn sm danger-fill" autoFocus onClick={() => { setAskDel(null); delAntenna(a.id); }}>Удалить</button>
                  <button type="button" className="btn sm" onClick={() => setAskDel(null)}>Нет</button>
                </div>
              </div>
            ) : (
              <div key={a.id} className="item-wrap">
              <button type="button" className="item" aria-current={p.selection?.kind === 'antenna' && p.selection.id === a.id} onClick={() => p.select({ kind: 'antenna', id: a.id })}>
                <Icon name="dish" />
                <span className="t">{a.name || 'Без названия'}</span>
                <span className="r">{(() => { const u = findUnit(LENGTH_UNITS, a.diameterUnit); return `${+u.fromBase(a.diameterM).toFixed(3)} ${u.label}`.replace('.', ','); })()}</span>
                <span className="s">{a.gains.length ? `КУ: ${a.gains.map((g) => { const gu = findUnit(GAIN_UNITS, g.gainUnit), fu = findUnit(FREQ_UNITS, g.freqUnit); return `${fmt(gu.fromBase(g.gainDbi), 1)} ${gu.label} на ${+fu.fromBase(g.freqGHz).toFixed(3)} ${fu.label}`.replace(/(\d)\.(\d)/g, '$1,$2'); }).join(', ')}` : 'КУ рассчитывается из диаметра'}</span>
              </button>
              <button type="button" className="item-del" title="Удалить антенну" aria-label={`Удалить антенну ${a.name}`} onClick={() => setAskDel(a.id)}><Icon name="trash" /></button>
              </div>
            ))}
          </>
        )}
      </div>
    </nav>
  );
}
