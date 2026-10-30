/**
 * Cache of map tiles the user has already viewed (IndexedDB inside the app's
 * web view). Only viewed tiles are stored — no bulk prefetching, as the OSM
 * tile usage policy requires. Old entries are evicted when the cache grows.
 */
import { TILE_CACHE_FRESH_DAYS, TILE_CACHE_MAX } from '../config';
import { httpGet } from '../net/http';

const DB = 'oir-rrl-tiles';
const STORE = 'tiles';
interface Entry { url: string; blob: Blob; ts: number }

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore(STORE, { keyPath: 'url' });
          s.createIndex('ts', 'ts');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then((d) => new Promise<T | null>((resolve) => {
    if (!d) return resolve(null);
    try {
      const r = fn(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

let writes = 0;
async function prune() {
  const count = await tx<number>('readonly', (s) => s.count());
  if (count == null || count <= TILE_CACHE_MAX) return;
  const d = await db();
  if (!d) return;
  const toDelete = count - Math.floor(TILE_CACHE_MAX * 0.9);
  await new Promise<void>((resolve) => {
    let n = 0;
    const req = d.transaction(STORE, 'readwrite').objectStore(STORE).index('ts').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c || n >= toDelete) return resolve();
      c.delete();
      n++;
      c.continue();
    };
    req.onerror = () => resolve();
  });
}

const FRESH_MS = TILE_CACHE_FRESH_DAYS * 86400000;

/** Returns an image src for the tile: cached blob, freshly downloaded blob, or the plain URL as last resort. */
export async function tileSrc(url: string): Promise<string> {
  const cached = await tx<Entry>('readonly', (s) => s.get(url) as IDBRequest<Entry>);
  if (cached && Date.now() - cached.ts < FRESH_MS) return URL.createObjectURL(cached.blob);
  try {
    const res = await httpGet(url, { accept: 'image/*', timeoutMs: 15000 });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (blob.size > 0) {
      void tx('readwrite', (s) => s.put({ url, blob, ts: Date.now() } as Entry));
      if (++writes % 200 === 0) void prune();
    }
    return URL.createObjectURL(blob);
  } catch {
    if (cached) return URL.createObjectURL(cached.blob);
    return url;
  }
}

export async function tileCacheStats(): Promise<{ tiles: number; approxMb: number }> {
  const tiles = (await tx<number>('readonly', (s) => s.count())) ?? 0;
  let approxMb = tiles * 0.02;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) approxMb = est.usage / 1048576;
  } catch { /* estimate is optional */ }
  return { tiles, approxMb };
}

export async function clearTileCache(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}
