/** Cursor position along a link, shared by the map and the profile chart. t = 0 at site A, 1 at site B. */
import { useSyncExternalStore } from 'react';

export interface Hover { linkId: string; t: number; source: 'map' | 'chart' }
let cur: Hover | null = null;
const subs = new Set<() => void>();

export function setHover(h: Hover | null) {
  if (h === cur || (h && cur && h.linkId === cur.linkId && Math.abs(h.t - cur.t) < 1e-4 && h.source === cur.source)) return;
  cur = h;
  subs.forEach((f) => f());
}
export const getHover = () => cur;
export function subscribeHover(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export const useHover = () => useSyncExternalStore(subscribeHover, getHover, getHover);
