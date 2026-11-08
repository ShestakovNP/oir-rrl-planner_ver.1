/** Satellite tree data over the network (see data/canopy.ts). Files are opened once per session. */
import { CogReader } from '../data/cog';
import { satelliteCanopy, type Canopy } from '../data/canopy';
import { httpRange } from './http';

const files = new Map<string, Promise<CogReader | null>>();

function openCog(url: string): Promise<CogReader | null> {
  let p = files.get(url);
  if (!p) {
    p = CogReader.open((s, e) => httpRange(url, s, e));
    p.catch(() => files.delete(url));
    files.set(url, p);
  }
  return p;
}

export function fetchCanopy(lat1: number, lon1: number, lat2: number, lon2: number, dKm: number, forestHeight: number, onProgress?: (f: number) => void): Promise<Canopy> {
  return satelliteCanopy(openCog, lat1, lon1, lat2, lon2, dKm, forestHeight, onProgress);
}
