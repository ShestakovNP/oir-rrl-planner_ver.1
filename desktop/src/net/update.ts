/**
 * «Обновить приложение»: asks the public GitHub API for the latest release of UPDATE_REPO,
 * compares its build number with this build and picks the installer for this system.
 * The installer is downloaded by the user's browser; the app never runs code it downloads.
 */
import { BUILD_NUMBER, UPDATE_REPO } from '../config';
import { httpGet } from './http';

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
}

import { buildOfTag, pickAsset, platform, type GhRelease } from './updateAssets';

export async function checkUpdate(): Promise<UpdateInfo> {
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
