/** Main window: wires the map, lists, detail panels, file actions and dialogs together. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { vincenty } from './data/calc/geo';
import { MapView, type FocusRequest, type MapLink, type MapMode } from './map/MapView';
import { TopBar, type FileAction } from './components/TopBar';
import { Guide } from './components/Guide';
import { Sidebar, type ListTab, type Selection } from './components/Sidebar';
import { LinkPanel } from './components/LinkPanel';
import { SitePanel } from './components/SitePanel';
import { AntennaPanel, RadioPanel } from './components/EquipmentPanel';
import { AboutDialog, AddSiteDialog, NewLinkDialog, ProjectsCleanupDialog } from './components/Dialogs';
import { Dialog, Icon, Toasts, type DialogSpec, type Toast } from './components/ui';
import { fmt } from './data/calc/format';
import { uid } from './data/ids';
import type { Link } from './data/types';
import { fetchTerrainProfile } from './net/elevation';
import { applyClutter, fetchClutterObjects } from './net/clutter';
import { useNetState } from './net/online';
import { buildReport } from './report/report';
import { saveFile, openTextFile, safeFileName } from './storage/files';
import { importBundle, makeBackup, makeProjectBundle, parseSitesCsv, sitesToCsv } from './storage/exchange';
import { clearTileCache } from './map/tileCache';

type Modal = { kind: 'add-site'; lat?: number; lon?: number } | { kind: 'new-link'; a?: string } | { kind: 'about' } | { kind: 'cleanup' } | null;

export function App() {
  const store = useStore();
  const { project, sites, links, results, library, settings } = store;
  const net = useNetState();
  const [tab, setTab] = useState<ListTab>('links');
  const [sel, setSel] = useState<Selection>(null);
  const [mode, setMode] = useState<MapMode>('view');
  const [pending, setPending] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; lat: number; lon: number } | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const focusKey = useRef(0);

  /* theme */
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const notify = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6500 : 3800);
  }, []);
  const fail = useCallback((e: unknown) => notify((e as Error)?.message || 'Не получилось.', true), [notify]);
  const focusOn = (points: [number, number][]) => setFocus({ key: ++focusKey.current, points });

  /* show the whole project on open / project switch */
  useEffect(() => {
    if (sites.length) focusOn(sites.map((s) => [s.lat, s.lon]));
    setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  /* Esc cancels map modes */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (moving) setMoving(null);
      else if (mode !== 'view') { setMode('view'); setPending(null); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode, moving]);

  /* editing a site position on the map */
  const startMove = (id: string) => {
    const s = sites.find((x) => x.id === id);
    if (!s) return;
    setMode('view'); setPending(null);
    setMoving({ id, lat: s.lat, lon: s.lon });
    setTab('sites'); setSel({ kind: 'site', id });
  };
  const saveMove = () => {
    if (!moving) return;
    const s = sites.find((x) => x.id === moving.id);
    setMoving(null);
    if (!s || (Math.abs(s.lat - moving.lat) < 1e-9 && Math.abs(s.lon - moving.lon) < 1e-9)) return;
    const old = { lat: s.lat, lon: s.lon };
    store.updateSite({ ...s, lat: moving.lat, lon: moving.lon });
    const dKm = vincenty(old.lat, old.lon, moving.lat, moving.lon).km;
    const hasLinks = links.some((l) => l.siteA === s.id || l.siteB === s.id);
    notify(`«${s.name}» перенесён на ${dKm < 1 ? fmt(dKm * 1000, 0) + ' м' : fmt(dKm, 2) + ' км'}. ${hasLinks ? 'Профили пролётов этого объекта загрузите заново (вкладка «Профиль»).' : ''}`);
  };

  const mapLinks: MapLink[] = useMemo(() => {
    const byId = new Map(sites.map((s) => [s.id, s]));
    return links.flatMap((l) => {
      const a = byId.get(l.siteA), b = byId.get(l.siteB);
      if (!a || !b) return [];
      const r = results.get(l.id);
      return [{ id: l.id, a, b, level: r?.verdict.level ?? 'none', label: `${a.name} — ${b.name}${r ? ` · ${fmt(r.path.D, 2)} км · ${r.verdict.label}` : ''}`, critT: r?.geom.crit ? r.geom.crit.d / r.path.D : null }];
    });
  }, [links, sites, results]);

  /* ---------- actions ---------- */
  const autoProfile = useCallback(async (l: Link) => {
    const a = sites.find((s) => s.id === l.siteA), b = sites.find((s) => s.id === l.siteB);
    if (!a || !b || net === 'offline') return;
    try {
      const pts = await fetchTerrainProfile(a.lat, a.lon, b.lat, b.lon);
      let upd: Link = { ...l, profile: pts, profileSource: 'srtm', profileFetchedAt: Date.now() };
      store.updateLink(upd);
      if (a.groundM == null) store.updateSite({ ...a, groundM: pts[0].g });
      if (b.groundM == null) store.updateSite({ ...b, groundM: pts[pts.length - 1].g });
      try {
        const forestHeight = l.forestHeight ?? 20;
        const objs = await fetchClutterObjects(a.lat, a.lon, b.lat, b.lon, { forestHeight });
        const res = applyClutter(pts, a.lat, a.lon, b.lat, b.lon, objs, { forestHeight });
        upd = { ...upd, profile: res.profile, clutterSource: 'osm', clutterFetchedAt: Date.now(), clutterSummary: res.summary };
        store.updateLink(upd);
        notify(`Рельеф загружен по SRTM. ${res.summary}`);
      } catch (e) {
        notify(`Рельеф загружен, но здания и лес не получены: ${(e as Error).message} Их можно загрузить позже во вкладке «Профиль».`, true);
      }
    } catch (e) {
      notify(`Профиль не загружен: ${(e as Error).message} Его можно загрузить позже во вкладке «Профиль» или ввести вручную.`, true);
    }
  }, [sites, net, store, notify]);

  const createLink = async (a: string, b: string) => {
    try {
      const l = await store.addLink(a, b);
      setModal(null); setMode('view'); setPending(null);
      setTab('links');
      setSel({ kind: 'link', id: l.id });
      void autoProfile(l);
    } catch (e) { fail(e); }
  };

  const onMapClick = async (lat: number, lon: number) => {
    if (moving) { setMoving({ ...moving, lat, lon }); return; }
    if (mode === 'add-site') {
      setMode('view');
      setModal({ kind: 'add-site', lat, lon });
    }
  };
  const onSiteClick = (id: string) => {
    if (mode === 'pick-link') {
      if (!pending) { setPending(id); return; }
      if (pending === id) return;
      void createLink(pending, id);
      return;
    }
    setTab('sites');
    setSel({ kind: 'site', id });
  };

  const confirmDelete = (title: string, body: string, run: () => Promise<void>) =>
    setDialog({ title, body, confirm: 'Удалить', danger: true, onConfirm: () => { run().catch(fail); } });

  const reportItems = (ls: Link[]) => ls.flatMap((l) => { const r = results.get(l.id); return r && r.ok ? [{ link: l, result: r }] : []; });

  const saveReport = async (ls: Link[], name: string) => {
    const items = reportItems(ls);
    if (!items.length) return notify('Нет пролётов, которые можно рассчитать.', true);
    try {
      const bytes = buildReport(items, project);
      const where = await saveFile(safeFileName(name) + '.pdf', bytes, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (where) notify(where === 'download' ? 'Отчёт сохранён в загрузки.' : `Отчёт сохранён: ${where}`);
    } catch (e) { fail(e); }
  };

  const onAction = async (a: FileAction) => {
    try {
      if (a === 'about') return setModal({ kind: 'about' });
      if (a === 'guide') return store.setSetting('guideDone', false);
      if (a === 'clear-tiles') return setDialog({ title: 'Очистить кэш карты?', body: 'Загруженные ранее фрагменты карты удалятся. Без интернета карта будет пустой, пока вы снова не посмотрите эти места.', confirm: 'Очистить', danger: true, onConfirm: () => { void clearTileCache().then(() => notify('Кэш карты очищен.')); } });
      if (a === 'backup') {
        const b = await makeBackup(store.repo);
        const d = new Date().toISOString().slice(0, 10);
        const w = await saveFile(`ОИР RRL Planner — копия ${d}.json`, JSON.stringify(b, null, 1), [{ name: 'Резервная копия', extensions: ['json'] }]);
        if (w) notify(`Резервная копия сохранена: ${b.projects.length} проектов, ${b.links.length} пролётов.`);
        return;
      }
      if (a === 'import') {
        const f = await openTextFile([{ name: 'Проект или копия', extensions: ['json'] }]);
        if (!f) return;
        const res = await importBundle(store.repo, JSON.parse(f.text));
        await store.reloadAll();
        notify(`Импортировано: проектов ${res.projects}, объектов ${res.sites}, пролётов ${res.links}. Выберите проект в списке слева.`);
        return;
      }
      if (!project) return;
      if (a === 'export-project') {
        const b = await makeProjectBundle(store.repo, project);
        const w = await saveFile(safeFileName(project.name) + '.json', JSON.stringify(b, null, 1), [{ name: 'Проект', extensions: ['json'] }]);
        if (w) notify('Проект сохранён в файл.');
      } else if (a === 'export-csv') {
        const w = await saveFile(safeFileName(project.name) + ' — объекты.csv', sitesToCsv(sites), [{ name: 'CSV', extensions: ['csv'] }]);
        if (w) notify(`Объекты выгружены: ${sites.length}.`);
      } else if (a === 'import-csv') {
        const f = await openTextFile([{ name: 'CSV', extensions: ['csv', 'txt'] }]);
        if (!f) return;
        const { sites: rows, skipped } = parseSitesCsv(f.text);
        for (const r of rows) await store.addSite({ name: r.name, code: r.code, lat: r.lat, lon: r.lon, groundM: r.groundM, notes: r.notes });
        if (rows.length) focusOn(rows.map((r) => [r.lat, r.lon]));
        notify(`Добавлено объектов: ${rows.length}.${skipped.length ? ` Пропущены строки: ${skipped.slice(0, 6).join(', ')}.` : ''}`, !rows.length);
        setTab('sites');
      } else if (a === 'report-project') {
        await saveReport(links, `Расчёт РРЛ — ${project.name}`);
      }
    } catch (e) { fail(e); }
  };

  /* ---------- selection → panel ---------- */
  let panel: JSX.Element | null = null;
  if (sel?.kind === 'link') {
    const l = links.find((x) => x.id === sel.id);
    if (l) {
      const a = sites.find((s) => s.id === l.siteA), b = sites.find((s) => s.id === l.siteB);
      panel = (
        <LinkPanel
          key={l.id} link={l} result={results.get(l.id)} notify={notify} onClose={() => setSel(null)}
          onFocus={() => a && b && focusOn([[a.lat, a.lon], [b.lat, b.lon]])}
          onReport={() => void saveReport([l], `Расчёт РРЛ ${a?.name ?? ''} — ${b?.name ?? ''}`)}
          onDelete={() => confirmDelete('Удалить пролёт?', `«${a?.name} — ${b?.name}» будет удалён вместе с профилем и настройками.`, async () => { await store.deleteLink(l.id); setSel(null); })}
        />
      );
    }
  } else if (sel?.kind === 'site') {
    const s = sites.find((x) => x.id === sel.id);
    if (s) {
      const n = links.filter((l) => l.siteA === s.id || l.siteB === s.id).length;
      panel = (
        <SitePanel
          key={s.id} site={s} onClose={() => setSel(null)} onFocus={() => focusOn([[s.lat, s.lon]])}
          onOpenLink={(id) => { setTab('links'); setSel({ kind: 'link', id }); }}
          onStartLink={() => setModal({ kind: 'new-link', a: s.id })}
          onMove={() => { startMove(s.id); focusOn([[s.lat, s.lon]]); }}
          onAddSiteMap={() => { setMode('add-site'); setSel(null); }}
          onAddSiteCoords={() => setModal({ kind: 'add-site' })}
          onDelete={() => confirmDelete('Удалить объект?', n ? `Вместе с объектом «${s.name}» удалятся пролёты: ${n}.` : `Объект «${s.name}» будет удалён.`, async () => { await store.deleteSite(s.id); setSel(null); })}
        />
      );
    }
  } else if (sel?.kind === 'radio') {
    const r = library.radios.find((x) => x.id === sel.id);
    if (r) panel = <RadioPanel key={r.id} radio={r} onClose={() => setSel(null)} onDelete={() => confirmDelete('Удалить ППУ из справочника?', 'Уже настроенные пролёты не изменятся.', async () => { store.saveLibrary({ ...library, radios: library.radios.filter((x) => x.id !== r.id) }); setSel(null); })} />;
  } else if (sel?.kind === 'antenna') {
    const an = library.antennas.find((x) => x.id === sel.id);
    if (an) panel = <AntennaPanel key={an.id} ant={an} onClose={() => setSel(null)} onDelete={() => confirmDelete('Удалить антенну из справочника?', 'Уже настроенные пролёты не изменятся.', async () => { store.saveLibrary({ ...library, antennas: library.antennas.filter((x) => x.id !== an.id) }); setSel(null); })} />;
  }

  const newProject = () => setDialog({ title: 'Новый проект', input: { label: 'Название проекта', value: '' }, confirm: 'Создать', onConfirm: (v) => { void store.createProject(v!).then(() => notify('Проект создан.')).catch(fail); } });
  const selSiteId = sel?.kind === 'site' ? sel.id : null;
  const selLinkId = sel?.kind === 'link' ? sel.id : null;

  return (
    <div className="app">
      <TopBar onAction={(a) => void onAction(a)} onPlace={(p) => focusOn([[p.lat, p.lon]])} />
      <div className="main">
        <Sidebar
          tab={tab} setTab={setTab} selection={sel} select={(s) => { setSel(s); if (s?.kind === 'site') { const x = sites.find((y) => y.id === s.id); if (x) focusOn([[x.lat, x.lon]]); } if (s?.kind === 'link') { const l = links.find((y) => y.id === s.id); const a = sites.find((y) => y.id === l?.siteA), b = sites.find((y) => y.id === l?.siteB); if (a && b) focusOn([[a.lat, a.lon], [b.lat, b.lon]]); } }}
          onAddSiteMap={() => { setMode('add-site'); setSel(null); }}
          onAddSiteCoords={() => setModal({ kind: 'add-site' })}
          onAddLink={() => setModal({ kind: 'new-link' })}
          onNewProject={newProject}
          onRenameProject={() => project && setDialog({ title: 'Переименовать проект', input: { label: 'Название проекта', value: project.name }, confirm: 'Сохранить', onConfirm: (v) => { void store.updateProject({ ...project, name: v! }); } })}
          onCleanupProjects={() => setModal({ kind: 'cleanup' })}
          onDeleteSite={async (id) => { const st = sites.find((x) => x.id === id); try { await store.deleteSite(id); if (sel?.kind === 'site' && sel.id === id) setSel(null); notify(`Объект «${st?.name ?? ''}» удалён.`); } catch (e) { fail(e); } }}
          onDeleteProjectById={async (id) => { const pr = store.projects.find((x) => x.id === id); try { await store.deleteProject(id); if (id === project?.id) setSel(null); notify(`Проект «${pr?.name ?? ''}» удалён.`); } catch (e) { fail(e); } }}
          onDeleteProject={() => project && confirmDelete('Удалить проект?', `Проект «${project.name}» удалится вместе со всеми объектами (${sites.length}) и пролётами (${links.length}). Перед удалением можно сохранить его через «Файл» → «Экспорт проекта».`, async () => { await store.deleteProject(project.id); notify('Проект удалён.'); })}
          onAddRadio={() => { const r = { id: uid(), name: 'Новое ППУ', band: '', modes: [], notes: '' }; store.saveLibrary({ ...library, radios: [...library.radios, r] }); setSel({ kind: 'radio', id: r.id }); }}
          onAddAntenna={() => { const a = { id: uid(), name: 'Новая антенна', diameterM: 0.6, xpdDb: null, gains: [], notes: '' }; store.saveLibrary({ ...library, antennas: [...library.antennas, a] }); setSel({ kind: 'antenna', id: a.id }); }}
        />
        <div className="map-area">
          <MapView
            providerId={settings.providerId} sites={sites} links={mapLinks} selectedSiteId={selSiteId} selectedLinkId={selLinkId}
            pendingLinkSiteId={pending} mode={mode} focus={focus} initialView={settings.mapView}
            onMapClick={(la, lo) => void onMapClick(la, lo)} onSiteClick={onSiteClick}
            movingSiteId={moving?.id ?? null} moveDraft={moving ? { lat: moving.lat, lon: moving.lon } : null}
            onStartMove={startMove} onMoveDraft={(la, lo) => setMoving((m) => (m ? { ...m, lat: la, lon: lo } : m))}
            onLinkClick={(id) => { setTab('links'); setSel({ kind: 'link', id }); }}
            onView={(center, zoom) => store.setSetting('mapView', { center, zoom })}
          />
          <div className="map-toolbar">
            {moving ? (() => {
              const s = sites.find((x) => x.id === moving.id);
              const dKm = s ? vincenty(s.lat, s.lon, moving.lat, moving.lon).km : 0;
              return (
                <div className="floating mode-banner move-banner" role="status">
                  <div>
                    <div>Перетащите «{s?.name}» в нужное место или кликните по карте</div>
                    <div className="hint">{moving.lat.toFixed(6)}, {moving.lon.toFixed(6)}{dKm > 0.0005 ? ` · смещение ${dKm < 1 ? fmt(dKm * 1000, 0) + ' м' : fmt(dKm, 2) + ' км'}` : ''} · Esc — отмена</div>
                  </div>
                  <button type="button" className="btn sm primary" onClick={saveMove}>Сохранить</button>
                  <button type="button" className="btn sm" onClick={() => setMoving(null)}><Icon name="close" />Отмена</button>
                </div>
              );
            })() : mode !== 'view' ? (
              <div className="floating mode-banner" role="status">
                {mode === 'add-site' ? 'Кликните по карте, чтобы поставить объект' : pending ? `Выбран «${sites.find((s) => s.id === pending)?.name}». Кликните второй объект` : 'Кликните первый объект пролёта'}
                <span className="hint">Esc — отмена</span>
                <button type="button" className="btn sm" onClick={() => { setMode('view'); setPending(null); }}><Icon name="close" />Отмена</button>
              </div>
            ) : null}
          </div>
          {!settings.guideDone ? (
            <Guide
              linkOpen={sel?.kind === 'link'} sidebarTab={tab}
              onClose={() => store.setSetting('guideDone', true)}
              onNewProject={newProject}
              onAddSiteMap={() => { setTab('sites'); setMode('add-site'); setSel(null); }}
              onAddSiteCoords={() => { setTab('sites'); setModal({ kind: 'add-site' }); }}
              onAddLink={() => { setTab('links'); setModal({ kind: 'new-link', a: sel?.kind === 'site' ? sel.id : undefined }); }}
              onOpenLink={() => { const l = links[0]; if (l) { setTab('links'); setSel({ kind: 'link', id: l.id }); } }}
            />
          ) : null}
          {net !== 'online' ? <div className="floating offline-banner" role="status">{net === 'offline' ? 'Нет интернета. Видны только уже загруженные участки карты; расчёты, данные и отчёты работают.' : 'Сеть работает с перебоями: часть карты может не загрузиться.'}</div> : null}
        </div>
        {panel}
      </div>
      {dialog ? <Dialog spec={dialog} onClose={() => setDialog(null)} /> : null}
      {modal?.kind === 'add-site' ? (
        <AddSiteDialog
          initial={modal.lat != null && modal.lon != null ? { lat: modal.lat, lon: modal.lon } : undefined}
          onClose={() => setModal(null)}
          onCreate={(d) => { void store.addSite({ ...d, notes: '' }).then((s) => { setModal(null); setTab('sites'); setSel({ kind: 'site', id: s.id }); focusOn([[s.lat, s.lon]]); }).catch(fail); }}
        />
      ) : null}
      {modal?.kind === 'new-link' ? (
        <NewLinkDialog initialA={modal.a} onClose={() => setModal(null)} onCreate={(a, b) => void createLink(a, b)} onPickOnMap={() => { setModal(null); setSel(null); setMode('pick-link'); setPending(modal.a ?? null); }} />
      ) : null}
      {modal?.kind === 'about' ? <AboutDialog onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'cleanup' ? <ProjectsCleanupDialog onClose={() => setModal(null)} onDeleteOne={async (id) => { const pr = store.projects.find((x) => x.id === id); try { await store.deleteProject(id); notify(`Проект «${pr?.name ?? ''}» удалён.`); } catch (e) { fail(e); } }} onDelete={async (ids) => { try { await store.deleteProjects(ids); setSel(null); notify(`Удалено проектов: ${ids.length}.`); } catch (e) { fail(e); } }} /> : null}
      <Toasts items={toasts} />
    </div>
  );
}
