/** Online state: browser flag combined with the outcome of our own recent requests. */
import { useSyncExternalStore } from 'react';

export type NetState = 'online' | 'offline' | 'unstable';

let state: NetState = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
let failures = 0;
const listeners = new Set<() => void>();

function set(next: NetState) {
  if (next !== state) {
    state = next;
    listeners.forEach((l) => l());
  }
}

export function reportNetwork(ok: boolean) {
  if (ok) {
    failures = 0;
    set('online');
  } else {
    failures++;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) set('offline');
    else if (failures >= 3) set('unstable');
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { failures = 0; set('online'); });
  window.addEventListener('offline', () => set('offline'));
}

export function useNetState(): NetState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => state
  );
}
