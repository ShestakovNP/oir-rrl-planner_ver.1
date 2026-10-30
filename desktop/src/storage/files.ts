/** Native "Save as" / "Open" dialogs in the desktop app, browser fallbacks in dev mode. */
import { isTauri } from '../platform';

export interface FileFilter { name: string; extensions: string[] }

/** Returns the saved path (desktop), 'download' (browser) or null when the user cancelled. */
export async function saveFile(defaultName: string, data: Uint8Array | string, filters: FileFilter[]): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return null;
    const fs = await import('@tauri-apps/plugin-fs');
    if (typeof data === 'string') await fs.writeTextFile(path, data);
    else await fs.writeFile(path, data);
    return path;
  }
  const ext = filters[0]?.extensions[0];
  const type = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'application/octet-stream';
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'download';
}

/** Lets the user pick a text file; returns its name and contents or null. */
export async function openTextFile(filters: FileFilter[]): Promise<{ name: string; text: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters });
    if (!path || Array.isArray(path)) return null;
    const fs = await import('@tauri-apps/plugin-fs');
    const text = await fs.readTextFile(path);
    return { name: String(path).split(/[\\/]/).pop() || String(path), text };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'export';
