/** Main window: wires the map, lists, detail panels, file actions and dialogs together. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { vincenty } from './data/calc/geo';
import { MapView, type FocusRequest, type MapLink, type MapMode } from './map/MapView';
import { TopBar, type FileAction } from './components/TopBar';
import { TooltipLayer } from './components/Tooltip';
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
import { findExisting, importBundle, newLibraryItems, makeBackup, makeProjectBundle, parseBundle, parseSitesCsv, sitesToCsv, type Bundle } from './storage/exchange';
import { isTauri } from './platform';
import { checkUpdate, installNative, type UpdateInfo } from './net/update';
import { BUILD_NUMBER } from './config';
import { openExternal } from './net/external';
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
  const [guideOpen, setGuideOpen] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  useEffect(() => { if (freshLink && !(sel?.kind === 'link' && sel.id === freshLink)) setFreshLink(null); }, [sel, freshLink]);
  const [searchMark, setSearchMark] = useState<{ lat: number; lon: number; name: string; detail: string } | null>(null);
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
  /* start-up message (a new test build cleared the project list) */
  const bootShown = useRef(false);
  useEffect(() => {
    if (!store.bootNotice || bootShown.current) return;
    bootShown.current = true;
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text: store.bootNotice! }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 12000);
  }, [store.bootNotice]);
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
  /*
   * Terrain (SRTM) + buildings, forest and water (OpenStreetMap) load by themselves: for a new link,
   * after an object is moved, and when a previous attempt failed and the network is back.
   * Hand-entered profiles are never overwritten.
   */
  const coordKey = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => `${a.lat.toFixed(6)},${a.lon.toFixed(6)}|${b.lat.toFixed(6)},${b.lon.toFixed(6)}`;
  const linksRef = useRef(links); linksRef.current = links;
  const sitesRef = useRef(sites); sitesRef.current = sites;
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const inflight = useRef<Set<string>>(new Set());
  const failed = useRef<Map<string, string>>(new Map());
  const autoProfile = useCallback(async (id: string) => {
    const l0 = linksRef.current.find((x) => x.id === id);
    const a = l0 && sitesRef.current.find((s) => s.id === l0.siteA), b = l0 && sitesRef.current.find((s) => s.id === l0.siteB);
    if (!l0 || !a || !b || inflight.current.has(id)) return;
    const key = coordKey(a, b);
    inflight.current.add(id);
    setLoadingIds(new Set(inflight.current));
    const latest = () => linksRef.current.find((x) => x.id === id);
    try {
      const pts = await fetchTerrainProfile(a.lat, a.lon, b.lat, b.lon);
      let cur = latest();
      if (!cur) return;
      store.updateLink({ ...cur, profile: pts, profileSource: 'srtm', profileFetchedAt: Date.now(), profileFor: key, clutterSource: 'none', clutterSummary: '' });
      // Ground heights of the objects follow the terrain model.
      const sa = sitesRef.current.find((s) => s.id === a.id), sb = sitesRef.current.find((s) => s.id === b.id);
      if (sa) store.updateSite({ ...sa, groundM: Math.round(pts[0].g) });
      if (sb) store.updateSite({ ...sb, groundM: Math.round(pts[pts.length - 1].g) });
      try {
        const forestHeight = l0.forestHeight ?? 20;
        const objs = await fetchClutterObjects(a.lat, a.lon, b.lat, b.lon, { forestHeight });
        const res = applyClutter(pts, a.lat, a.lon, b.lat, b.lon, objs, { forestHeight });
        cur = latest();
        if (cur && cur.profileSource === 'srtm') store.updateLink({ ...cur, profile: res.profile, clutterSource: 'osm', clutterFetchedAt: Date.now(), clutterSummary: res.summary });
        failed.current.delete(id);
        notify(`Профиль «${a.name} — ${b.name}» загружен. ${res.summary}`);
      } catch (e) {
        failed.current.set(id, key);
        notify(`Рельеф «${a.name} — ${b.name}» загружен, а здания, лес и вода — нет: ${(e as Error).message} Программа повторит попытку, когда сеть восстановится.`, true);
      }
    } catch (e) {
      failed.current.set(id, key);
      notify(`Профиль «${a.name} — ${b.name}» не загружен: ${(e as Error).message} Программа повторит попытку, когда сеть восстановится.`, true);
    } finally {
      inflight.current.delete(id);
      setLoadingIds(new Set(inflight.current));
    }
  }, [store, notify]);

  /* what needs loading: no profile, objects moved, or buildings/forest/water missing */
  useEffect(() => {
    if (net === 'offline') return;
    const t = window.setTimeout(() => {
      for (const l of links) {
        const a = sites.find((s) => s.id === l.siteA), b = sites.find((s) => s.id === l.siteB);
        if (!a || !b || inflight.current.has(l.id)) continue;
        if (l.profileSource === 'manual') continue;
        const key = coordKey(a, b);
        if (failed.current.get(l.id) === key) continue;
        const noProfile = l.profileSource !== 'srtm' || l.profile.length < 2;
        if (l.profileSource === 'srtm' && !l.profileFor) { store.updateLink({ ...l, profileFor: key }); continue; }
        const moved = l.profileSource === 'srtm' && l.profileFor !== key;
        const noClutter = l.profileSource === 'srtm' && l.clutterSource !== 'osm' && l.clutterSource !== 'manual';
        if (noProfile || moved || noClutter) void autoProfile(l.id);
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, [links, sites, net, autoProfile, store]);
  /* network is back: try failed links again */
  useEffect(() => { if (net === 'online') failed.current.clear(); }, [net]);

  const createLink = async (a: string, b: string) => {
    try {
      const l = await store.addLink(a, b);
      setModal(null); setMode('view'); setPending(null);
      setTab('links');
      setFreshLink(l.id);
      setSel({ kind: 'link', id: l.id });
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

  /* ---------- application update (latest GitHub release) ---------- */
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updProgress, setUpdProgress] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    // One quiet check a few seconds after start; errors (no network) are ignored here.
    if (!isTauri()) return;
    const t = window.setTimeout(() => { checkUpdate().then((u) => setUpdate(u.newer ? u : null)).catch(() => {}); }, 4000);
    return () => window.clearTimeout(t);
  }, []);
  const runUpdate = async () => {
    const u = await checkUpdate();
    setUpdate(u.newer ? u : null);
    const date = u.publishedAt ? new Date(u.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    if (!u.newer) {
      notify(`Установлена последняя версия${BUILD_NUMBER ? ` (сборка №${BUILD_NUMBER})` : ''}.`);
      return;
    }
    setDialog({
      title: 'Доступно обновление',
      wide: true,
      body: (
        <div className="import-info">
          <p>На GitHub опубликована <b>сборка №{u.number}</b>{date ? <> от {date}</> : null}. У вас {BUILD_NUMBER ? <>сборка №{BUILD_NUMBER}</> : 'сборка без номера'}.</p>
          {u.native ? <p>Программа сама скачает новую версию, проверит её подпись, установит и перезапустится. Это займёт около минуты.</p>
            : u.assetName ? <p>Будет скачан установщик <b>{u.assetName}</b>. После загрузки закройте программу и запустите его — новая версия установится поверх текущей.</p>
            : <p>Установщик для вашей системы в выпуске не найден — откроется страница выпуска на GitHub.</p>}
          <p className="hint">Пока идёт тестирование, новая сборка при первом запуске очищает список проектов. Перед установкой сохраните нужные проекты кнопкой «Экспорт проекта».</p>
        </div>
      ),
      confirm: u.native ? 'Установить и перезапустить' : u.assetName ? 'Скачать установщик' : 'Открыть страницу выпуска',
      onConfirm: () => {
        if (u.native) {
          setUpdProgress(null);
          void installNative(u.native, (p) => setUpdProgress(p)).catch((e) => {
            setUpdProgress(undefined);
            setDialog({
              title: 'Не удалось установить обновление',
              body: <p>{(e as Error)?.message || String(e)}. Можно скачать установщик вручную со страницы выпуска.</p>,
              confirm: 'Открыть страницу выпуска',
              onConfirm: () => { void openExternal(u.pageUrl).catch(fail); }
            });
          });
          return;
        }
        void openExternal(u.assetUrl ?? u.pageUrl).then(() => notify('Загрузка установщика началась в браузере.')).catch(fail);
      }
    });
  };

  /* ---------- project exchange between engineers ---------- */
  const exportProject = () => {
    if (!project) return;
    setDialog({
      title: 'Экспорт проекта',
      body: <p className="hint">В файл попадут объекты, пролёты со всеми исходными данными и профилями, а также ППУ и антенны из справочника. Отправьте файл коллеге: он откроет его кнопкой «Импорт проекта», дополнит и вернёт — у вас проект обновится.</p>,
      input: { label: 'Комментарий для коллеги (необязательно)', value: '', optional: true, multiline: true, placeholder: 'например: проверь высоты подвеса на пролёте А — Б' },
      confirm: 'Сохранить файл',
      onConfirm: (note) => {
        void (async () => {
          const b = await makeProjectBundle(store.repo, project, note || undefined);
          const d = new Date().toISOString().slice(0, 10);
          const w = await saveFile(`${safeFileName(project.name)} — ${d}.json`, JSON.stringify(b, null, 1), [{ name: 'Проект ОИР RRL Planner', extensions: ['json'] }]);
          if (w) notify(w === 'download' ? 'Файл проекта сохранён в загрузки.' : `Файл проекта сохранён: ${w}`);
        })().catch(fail);
      }
    });
  };
  let libNew = 0;
  const doImport = async (b: Bundle, mode: 'copy' | 'replace', addLib: boolean) => {
    let saved = '';
    if (mode === 'replace' && isTauri()) {
      // Keep the local version before it is overwritten.
      try {
        const local = (await store.repo.listProjects()).find((p) => p.id === b.projects[0].id);
        if (local) {
          const { appConfigDir, join } = await import('@tauri-apps/api/path');
          const fs = await import('@tauri-apps/plugin-fs');
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          const file = await join(await appConfigDir(), `before-import-${safeFileName(local.name)}-${stamp}.json`);
          await fs.writeTextFile(file, JSON.stringify(await makeProjectBundle(store.repo, local), null, 1));
          saved = file;
        }
      } catch (e) { console.warn('backup before import failed', e); }
    }
    const res = await importBundle(store.repo, b, mode, addLib);
    await store.reloadAll();
    if (res.projectId) await store.selectProject(res.projectId);
    setSel(null);
    notify((mode === 'replace'
      ? `Проект обновлён из файла: объектов ${res.sites}, пролётов ${res.links}.${saved ? ` Прежняя версия сохранена: ${saved}` : ''}`
      : `Импортировано: проектов ${res.projects}, объектов ${res.sites}, пролётов ${res.links}.`) + (addLib && libNew ? ' ППУ и антенны из файла добавлены в справочник.' : ''));
  };
  const importProject = async () => {
    const f = await openTextFile([{ name: 'Проект или копия ОИР RRL Planner', extensions: ['json'] }]);
    if (!f) return;
    let b: Bundle;
    try { b = parseBundle(JSON.parse(f.text)); } catch (e) { throw e instanceof SyntaxError ? new Error('Файл повреждён или это не файл проекта.') : e; }
    const when = b.exportedAt ? new Date(b.exportedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
    const fp = b.projects[0];
    const nl = await newLibraryItems(store.repo, b);
    libNew = nl.radios + nl.antennas;
    let addLib = false;
    const libBox = libNew ? (
      <label className="check" style={{ margin: '8px 0' }}>
        <input type="checkbox" onChange={(e) => { addLib = e.target.checked; }} /> Сохранить в справочник оборудование из файла{nl.radios ? `: ППУ — ${nl.radios}` : ''}{nl.antennas ? `${nl.radios ? ',' : ':'} антенн — ${nl.antennas}` : ''}
      </label>
    ) : null;
    const info = (
      <div className="import-info">
        <p>Файл: <b>{f.name}</b>{when ? <>, сохранён {when}</> : null}</p>
        {b.kind === 'project' && fp ? <p>Проект «{fp.name}»: объектов {(b.sites || []).length}, пролётов {(b.links || []).length}.</p> : <p>Резервная копия: проектов {b.projects.length}.</p>}
        {b.note ? <div className="import-note"><span>Комментарий отправителя</span>{b.note}</div> : null}
        {libBox}
      </div>
    );
    const existing = await findExisting(store.repo, b);
    if (existing) {
      const ls = await store.repo.listLinks(existing.id), ss = await store.repo.listSites(existing.id);
      setDialog({
        title: 'Этот проект у вас уже есть',
        wide: true,
        body: <>{info}<p>Сейчас у вас в проекте «{existing.name}»: объектов {ss.length}, пролётов {ls.length}.</p><p className="hint">«Обновить проект» заменит ваш проект версией из файла — так забирают проект, который коллега дополнил и вернул. Ваша текущая версия перед этим сохранится в папке настроек программы. «Сохранить копией» добавит файл отдельным проектом, ничего не меняя.</p></>,
        confirm: 'Обновить проект',
        alt: { label: 'Сохранить копией', onClick: () => { void doImport(b, 'copy', addLib).catch(fail); } },
        onConfirm: () => { void doImport(b, 'replace', addLib).catch(fail); }
      });
      return;
    }
    setDialog({ title: 'Импорт проекта', wide: true, body: info, confirm: 'Импортировать', onConfirm: () => { void doImport(b, 'copy', addLib).catch(fail); } });
  };

  const onAction = async (a: FileAction) => {
    try {
      if (a === 'about') return setModal({ kind: 'about' });
      if (a === 'update') return await runUpdate();
      if (a === 'clear-tiles') return setDialog({ title: 'Очистить кэш карты?', body: 'Загруженные ранее фрагменты карты удалятся. Без интернета карта будет пустой, пока вы снова не посмотрите эти места.', confirm: 'Очистить', danger: true, onConfirm: () => { void clearTileCache().then(() => notify('Кэш карты очищен.')); } });
      if (a === 'backup') {
        const b = await makeBackup(store.repo);
        const d = new Date().toISOString().slice(0, 10);
        const w = await saveFile(`ОИР RRL Planner — копия ${d}.json`, JSON.stringify(b, null, 1), [{ name: 'Резервная копия', extensions: ['json'] }]);
        if (w) notify(`Резервная копия сохранена: ${b.projects.length} проектов, ${b.links.length} пролётов.`);
        return;
      }
      if (a === 'import') return await importProject();
      if (!project) return;
      if (a === 'export-project') exportProject();
      else if (a === 'export-csv') {
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
          key={l.id} link={l} result={results.get(l.id)} notify={notify} loading={loadingIds.has(l.id)} initialTab={freshLink === l.id ? 'input' : 'result'} onClose={() => setSel(null)}
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
      <TopBar updateAvailable={update?.number ?? null} onAction={(a) => void onAction(a)} onPlace={(p) => { setSearchMark(p); focusOn([[p.lat, p.lon]]); }} guideOpen={guideOpen} onGuide={() => { setGuideOpen((o) => !o); if (!settings.guideDone) store.setSetting('guideDone', true); }} />
      <div className="main">
        <Sidebar
          tab={tab} setTab={setTab} selection={sel} select={(s) => { setSel(s); if (s?.kind === 'site') { const x = sites.find((y) => y.id === s.id); if (x) focusOn([[x.lat, x.lon]]); } if (s?.kind === 'link') { const l = links.find((y) => y.id === s.id); const a = sites.find((y) => y.id === l?.siteA), b = sites.find((y) => y.id === l?.siteB); if (a && b) focusOn([[a.lat, a.lon], [b.lat, b.lon]]); } }}
          onAddSiteMap={() => { setMode('add-site'); setSel(null); }}
          onAddSiteCoords={() => setModal({ kind: 'add-site' })}
          onAddLink={() => setModal({ kind: 'new-link' })}
          onNewProject={newProject}
          onExportProject={exportProject}
          onImportProject={() => { importProject().catch(fail); }}
          onRenameProject={() => project && setDialog({ title: 'Переименовать проект', input: { label: 'Название проекта', value: project.name }, confirm: 'Сохранить', onConfirm: (v) => { void store.updateProject({ ...project, name: v! }); } })}
          onCleanupProjects={() => setModal({ kind: 'cleanup' })}
          onDeleteSite={async (id) => { const st = sites.find((x) => x.id === id); try { await store.deleteSite(id); if (sel?.kind === 'site' && sel.id === id) setSel(null); notify(`Объект «${st?.name ?? ''}» удалён.`); } catch (e) { fail(e); } }}
          onDeleteLink={async (id) => { const l = links.find((x) => x.id === id); const nm = l ? `${sites.find((s) => s.id === l.siteA)?.name ?? ''} — ${sites.find((s) => s.id === l.siteB)?.name ?? ''}` : ''; try { await store.deleteLink(id); if (sel?.kind === 'link' && sel.id === id) setSel(null); notify(`Пролёт «${nm}» удалён.`); } catch (e) { fail(e); } }}
          onDeleteProjectById={async (id) => { const pr = store.projects.find((x) => x.id === id); try { await store.deleteProject(id); if (id === project?.id) setSel(null); notify(`Проект «${pr?.name ?? ''}» удалён.`); } catch (e) { fail(e); } }}
          onDeleteProject={() => project && confirmDelete('Удалить проект?', `Проект «${project.name}» удалится вместе со всеми объектами (${sites.length}) и пролётами (${links.length}). Перед удалением его можно сохранить кнопкой «Экспорт проекта».`, async () => { await store.deleteProject(project.id); notify('Проект удалён.'); })}
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
            searchMark={searchMark}
            onSearchMarkClear={() => setSearchMark(null)}
            onSearchMarkCreate={() => { if (!searchMark) return; if (!project) { notify('Сначала создайте проект: кнопка рядом с полем «Проект».', true); return; } setModal({ kind: 'add-site', lat: searchMark.lat, lon: searchMark.lon }); }}
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
          {guideOpen ? (
            <Guide
              linkOpen={sel?.kind === 'link'} sidebarTab={tab}
              onClose={() => setGuideOpen(false)}
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
          onCreate={(d) => { void store.addSite({ ...d, notes: '' }).then((s) => { setModal(null); setSearchMark(null); setTab('sites'); setSel({ kind: 'site', id: s.id }); focusOn([[s.lat, s.lon]]); }).catch(fail); }}
        />
      ) : null}
      {modal?.kind === 'new-link' ? (
        <NewLinkDialog initialA={modal.a} onClose={() => setModal(null)} onCreate={(a, b) => void createLink(a, b)} onPickOnMap={() => { setModal(null); setSel(null); setMode('pick-link'); setPending(modal.a ?? null); }} />
      ) : null}
      {modal?.kind === 'about' ? <AboutDialog onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'cleanup' ? <ProjectsCleanupDialog onClose={() => setModal(null)} onDeleteOne={async (id) => { const pr = store.projects.find((x) => x.id === id); try { await store.deleteProject(id); notify(`Проект «${pr?.name ?? ''}» удалён.`); } catch (e) { fail(e); } }} onDelete={async (ids) => { try { await store.deleteProjects(ids); setSel(null); notify(`Удалено проектов: ${ids.length}.`); } catch (e) { fail(e); } }} /> : null}
      <Toasts items={toasts} />
      <TooltipLayer />
      {updProgress !== undefined ? (
        <div className="upd-progress" role="status">
          <b>Устанавливаю обновление…</b>
          <div className="upd-bar"><span style={{ width: updProgress == null ? '30%' : `${Math.round(updProgress * 100)}%` }} className={updProgress == null ? 'indef' : ''} /></div>
          <small>{updProgress == null ? 'Загрузка' : updProgress >= 1 ? 'Установка, программа перезапустится' : `Загрузка ${Math.round(updProgress * 100)} %`}</small>
        </div>
      ) : null}
    </div>
  );
}
