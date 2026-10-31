/**
 * Hop protection (redundancy) and diversity improvement, ITU-R P.530:
 *  - space diversity (two antennas at different heights on one object), §2.3.1 of P.530 section 8;
 *  - frequency diversity (two frequencies), the same section;
 *  - hot standby 1+1 adds coupler loss and protects against equipment failure only.
 * Diversity reduces multipath outage only; rain fades hit both branches at once.
 * Pure functions: no UI.
 */
import type { Link, Protection, ProtectionScheme } from '../types';

export const SCHEME_NAMES: Record<ProtectionScheme, string> = {
  '1+0': 'Без резервирования (1+0)',
  hsb: 'Горячий резерв (1+1 HSB)',
  sd: 'Разнесённый приём (1+1 SD)',
  fd: 'Частотное разнесение (1+1 FD)'
};
export const SCHEME_SHORT: Record<ProtectionScheme, string> = { '1+0': '1+0', hsb: '1+1 HSB', sd: '1+1 SD', fd: '1+1 FD' };

/** Sensible starting values when a scheme is first chosen. */
export function defaultProtection(link: Pick<Link, 'hA' | 'hB' | 'dishA' | 'dishB' | 'feederA' | 'feederB' | 'channels'>, scheme: ProtectionScheme): Protection {
  const below = (h: number) => Math.max(3, Math.round(h - 12));
  const f = link.channels[0]?.freqMHz || 6000;
  return {
    scheme,
    sdA: true,
    sdB: true,
    hA2: below(link.hA),
    hB2: below(link.hB),
    dishA2: link.dishA,
    dishB2: link.dishB,
    feederA2: link.feederA,
    feederB2: link.feederB,
    hsbLossDb: 1.5,
    fdSpacingMHz: Math.max(28, Math.round((f * 0.02) / 7) * 7)
  };
}

export function protectionOf(link: Pick<Link, 'protection'>): Protection | null {
  const p = link.protection;
  return p && p.scheme !== '1+0' ? p : null;
}

/**
 * Space diversity improvement factor I (≥ 1), P.530:
 * I = [1 − exp(−0.04 · S^0.87 · f^−0.12 · d^0.48 · p0^−1.04)] · 10^((A − V)/10)  (p0 in %;
 * the same as 3.34·10⁻⁴ with p0 as a fraction)
 * S — vertical spacing of the antennas, m; f — GHz; d — km; A — fade depth (margin), dB;
 * V — difference of the levels received by the two antennas, dB; p0 — multipath occurrence factor, %.
 */
export function sdImprovement(S: number, fGHz: number, dKm: number, p0: number, A: number, V: number): number {
  if (!(S > 0) || !(p0 > 0) || A <= 0) return 1;
  const k = 1 - Math.exp(-0.04 * Math.pow(S, 0.87) * Math.pow(fGHz, -0.12) * Math.pow(dKm, 0.48) * Math.pow(p0, -1.04));
  return Math.max(1, k * Math.pow(10, (A - Math.abs(V)) / 10));
}

/**
 * Frequency diversity improvement factor I (≥ 1), P.530:
 * I = (80 / (f·d)) · (Δf / f) · 10^(F/10), f and Δf in GHz, d in km, F — fade margin, dB.
 */
export function fdImprovement(dfGHz: number, fGHz: number, dKm: number, F: number): number {
  if (!(dfGHz > 0) || F <= 0) return 1;
  return Math.max(1, (80 / (fGHz * dKm)) * (dfGHz / fGHz) * Math.pow(10, F / 10));
}

/** Ranges where the P.530 diversity formulas were validated (results outside are an extrapolation). */
export function diversityValidity(scheme: ProtectionScheme, fGHz: number, dKm: number, S?: number, dfOverF?: number): string[] {
  const out: string[] = [];
  if (scheme === 'sd') {
    if (fGHz < 2 || fGHz > 11) out.push(`частота ${fGHz.toFixed(1).replace('.', ',')} ГГц (формула проверена для 2–11 ГГц)`);
    if (dKm < 43 || dKm > 240) out.push(`длина ${dKm.toFixed(1).replace('.', ',')} км (проверена для 43–240 км)`);
    if (S != null && (S < 3 || S > 23)) out.push(`разнос ${S.toFixed(1).replace('.', ',')} м (проверен для 3–23 м)`);
  }
  if (scheme === 'fd') {
    if (fGHz < 2 || fGHz > 11) out.push(`частота ${fGHz.toFixed(1).replace('.', ',')} ГГц (формула проверена для 2–11 ГГц)`);
    if (dKm < 30 || dKm > 70) out.push(`длина ${dKm.toFixed(1).replace('.', ',')} км (проверена для 30–70 км)`);
    if (dfOverF != null && dfOverF > 0.05) out.push('разнос частот больше 5 % от частоты');
  }
  return out;
}
