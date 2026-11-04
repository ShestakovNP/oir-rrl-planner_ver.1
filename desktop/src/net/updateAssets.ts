/** Pure helpers of the update check (no network): release tag → build number, installer for this system. */
export interface GhAsset { name: string; browser_download_url: string }
export interface GhRelease { tag_name: string; name: string | null; html_url: string; published_at: string; assets: GhAsset[] }

export const platform = (): 'mac' | 'win' | 'other' => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Mac/i.test(ua) ? 'mac' : /Win/i.test(ua) ? 'win' : 'other';
};

/** build-123 → 123; v1.2.3 tags have no build number (0). */
export const buildOfTag = (tag: string) => { const m = tag.match(/(?:^|[^0-9])(\d+)$/); return /^build-/i.test(tag) && m ? Number(m[1]) : 0; };

export function pickAsset(assets: GhAsset[], os: 'mac' | 'win' | 'other'): GhAsset | null {
  const by = (re: RegExp) => assets.find((a) => re.test(a.name)) ?? null;
  if (os === 'mac') return by(/\.dmg$/i);
  if (os === 'win') return by(/setup\.exe$/i) ?? by(/\.exe$/i) ?? by(/\.msi$/i);
  return null;
}


/** 1.0.12 → 12 (the workflow sets the version to 1.0.<build number>). */
export const buildOfVersion = (v: string) => { const m = v.match(/^\d+\.\d+\.(\d+)$/); return m ? Number(m[1]) : 0; };
