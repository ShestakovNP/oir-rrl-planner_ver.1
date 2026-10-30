/** Backup, project exchange (JSON) and site lists (CSV for Excel). */
import type { Library, Link, Project, Site } from '../data/types';
import { DEFAULT_CLIMATE, emptyChannel } from '../data/types';
import { uid } from '../data/ids';
import { parseCoord } from '../data/calc/geo';
import type { Repo } from './repo';

export const FORMAT = 'oir-rrl-planner';
export const FORMAT_VERSION = 1;

export interface Bundle {
  format: typeof FORMAT;
  version: number;
  kind: 'backup' | 'project';
  exportedAt: string;
  projects: Project[];
  sites: Site[];
  links: Link[];
  library?: Library;
}

export async function makeBackup(repo: Repo): Promise<Bundle> {
  return {
    format: FORMAT, version: FORMAT_VERSION, kind: 'backup', exportedAt: new Date().toISOString(),
    projects: await repo.listProjects(), sites: await repo.listSites(), links: await repo.listLinks(),
    library: (await repo.getLibrary()) ?? undefined
  };
}

export async function makeProjectBundle(repo: Repo, project: Project): Promise<Bundle> {
  return {
    format: FORMAT, version: FORMAT_VERSION, kind: 'project', exportedAt: new Date().toISOString(),
    projects: [project], sites: await repo.listSites(project.id), links: await repo.listLinks(project.id),
    library: (await repo.getLibrary()) ?? undefined
  };
}

/** Fills fields added in later versions so old files keep working. */
function normalizeLink(l: Link): Link {
  const ch = (l.channels || []) as Link['channels'];
  return {
    ...l,
    antennaA: l.antennaA ?? '', antennaB: l.antennaB ?? '',
    channels: [ch[0] ? { ...emptyChannel(6000, 'H', true), ...ch[0] } : emptyChannel(6000, 'H', true), ch[1] ? { ...emptyChannel(8000, 'V', false), ...ch[1] } : emptyChannel(8000, 'V', false)],
    climate: { ...DEFAULT_CLIMATE, ...(l.climate || {}) },
    profile: Array.isArray(l.profile) ? l.profile : [],
    profileSource: l.profileSource ?? 'none', profileFetchedAt: l.profileFetchedAt ?? null,
    declination: l.declination ?? null, notes: l.notes ?? '', updatedAt: l.updatedAt ?? Date.now()
  };
}

/**
 * Imports a bundle as new records (fresh ids), so importing never overwrites
 * existing work. Library items with names not yet present are added.
 */
export async function importBundle(repo: Repo, raw: unknown): Promise<{ projects: number; sites: number; links: number }> {
  const b = raw as Bundle;
  if (!b || b.format !== FORMAT || !Array.isArray(b.projects)) throw new Error('Это не файл ОИР RRL Planner.');
  if (b.version > FORMAT_VERSION) throw new Error('Файл создан более новой версией программы. Обновите программу.');
  const pMap = new Map<string, string>(), sMap = new Map<string, string>();
  const existing = new Set((await repo.listProjects()).map((p) => p.name));
  const now = Date.now();
  for (const p of b.projects) {
    const id = uid();
    pMap.set(p.id, id);
    const name = existing.has(p.name) ? `${p.name} (импорт)` : p.name;
    await repo.saveProject({ ...p, id, name, notes: p.notes ?? '', updatedAt: now, createdAt: p.createdAt ?? now });
  }
  let sites = 0, links = 0;
  for (const s of b.sites || []) {
    const projectId = pMap.get(s.projectId);
    if (!projectId) continue;
    const id = uid();
    sMap.set(s.id, id);
    await repo.saveSite({ ...s, id, projectId, code: s.code ?? '', notes: s.notes ?? '', groundM: s.groundM ?? null });
    sites++;
  }
  for (const l of b.links || []) {
    const projectId = pMap.get(l.projectId), a = sMap.get(l.siteA), bb = sMap.get(l.siteB);
    if (!projectId || !a || !bb) continue;
    await repo.saveLink(normalizeLink({ ...l, id: uid(), projectId, siteA: a, siteB: bb }));
    links++;
  }
  if (b.library) {
    const lib = (await repo.getLibrary()) ?? { radios: [], antennas: [] };
    const rn = new Set(lib.radios.map((r) => r.name)), an = new Set(lib.antennas.map((a) => a.name));
    b.library.radios?.forEach((r) => { if (!rn.has(r.name)) lib.radios.push({ ...r, id: uid() }); });
    b.library.antennas?.forEach((a) => { if (!an.has(a.name)) lib.antennas.push({ ...a, id: uid() }); });
    await repo.saveLibrary(lib);
  }
  return { projects: b.projects.length, sites, links };
}

/* ---------------- CSV ---------------- */

const CSV_HEAD = ['Название', 'Код', 'Широта', 'Долгота', 'Высота земли, м', 'Заметки'];
const q = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v: number | null, d: number) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d).replace('.', ','));

/** UTF-8 with BOM and ";" separators: opens correctly in Russian Excel. */
export function sitesToCsv(sites: Site[]): string {
  const rows = [CSV_HEAD.join(';'), ...sites.map((s) => [q(s.name), q(s.code), num(s.lat, 6), num(s.lon, 6), num(s.groundM, 1), q(s.notes)].join(';'))];
  return '﻿' + rows.join('\r\n') + '\r\n';
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface CsvSite { name: string; code: string; lat: number; lon: number; groundM: number | null; notes: string }

/** Accepts ";", tab or "," separators, with or without a header row. */
export function parseSitesCsv(text: string): { sites: CsvSite[]; skipped: number[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { sites: [], skipped: [] };
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  let idx = { name: 0, code: 1, lat: 2, lon: 3, ground: 4, notes: 5 };
  let start = 0;
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  if (head.some((h) => /назв|name|широт|lat/.test(h))) {
    const find = (re: RegExp, def: number) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : def; };
    idx = { name: find(/назв|name|сайт|площад|объект/, 0), code: find(/код|code|номер|бс/, -1), lat: find(/широт|lat/, 2), lon: find(/долгот|lon|lng/, 3), ground: find(/высот|ground|alt|elev/, -1), notes: find(/замет|note|коммент/, -1) };
    start = 1;
  }
  const sites: CsvSite[] = [], skipped: number[] = [];
  for (let i = start; i < lines.length; i++) {
    const c = splitCsvLine(lines[i], sep);
    const lat = parseCoord(c[idx.lat]), lon = parseCoord(c[idx.lon]);
    if (!c[idx.name] || !Number.isFinite(lat) || !Number.isFinite(lon)) { skipped.push(i + 1); continue; }
    const g = idx.ground >= 0 ? parseFloat(String(c[idx.ground] ?? '').replace(',', '.')) : NaN;
    sites.push({ name: c[idx.name], code: idx.code >= 0 ? c[idx.code] ?? '' : '', lat, lon, groundM: Number.isFinite(g) ? g : null, notes: idx.notes >= 0 ? c[idx.notes] ?? '' : '' });
  }
  return { sites, skipped };
}
