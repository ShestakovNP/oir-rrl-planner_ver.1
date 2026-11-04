/**
 * «Обновить приложение».
 *  1. In the desktop app: the Tauri updater reads latest.json of the latest GitHub release,
 *     downloads the build for this system, checks its signature against the public key in
 *     tauri.conf.json, installs it and the app restarts. Nothing to download by hand.
 *  2. Fallback (older releases without latest.json, or the updater failed): the public GitHub API
 *     gives the latest release and the installer is downloaded by the browser.
 */
import { BUILD_NUMBER, UPDATE_REPO } from '../config';
import { isTauri } from '../platform';
import { httpGet } from './http';

/** The part of the Tauri updater's Update object we use. */
export interface NativeUpdate {
  version: string;
  date?: string;
  downloadAndInstall(onEvent?: (e: { event: 'Started' | 'Progress' | 'Finished'; data?: { contentLength?: number; chunkLength?: number } }) => void): Promise<void>;
}

export interface UpdateInfo {
  /** Build number of the latest release. */
  number: number;
  name: string;
  publishedAt: string;
  /** Installer for this system (null = not found in the release). */
  assetUrl: string | null;
  assetName: string | null;
  pageUrl: string;
  newer: boolean;
  /** Set when the update can be installed from inside the app. */
  native?: NativeUpdate;
}


async function checkNative(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const u = (await check({ timeout: 15000 })) as NativeUpdate | null;
    const page = `https://github.com/${UPDATE_REPO}/releases/latest`;
    if (!u) return { number: BUILD_NUMBER, name: '', publishedAt: '', assetUrl: null, assetName: null, pageUrl: page, newer: false };
    const n = buildOfVersion(u.version);
    return { number: n, name: `Сборка №${n}`, publishedAt: u.date ?? '', assetUrl: null, assetName: null, pageUrl: page, newer: true, native: u };
  } catch (e) {
    console.warn('updater check failed, falling back to the GitHub API', e);
    return null;
  }
}

/** Installs a native update; progress 0…1 (null while the size is unknown). Restarts the app. */
export async function installNative(u: NativeUpdate, onProgress: (p: number | null) => void): Promise<void> {
  let total = 0, got = 0;
  await u.downloadAndInstall((e) => {
    if (e.event === 'Started') { total = e.data?.contentLength ?? 0; onProgress(total ? 0 : null); }
    else if (e.event === 'Progress') { got += e.data?.chunkLength ?? 0; onProgress(total ? Math.min(1, got / total) : null); }
    else onProgress(1);
  });
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

import { buildOfTag, buildOfVersion, pickAsset, platform, type GhRelease } from './updateAssets';

export async function checkUpdate(): Promise<UpdateInfo> {
  const n = await checkNative();
  if (n) return n;
  let res: Response;
  try {
    res = await httpGet(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { accept: 'application/vnd.github+json', timeoutMs: 15000 });
  } catch (e) {
    const m = (e as Error).message || '';
    if (/404/.test(m)) throw new Error('На GitHub пока нет опубликованных сборок.');
    if (/403|429/.test(m)) throw new Error('GitHub временно ограничил число запросов. Попробуйте через час.');
    throw e;
  }
  const r = (await res.json()) as GhRelease;
  const number = buildOfTag(r.tag_name);
  const a = pickAsset(r.assets || [], platform());
  return {
    number, name: r.name || r.tag_name, publishedAt: r.published_at, assetUrl: a?.browser_download_url ?? null, assetName: a?.name ?? null,
    pageUrl: r.html_url, newer: number > BUILD_NUMBER
  };
}
