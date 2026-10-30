/**
 * Local persistence. In the desktop app: SQLite via the Tauri SQL plugin,
 * file `rrl-planner.db` in the app data folder:
 *   macOS   ~/Library/Application Support/ru.oir.rrlplanner/
 *   Windows %APPDATA%\ru.oir.rrlplanner\
 * In a plain browser (dev mode) the same interface is backed by localStorage.
 *
 * Records are stored as JSON documents with a few indexed columns, which keeps
 * the schema stable while the data model grows.
 */
import type { Library, Link, Project, Site } from '../data/types';
import { isTauri } from '../platform';

export interface Repo {
  readonly kind: 'sqlite' | 'browser';
  init(): Promise<void>;
  location(): Promise<string>;
  listProjects(): Promise<Project[]>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listSites(projectId?: string): Promise<Site[]>;
  saveSite(s: Site): Promise<void>;
  deleteSite(id: string): Promise<void>;
  listLinks(projectId?: string): Promise<Link[]>;
  saveLink(l: Link): Promise<void>;
  deleteLink(id: string): Promise<void>;
  getLibrary(): Promise<Library | null>;
  saveLibrary(lib: Library): Promise<void>;
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

/* ---------------- SQLite ---------------- */

interface SqlDb {
  execute(q: string, params?: unknown[]): Promise<unknown>;
  select<T>(q: string, params?: unknown[]): Promise<T>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sites_project ON sites(project_id)`,
  `CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS links_project ON links(project_id)`,
  `CREATE TABLE IF NOT EXISTS library (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
];
export const DB_FILE = 'rrl-planner.db';

class SqliteRepo implements Repo {
  readonly kind = 'sqlite' as const;
  private db!: SqlDb;

  async init() {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    this.db = (await Database.load(`sqlite:${DB_FILE}`)) as unknown as SqlDb;
    for (const q of SCHEMA) await this.db.execute(q);
    await this.db.execute(`INSERT INTO meta(key, value) VALUES('schema', '1') ON CONFLICT(key) DO NOTHING`);
  }
  async location() {
    const { appConfigDir, join } = await import('@tauri-apps/api/path');
    return join(await appConfigDir(), DB_FILE);
  }
  private async docs<T>(table: string, projectId?: string): Promise<T[]> {
    const rows = projectId
      ? await this.db.select<{ data: string }[]>(`SELECT data FROM ${table} WHERE project_id = $1`, [projectId])
      : await this.db.select<{ data: string }[]>(`SELECT data FROM ${table}`);
    return rows.map((r) => JSON.parse(r.data) as T);
  }
  async listProjects() {
    const rows = await this.db.select<{ data: string }[]>(`SELECT data FROM projects ORDER BY updated_at DESC`);
    return rows.map((r) => JSON.parse(r.data) as Project);
  }
  async saveProject(p: Project) {
    await this.db.execute(
      `INSERT INTO projects(id, data, updated_at) VALUES($1, $2, $3) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [p.id, JSON.stringify(p), p.updatedAt]
    );
  }
  async deleteProject(id: string) {
    await this.db.execute(`DELETE FROM links WHERE project_id = $1`, [id]);
    await this.db.execute(`DELETE FROM sites WHERE project_id = $1`, [id]);
    await this.db.execute(`DELETE FROM projects WHERE id = $1`, [id]);
  }
  listSites(projectId?: string) { return this.docs<Site>('sites', projectId); }
  async saveSite(s: Site) {
    await this.db.execute(
      `INSERT INTO sites(id, project_id, data) VALUES($1, $2, $3) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data`,
      [s.id, s.projectId, JSON.stringify(s)]
    );
  }
  async deleteSite(id: string) { await this.db.execute(`DELETE FROM sites WHERE id = $1`, [id]); }
  listLinks(projectId?: string) { return this.docs<Link>('links', projectId); }
  async saveLink(l: Link) {
    await this.db.execute(
      `INSERT INTO links(id, project_id, data) VALUES($1, $2, $3) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data`,
      [l.id, l.projectId, JSON.stringify(l)]
    );
  }
  async deleteLink(id: string) { await this.db.execute(`DELETE FROM links WHERE id = $1`, [id]); }
  async getLibrary() {
    const rows = await this.db.select<{ data: string }[]>(`SELECT data FROM library WHERE id = 'main'`);
    return rows.length ? (JSON.parse(rows[0].data) as Library) : null;
  }
  async saveLibrary(lib: Library) {
    await this.db.execute(`INSERT INTO library(id, data) VALUES('main', $1) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [JSON.stringify(lib)]);
  }
  async getSetting<T>(key: string) {
    const rows = await this.db.select<{ value: string }[]>(`SELECT value FROM settings WHERE key = $1`, [key]);
    return rows.length ? (JSON.parse(rows[0].value) as T) : null;
  }
  async setSetting<T>(key: string, value: T) {
    await this.db.execute(`INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(value)]);
  }
}

/* ---------------- Browser (dev) ---------------- */

const LS = 'oir-rrl-planner:';
class BrowserRepo implements Repo {
  readonly kind = 'browser' as const;
  private mem = new Map<string, string>();
  private get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(LS + k);
      return v ? (JSON.parse(v) as T) : def;
    } catch {
      const v = this.mem.get(k);
      return v ? (JSON.parse(v) as T) : def;
    }
  }
  private put(k: string, v: unknown) {
    const s = JSON.stringify(v);
    try { localStorage.setItem(LS + k, s); } catch { this.mem.set(k, s); }
  }
  private upsert<T extends { id: string }>(k: string, item: T) {
    const list = this.get<T[]>(k, []).filter((x) => x.id !== item.id);
    list.push(item);
    this.put(k, list);
  }
  async init() {}
  async location() { return 'Хранилище браузера (режим разработки)'; }
  async listProjects() { return this.get<Project[]>('projects', []).sort((a, b) => b.updatedAt - a.updatedAt); }
  async saveProject(p: Project) { this.upsert('projects', p); }
  async deleteProject(id: string) {
    this.put('projects', this.get<Project[]>('projects', []).filter((p) => p.id !== id));
    this.put('sites', this.get<Site[]>('sites', []).filter((s) => s.projectId !== id));
    this.put('links', this.get<Link[]>('links', []).filter((l) => l.projectId !== id));
  }
  async listSites(projectId?: string) { return this.get<Site[]>('sites', []).filter((s) => !projectId || s.projectId === projectId); }
  async saveSite(s: Site) { this.upsert('sites', s); }
  async deleteSite(id: string) { this.put('sites', this.get<Site[]>('sites', []).filter((s) => s.id !== id)); }
  async listLinks(projectId?: string) { return this.get<Link[]>('links', []).filter((l) => !projectId || l.projectId === projectId); }
  async saveLink(l: Link) { this.upsert('links', l); }
  async deleteLink(id: string) { this.put('links', this.get<Link[]>('links', []).filter((l) => l.id !== id)); }
  async getLibrary() { return this.get<Library | null>('library', null); }
  async saveLibrary(lib: Library) { this.put('library', lib); }
  async getSetting<T>(key: string) { return this.get<T | null>('set:' + key, null); }
  async setSetting<T>(key: string, value: T) { this.put('set:' + key, value); }
}

export async function openRepo(): Promise<Repo> {
  const repo: Repo = isTauri() ? new SqliteRepo() : new BrowserRepo();
  await repo.init();
  return repo;
}
