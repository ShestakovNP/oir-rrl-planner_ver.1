/**
 * Interference between links that start at the same object and use overlapping frequencies.
 *
 * Our receiver at object X points at the far end Y of our link. Another link from the same
 * object X goes to Z; its transmitter at Z points straight at X on a frequency that overlaps
 * ours. That signal reaches our receiver through the side of our antenna pattern at the angle
 * between the directions X→Y and X→Z (reference pattern ITU-R F.699). Orthogonal polarization
 * adds the antenna XPD when it is entered. Pure functions: no UI.
 */
import type { Channel, Link, Pol, Site } from '../types';
import { dishGain, fsl } from './physics';
import { vincenty } from './geo';

export interface Neighbor { link: Link; A: Site; B: Site }

export interface Interferer {
  /** Other link, as «X — Z». */
  name: string;
  /** Object where our receiver is hit. */
  at: 'A' | 'B';
  /** Angle between our antenna axis and the direction to the interfering transmitter, degrees. */
  theta: number;
  /** Our antenna gain towards the interferer (F.699), dBi. */
  gTheta: number;
  /** Polarization discrimination applied, dB. */
  xpd: number;
  samePol: boolean;
  fMHz: number;
  /** Interference power at our receiver input, dBm. */
  I: number;
}

export interface InterferenceResult {
  list: Interferer[];
  /** Summed interference at our receivers at A and at B, dBm (null = none). */
  IA: number | null;
  IB: number | null;
}

/** ITU-R F.699 reference radiation pattern of a line-of-sight antenna, dBi. */
export function f699(theta: number, gMax: number, dM: number, fGHz: number): number {
  const lam = 0.299792458 / fGHz;
  const dl = dM / lam;
  const th = Math.abs(theta) % 360 > 180 ? 360 - (Math.abs(theta) % 360) : Math.abs(theta) % 360;
  const g1 = 2 + 15 * Math.log10(dl);
  const thm = (20 / dl) * Math.sqrt(Math.max(0, gMax - g1));
  if (th < thm) return gMax - 2.5e-3 * (dl * th) ** 2;
  if (dl >= 100) {
    const thr = 15.85 * Math.pow(dl, -0.6);
    if (th < Math.max(thm, thr)) return g1;
    if (th < 48) return 32 - 25 * Math.log10(th);
    return -10;
  }
  if (th < 100 / dl) return g1;
  if (th < 48) return 52 - 10 * Math.log10(dl) - 25 * Math.log10(th);
  return 10 - 10 * Math.log10(dl);
}

const overlap = (f1: number, bw1: number, f2: number, bw2: number) => Math.abs(f1 - f2) < ((bw1 || 0) + (bw2 || 0)) / 2 || f1 === f2;
const sumDbm = (xs: number[]) => (xs.length ? 10 * Math.log10(xs.reduce((s, x) => s + Math.pow(10, x / 10), 0)) : null);
const angDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % 360) + 360) % 360; return d > 180 ? 360 - d : d; };

/**
 * Interference into one stem of our link from the other links of the project that share
 * an object with it. `pol` lets the polarization comparison test the other polarization.
 */
export function coSiteInterference(link: Link, A: Site, B: Site, ch: Channel, pol: Pol, gA: number, gB: number, neighbors: Neighbor[]): InterferenceResult {
  const list: Interferer[] = [];
  const fGHz = ch.freqMHz / 1000;
  if (!(fGHz > 0)) return { list, IA: null, IB: null };
  for (const at of ['A', 'B'] as const) {
    const X = at === 'A' ? A : B, Y = at === 'A' ? B : A;
    const gMax = at === 'A' ? gA : gB, dish = at === 'A' ? link.dishA : link.dishB;
    const feederX = at === 'A' ? link.feederA : link.feederB;
    const xpdX = at === 'A' ? link.xpdA : link.xpdB;
    const azOur = vincenty(X.lat, X.lon, Y.lat, Y.lon).az1;
    for (const nb of neighbors) {
      if (nb.link.id === link.id) continue;
      const nAtX = nb.link.siteA === X.id ? 'A' : nb.link.siteB === X.id ? 'B' : null;
      if (!nAtX) continue;
      const Z = nAtX === 'A' ? nb.B : nb.A;
      if (!Z || Z.id === X.id) continue;
      const geo = vincenty(X.lat, X.lon, Z.lat, Z.lon);
      if (!(geo.km > 0.01)) continue;
      const theta = angDiff(azOur, geo.az1);
      nb.link.channels.forEach((c, i) => {
        if (!(i === 0 || c.enabled) || !(c.freqMHz > 0) || !overlap(c.freqMHz, c.bwMHz, ch.freqMHz, ch.bwMHz)) return;
        const ptx = Math.max(-Infinity, ...c.modes.map((m) => m.txDbm).filter(Number.isFinite));
        if (!Number.isFinite(ptx)) return;
        const fN = c.freqMHz / 1000;
        // transmitter at Z of the other link, aimed at X
        const gZ = (nAtX === 'A' ? c.gainB : c.gainA) ?? dishGain(nAtX === 'A' ? nb.link.dishB : nb.link.dishA, fN);
        const feederZ = nAtX === 'A' ? nb.link.feederB : nb.link.feederA;
        const gTheta = f699(theta, gMax, dish, fGHz);
        const samePol = c.pol === pol;
        const xpd = samePol ? 0 : xpdX ?? 0;
        const I = ptx + gZ - feederZ - fsl(fN, geo.km) + gTheta - feederX - xpd;
        list.push({ name: `${X.name || '?'} — ${Z.name || '?'}`, at, theta, gTheta, xpd, samePol, fMHz: c.freqMHz, I });
      });
    }
  }
  return { list, IA: sumDbm(list.filter((x) => x.at === 'A').map((x) => x.I)), IB: sumDbm(list.filter((x) => x.at === 'B').map((x) => x.I)) };
}
