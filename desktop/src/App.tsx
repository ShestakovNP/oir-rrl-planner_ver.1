/** Main window: wires the map, lists, detail panels, file actions and dialogs together. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { MapView, type FocusRequest, type MapLink, type MapMode } from './map/MapView';
import { TopBar, type FileAction } from './components/TopBar';
import { Sidebar, type ListTab, type Selection } from './components/Sidebar';
import { LinkPanel } from './components/LinkPanel';
import { SitePanel } from './components/SitePanel';
import { AntennaPanel, RadioPanel } from './components/EquipmentPanel';
import { AboutDialog, AddSiteDialog, NewLinkDialog } from './components/Dialogs';
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

type Modal = { kind: 'add-site'; lat?: number; lon?: number } | { kind: 'new-link'; a?: string } | { kind: 'about' } | null;

export function App() {
  const store = useStore();
  const { project, sites, links, results, library, settings } = store;
  const net = useNetState();
  const [tab, setTab] = useState<ListTab>('links');
  const [sel, setSel] = useState<Selection>(null);
  const [mode, setMode] = useState<MapMode>('view');
  const [pending, setPending] = useState<string | null>(null);
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
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && mode !== 'view') { setMode('view'); setPending(null); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode]);

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
        notify(`Импортировано: проектов ${res.projects}, площадок ${res.sites}, пролётов ${res.links}. Выберите проект в списке слева.`);
        return;
      }
      if (!project) return;
      if (a === 'export-project') {
        const b = await makeProjectBundle(store.repo, project);
        const w = await saveFile(safeFileName(project.name) + '.json', JSON.stringify(b, null, 1), [{ name: 'Проект', extensions: ['json'] }]);
        if (w) notify('Проект сохранён в файл.');
      } else if (a === 'export-csv') {
        const w = await saveFile(safeFileName(project.name) + ' — площадки.csv', sitesToCsv(sites), [{ name: 'CSV', extensions: ['csv'] }]);
        if (w) notify(`Площадки выгружены: ${sites.length}.`);
      } else if (a === 'import-csv') {
        const f = await openTextFile([{ name: 'CSV', extensions: ['csv', 'txt'] }]);
        if (!f) return;
        const { sites: rows, skipped } = parseSitesCsv(f.text);
        for (const r of rows) await store.addSite({ name: r.name, code: r.code, lat: r.lat, lon: r.lon, groundM: r.groundM, notes: r.notes });
        if (rows.length) focusOn(rows.map((r) => [r.lat, r.lon]));
        notify(`Добавлено площадок: ${rows.length}.${skipped.length ? ` Пропущены строки: ${skipped.slice(0, 6).join(', ')}.` : ''}`, !rows.length);
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
          onDelete={() => confirmDelete('Удалить площадку?', n ? `Вместе с площадкой «${s.name}» удалятся пролёты: ${n}.` : `Площадка «${s.name}» будет удалена.`, async () => { await store.deleteSite(s.id); setSel(null); })}
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
          onNewProject={() => setDialog({ title: 'Новый проект', input: { label: 'Название проекта', value: '' }, confirm: 'Создать', onConfirm: (v) => { void store.createProject(v!).then(() => notify('Проект создан.')).catch(fail); } })}
          onRenameProject={() => project && setDialog({ title: 'Переименовать проект', input: { label: 'Название проекта', value: project.name }, confirm: 'Сохранить', onConfirm: (v) => { void store.updateProject({ ...project, name: v! }); } })}
          onDeleteProject={() => project && confirmDelete('Удалить проект?', `Проект «${project.name}» удалится вместе со всеми площадками (${sites.length}) и пролётами (${links.length}). Перед удалением можно сохранить его через «Файл» → «Экспорт проекта».`, async () => { await store.deleteProject(project.id); notify('Проект удалён.'); })}
          onAddRadio={() => { const r = { id: uid(), name: 'Новое ППУ', band: '', modes: [], notes: '' }; store.saveLibrary({ ...library, radios: [...library.radios, r] }); setSel({ kind: 'radio', id: r.id }); }}
          onAddAntenna={() => { const a = { id: uid(), name: 'Новая антенна', diameterM: 0.6, xpdDb: null, gains: [], notes: '' }; store.saveLibrary({ ...library, antennas: [...library.antennas, a] }); setSel({ kind: 'antenna', id: a.id }); }}
        />
        <div className="map-area">
          <MapView
            providerId={settings.providerId} sites={sites} links={mapLinks} selectedSiteId={selSiteId} selectedLinkId={selLinkId}
            pendingLinkSiteId={pending} mode={mode} focus={focus} initialView={settings.mapView}
            onMapClick={(la, lo) => void onMapClick(la, lo)} onSiteClick={onSiteClick}
            onSiteMoved={(id, la, lo) => { const s = sites.find((x) => x.id === id); if (s) { store.updateSite({ ...s, lat: la, lon: lo }); notify('Координаты площадки обновлены. Если у пролётов профиль SRTM, загрузите его заново.'); } }}
            onLinkClick={(id) => { setTab('links'); setSel({ kind: 'link', id }); }}
            onView={(center, zoom) => store.setSetting('mapView', { center, zoom })}
          />
          <div className="map-toolbar">
            {mode !== 'view' ? (
              <div className="floating mode-banner" role="status">
                {mode === 'add-site' ? 'Кликните по карте, чтобы поставить площадку' : pending ? `Выбрана «${sites.find((s) => s.id === pending)?.name}». Кликните вторую площадку` : 'Кликните первую площадку пролёта'}
                <span className="hint">Esc — отмена</span>
                <button type="button" className="btn sm" onClick={() => { setMode('view'); setPending(null); }}><Icon name="close" />Отмена</button>
              </div>
            ) : null}
          </div>
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
      <Toasts items={toasts} />
    </div>
  );
}
