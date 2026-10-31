/** Application state: the current project, its sites and links, the equipment library and settings. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Library, Link, Project, Site } from '../data/types';
import { openRepo, type Repo } from '../storage/repo';
import { calculateLink, channelsShareFrequency, type LinkResult } from '../data/calc/link';
import { baseLink, defaultLibrary } from '../data/samples';
import { uid } from '../data/ids';

export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  providerId: string;
  theme: Theme;
  mapView: { center: [number, number]; zoom: number };
  lastProjectId: string | null;
  /** Pinned projects shown on top of the project list (up to 5). */
  favoriteProjects: string[];
  /** The «?» guide button was used at least once (until then it is gently highlighted). */
  guideDone: boolean;
}
const DEFAULT_SETTINGS: Settings = { providerId: 'osm', theme: 'system', mapView: { center: [56.5, 84.9], zoom: 8 }, lastProjectId: null, favoriteProjects: [], guideDone: false };

export interface Store {
  repo: Repo;
  projects: Project[];
  project: Project | null;
  sites: Site[];
  links: Link[];
  library: Library;
  results: Map<string, LinkResult>;
  settings: Settings;
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void;
  selectProject(id: string): Promise<void>;
  createProject(name: string): Promise<Project>;
  updateProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Removes several projects at once; opens a remaining one if the current project was removed. */
  deleteProjects(ids: string[]): Promise<void>;
  addSite(data: Omit<Site, 'id' | 'projectId'>): Promise<Site>;
  updateSite(s: Site): void;
  deleteSite(id: string): Promise<void>;
  addLink(a: string, b: string): Promise<Link>;
  updateLink(l: Link): void;
  deleteLink(id: string): Promise<void>;
  saveLibrary(lib: Library): void;
  reloadAll(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);
let boot: Promise<Repo> | null = null;
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store is not ready');
  return s;
};

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: (err: string | null) => ReactNode }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [library, setLibrary] = useState<Library>({ radios: [], antennas: [] });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const queue = useRef(new Map<string, Promise<unknown>>());

  /** Serialises writes per record so rapid edits are stored in order. */
  const persist = useCallback((key: string, fn: () => Promise<unknown>) => {
    const prev = queue.current.get(key) ?? Promise.resolve();
    const next = prev.then(fn).catch((e) => console.error('save failed', key, e));
    queue.current.set(key, next);
    return next;
  }, []);

  const loadProject = useCallback(async (r: Repo, id: string | null) => {
    setProjectId(id);
    if (!id) { setSites([]); setLinks([]); return; }
    const [s, l] = await Promise.all([r.listSites(id), r.listLinks(id)]);
    setSites(s);
    setLinks(l);
  }, []);

  const bootstrap = useCallback(async (r: Repo) => {
    const ps = await r.listProjects();
    let lib = await r.getLibrary();
    const seeded = await r.getSetting<boolean>('seeded');
    if (!seeded) {
      // First run starts with an empty project list; only the equipment library gets templates.
      if (!lib) { lib = defaultLibrary(); await r.saveLibrary(lib); }
      await r.setSetting('seeded', true);
    }
    // One-time cleanup: earlier versions pre-filled XPD = 30 dB everywhere. That value was a
    // placeholder, not datasheet data, so it is cleared where it was never needed.
    if (!(await r.getSetting<boolean>('migration:xpd-placeholder'))) {
      if (lib) {
        const isTemplate = (a: { name: string }) => /^Параболическая |^Новая антенна$/.test(a.name);
        if (lib.antennas.some((a) => a.xpdDb === 30 && isTemplate(a))) {
          lib = { ...lib, antennas: lib.antennas.map((a) => (a.xpdDb === 30 && isTemplate(a) ? { ...a, xpdDb: null } : a)) };
          await r.saveLibrary(lib);
        }
      }
      for (const l of await r.listLinks()) {
        if (l.xpdA === 30 && l.xpdB === 30 && !channelsShareFrequency(l)) await r.saveLink({ ...l, xpdA: null, xpdB: null });
      }
      await r.setSetting('migration:xpd-placeholder', true);
    }
    // Older versions named a fresh entry «Новая радиостанция»; the library now calls them ППУ.
    if (lib && lib.radios.some((x) => /^Новая радиостанция$/i.test(x.name.trim()))) {
      lib = { ...lib, radios: lib.radios.map((x) => (/^Новая радиостанция$/i.test(x.name.trim()) ? { ...x, name: 'Новое ППУ' } : x)) };
      await r.saveLibrary(lib);
    }
    const st = { ...DEFAULT_SETTINGS, ...((await r.getSetting<Settings>('settings')) ?? {}) };
    setSettings(st);
    setLibrary(lib ?? { radios: [], antennas: [] });
    setProjects(ps);
    const pid = st.lastProjectId && ps.some((p) => p.id === st.lastProjectId) ? st.lastProjectId : ps[0]?.id ?? null;
    await loadProject(r, pid);
  }, [loadProject]);

  useEffect(() => {
    let alive = true;
    // A single bootstrap per app run, even when React StrictMode mounts twice in development.
    boot ??= openRepo().then(async (r) => { await bootstrap(r); return r; });
    boot
      .then((r) => { if (alive) setRepo(r); })
      .catch((e) => { console.error(e); if (alive) setErr(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [bootstrap]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const setSetting = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    const next = { ...settingsRef.current, [k]: v };
    setSettings(next);
    if (repo) persist('settings', () => repo.setSetting('settings', next));
  }, [repo, persist]);

  const results = useMemo(() => {
    const m = new Map<string, LinkResult>();
    const byId = new Map(sites.map((s) => [s.id, s]));
    links.forEach((l) => {
      const a = byId.get(l.siteA), b = byId.get(l.siteB);
      if (a && b) {
        try { m.set(l.id, calculateLink(l, a, b)); } catch (e) { console.error('calc failed', l.id, e); }
      }
    });
    return m;
  }, [links, sites]);

  const touchProject = useCallback((id: string) => {
    setProjects((ps) => {
      const p = ps.find((x) => x.id === id);
      if (!p || !repo) return ps;
      const upd = { ...p, updatedAt: Date.now() };
      persist('p' + id, () => repo.saveProject(upd));
      return ps.map((x) => (x.id === id ? upd : x));
    });
  }, [repo, persist]);

  if (!repo) return <>{fallback(err)}</>;
  const project = projects.find((p) => p.id === projectId) ?? null;

  const store: Store = {
    repo, projects, project, sites, links, library, results, settings, setSetting,
    async selectProject(id) {
      await loadProject(repo, id);
      setSetting('lastProjectId', id);
    },
    async createProject(name) {
      const now = Date.now();
      const p: Project = { id: uid(), name, notes: '', createdAt: now, updatedAt: now };
      await repo.saveProject(p);
      setProjects((ps) => [p, ...ps]);
      await loadProject(repo, p.id);
      setSetting('lastProjectId', p.id);
      return p;
    },
    async updateProject(p) {
      const upd = { ...p, updatedAt: Date.now() };
      setProjects((ps) => ps.map((x) => (x.id === p.id ? upd : x)));
      await persist('p' + p.id, () => repo.saveProject(upd));
    },
    async deleteProject(id) {
      await repo.deleteProject(id);
      const rest = projects.filter((p) => p.id !== id);
      setProjects(rest);
      if (id === projectId) await loadProject(repo, rest[0]?.id ?? null);
      if ((settings.favoriteProjects ?? []).includes(id)) setSetting('favoriteProjects', settings.favoriteProjects.filter((x) => x !== id));
    },
    async deleteProjects(ids) {
      const drop = new Set(ids);
      for (const id of ids) await repo.deleteProject(id);
      const rest = projects.filter((p) => !drop.has(p.id));
      setProjects(rest);
      setSetting('favoriteProjects', (settings.favoriteProjects ?? []).filter((x) => !drop.has(x)));
      if (projectId && drop.has(projectId)) {
        const next = rest.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
        await loadProject(repo, next);
        setSetting('lastProjectId', next);
      }
    },
    async addSite(data) {
      if (!project) throw new Error('Сначала создайте проект.');
      const s: Site = { ...data, id: uid(), projectId: project.id };
      setSites((xs) => [...xs, s]);
      await persist('s' + s.id, () => repo.saveSite(s));
      touchProject(project.id);
      return s;
    },
    updateSite(s) {
      setSites((xs) => xs.map((x) => (x.id === s.id ? s : x)));
      persist('s' + s.id, () => repo.saveSite(s));
    },
    async deleteSite(id) {
      const dead = links.filter((l) => l.siteA === id || l.siteB === id);
      for (const l of dead) await repo.deleteLink(l.id);
      await repo.deleteSite(id);
      setLinks((xs) => xs.filter((l) => l.siteA !== id && l.siteB !== id));
      setSites((xs) => xs.filter((s) => s.id !== id));
      if (project) touchProject(project.id);
    },
    async addLink(a, b) {
      if (!project) throw new Error('Сначала создайте проект.');
      const l = baseLink(project.id, a, b);
      const lib6 = library.radios[0];
      if (lib6) { l.channels[0].modes = lib6.modes.map((m) => ({ ...m })); l.channels[0].radioName = lib6.name; }
      setLinks((xs) => [...xs, l]);
      await persist('l' + l.id, () => repo.saveLink(l));
      touchProject(project.id);
      return l;
    },
    updateLink(l) {
      const upd = { ...l, updatedAt: Date.now() };
      setLinks((xs) => xs.map((x) => (x.id === l.id ? upd : x)));
      persist('l' + l.id, () => repo.saveLink(upd));
    },
    async deleteLink(id) {
      await repo.deleteLink(id);
      setLinks((xs) => xs.filter((l) => l.id !== id));
      if (project) touchProject(project.id);
    },
    saveLibrary(lib) {
      setLibrary(lib);
      persist('library', () => repo.saveLibrary(lib));
    },
    async reloadAll() {
      const ps = await repo.listProjects();
      setProjects(ps);
      setLibrary((await repo.getLibrary()) ?? { radios: [], antennas: [] });
      await loadProject(repo, projectId && ps.some((p) => p.id === projectId) ? projectId : ps[0]?.id ?? null);
    }
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
