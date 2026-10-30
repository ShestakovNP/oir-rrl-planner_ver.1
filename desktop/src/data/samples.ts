/** Starter data: equipment library templates and two worked example links. */
import { DEFAULT_CLIMATE, emptyChannel, type Library, type Link, type ModMode, type Project, type Site } from './types';
import { uid } from './ids';

export const MODES_6G: ModMode[] = [
  { name: 'QPSK', rateMbps: 39.2, txDbm: 24.5, thresholdDbm: -81 },
  { name: 'QAM16', rateMbps: 78.4, txDbm: 23.5, thresholdDbm: -75 },
  { name: 'QAM64', rateMbps: 117.6, txDbm: 22.5, thresholdDbm: -69 },
  { name: 'QAM256', rateMbps: 156.8, txDbm: 21, thresholdDbm: -62 }
];
export const MODES_8G: ModMode[] = [
  { name: 'QPSK', rateMbps: 39.2, txDbm: 23, thresholdDbm: -80.5 },
  { name: 'QAM16', rateMbps: 78.4, txDbm: 22, thresholdDbm: -74.5 },
  { name: 'QAM64', rateMbps: 117.6, txDbm: 21, thresholdDbm: -68.5 },
  { name: 'QAM256', rateMbps: 156.8, txDbm: 19.5, thresholdDbm: -61.5 }
];
export const MODES_EBAND: ModMode[] = [{ name: '256QAM', rateMbps: 1791, txDbm: 14.1, thresholdDbm: -50.5 }];

export function defaultLibrary(): Library {
  return {
    radios: [
      { id: uid(), name: 'Шаблон 6 ГГц, 28 МГц', band: '6 ГГц', modes: MODES_6G.map((m) => ({ ...m })), notes: 'Режимы из отчёта DRRL «Скумбрия — Скумбрия-2». Замените значениями из паспорта своего ППУ.' },
      { id: uid(), name: 'Шаблон 8 ГГц, 28 МГц', band: '8 ГГц', modes: MODES_8G.map((m) => ({ ...m })), notes: 'Типовые значения для примера. Замените значениями из паспорта.' },
      { id: uid(), name: 'E-band 80 ГГц, 250 МГц (оценка)', band: '80 ГГц', modes: MODES_EBAND.map((m) => ({ ...m })), notes: 'Мощность и порог восстановлены по уровню приёма и запасу из расчёта DRRL (Huawei RTN 380). Сверьте с паспортом.' }
    ],
    antennas: [0.3, 0.6, 1.0, 1.2, 1.8].map((d) => ({ id: uid(), name: `Параболическая ${String(d).replace('.', ',')} м`, diameterM: d, xpdDb: null, gains: [], notes: 'Шаблон. Внесите коэффициент усиления из паспорта; пока таблица пустая, КУ рассчитывается из диаметра.' }))
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

const SKUMBRIA_PROFILE: [number, number, number][] = [
  [0, 166, 0], [0.3, 165, 16], [0.6, 160, 0], [1.2, 159, 0], [1.8, 162, 10], [2.2, 165, 20], [2.6, 164, 0], [3.2, 166, 0], [3.5, 174, 22],
  [4.0, 176, 20], [4.6, 183, 20], [5.3, 181, 22], [6.0, 182, 20], [6.6, 180, 22], [7.2, 182, 20], [7.7, 184, 18], [8.3, 178, 18], [9.0, 170, 20],
  [9.6, 172, 18], [10.3, 176, 20], [11.0, 174, 18], [11.7, 178, 16], [12.3, 182, 16], [13.0, 176, 18], [13.8, 178, 16], [14.5, 180, 18],
  [15.2, 183, 20], [15.7, 186, 18], [16.0, 187, 18], [16.4, 185, 18], [17.0, 182, 16], [17.6, 178, 18], [18.2, 176, 0], [18.6, 180, 14],
  [19.3, 182, 16], [19.9, 178, 16], [20.4, 175, 0], [21.0, 178, 14], [21.5, 170, 0], [21.9, 174, 0], [22.201, 177, 0]
];

export interface SampleSet { project: Project; sites: Site[]; links: Link[] }

export function sampleProject(): SampleSet {
  const now = Date.now();
  const project: Project = { id: uid(), name: 'Примеры расчётов', notes: 'Два пролёта для знакомства с программой. Проект можно удалить.', createdAt: now, updatedAt: now };
  const site = (name: string, code: string, lat: number, lon: number, groundM: number, notes = ''): Site => ({ id: uid(), projectId: project.id, name, code, lat, lon, groundM, notes });
  const a = site('Скумбрия', '', 55.6, 38.1, 166, 'Координаты условные: подобраны под длину и азимут из отчёта DRRL.');
  const b = site('Скумбрия-2', '', 55.65289, 37.76024, 177, 'Координаты условные.');
  const m = site('Мельниково', '70.5108', 56.5486278, 84.0702556, 90);
  const s = site('Шегарка', '70.5304', 56.5639417, 84.0787056, 90);

  const l1 = baseLink(project.id, a.id, b.id);
  Object.assign(l1, { hA: 51, hB: 42, dishA: 1.8, dishB: 1.0, profileSource: 'manual' as const });
  l1.channels = [
    { ...emptyChannel(6000, 'H', true), gainA: 30, gainB: 30, radioName: 'Шаблон 6 ГГц, 28 МГц', modes: MODES_6G.map((x) => ({ ...x })) },
    { ...emptyChannel(8000, 'V', true), combinerLossDb: 0.5, radioName: 'Шаблон 8 ГГц, 28 МГц', modes: MODES_8G.map((x) => ({ ...x })) }
  ];
  l1.profile = SKUMBRIA_PROFILE.map(([d, g, c]) => ({ d, g, c }));

  const l2 = baseLink(project.id, m.id, s.id);
  Object.assign(l2, { hA: 42, hB: 27, dishA: 0.3, dishB: 0.3, profileSource: 'manual' as const });
  l2.channels = [
    { ...emptyChannel(78500, 'H', true), bwMHz: 250, radioName: 'E-band 80 ГГц, 250 МГц (оценка)', modes: MODES_EBAND.map((x) => ({ ...x })) },
    emptyChannel(81625, 'V', false)
  ];
  l2.climate = { ...DEFAULT_CLIMATE, rainR001: 20, availabilityPct: 99.9875 };
  l2.profile = [[0, 90, 0], [0.5, 90, 0], [1.0, 90, 0], [1.33, 90, 0], [1.34, 90, 12], [1.7, 90, 12], [1.782, 90, 0]].map(([d, g, c]) => ({ d, g, c }));
  l2.notes = 'Пролёт E-band из технического решения. Мощность и порог восстановлены по уровню приёма и запасу DRRL.';
  return { project, sites: [a, b, m, s], links: [l1, l2] };
}
