/** Starter data: the equipment library (no radios, antenna templates by diameter) and a blank link. */
import { DEFAULT_CLIMATE, emptyChannel, type Library, type Link } from './types';
import { uid } from './ids';

export function defaultLibrary(): Library {
  return {
    // Radios start empty: each engineer adds their own from the datasheet (or saves them from an imported project).
    radios: [],
    antennas: [0.3, 0.6, 1.0, 1.2, 1.8].map((d) => ({ id: uid(), name: `Параболическая ${String(d).replace('.', ',')} м`, diameterM: d, xpdDb: null, gains: [], notes: 'Внесите коэффициент усиления из паспорта; пока таблица пустая, КУ рассчитывается из диаметра.' }))
  };
}

export function baseLink(projectId: string, siteA: string, siteB: string): Link {
  return {
    id: uid(), projectId, siteA, siteB, hA: 30, hB: 30, dishA: 0.6, dishB: 0.6, antennaA: '', antennaB: '', xpdA: null, xpdB: null,
    feederA: 0, feederB: 0, otherLoss: 0,
    channels: [emptyChannel(6000, 'H', true), emptyChannel(8000, 'V', false)],
    climate: { ...DEFAULT_CLIMATE }, profile: [], profileSource: 'none', profileFetchedAt: null, declination: null, notes: '', updatedAt: Date.now()
  };
}

/**
 * Radios that earlier versions put into the library themselves (templates and example data).
 * Only such an entry is removed by the one-time cleanup: its name or notes mark it as a template
 * AND its modulation table is exactly the one those versions shipped. Anything the user typed in
 * (other numbers, other rows) is never touched.
 */
const OLD_TEMPLATE_MODES: [string, number, number, number][][] = [
  [['QPSK', 39.2, 24.5, -81], ['QAM16', 78.4, 23.5, -75], ['QAM64', 117.6, 22.5, -69], ['QAM256', 156.8, 21, -62]],
  [['QPSK', 39.2, 23, -80.5], ['QAM16', 78.4, 22, -74.5], ['QAM64', 117.6, 21, -68.5], ['QAM256', 156.8, 19.5, -61.5]],
  [['256QAM', 1791, 14.1, -50.5]]
];
export function isOldTemplateRadio(r: { name: string; notes?: string; modes: { name: string; rateMbps: number; txDbm: number; thresholdDbm: number }[] }): boolean {
  const marked = /^\s*Шаблон/i.test(r.name) || /^E-band 80 ГГц, 250 МГц/i.test(r.name) || /Скумбри|DRRL|Шаблон/i.test(r.notes || '');
  if (!marked) return false;
  const sig = r.modes.map((m) => [m.name, m.rateMbps, m.txDbm, m.thresholdDbm].join('|')).join(';');
  return OLD_TEMPLATE_MODES.some((t) => t.map((m) => m.join('|')).join(';') === sig);
}
