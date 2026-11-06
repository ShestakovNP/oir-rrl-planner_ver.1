/** Test fixtures: reference links with known results. Not part of the app. */
import { DEFAULT_CLIMATE, emptyChannel, type Link, type ModMode, type Project, type Site } from '../src/data/types';
import { uid } from '../src/data/ids';
import { baseLink } from '../src/data/samples';

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

const PROFILE_1: [number, number, number][] = [
  [0, 166, 0], [0.3, 165, 16], [0.6, 160, 0], [1.2, 159, 0], [1.8, 162, 10], [2.2, 165, 20], [2.6, 164, 0], [3.2, 166, 0], [3.5, 174, 22],
  [4.0, 176, 20], [4.6, 183, 20], [5.3, 181, 22], [6.0, 182, 20], [6.6, 180, 22], [7.2, 182, 20], [7.7, 184, 18], [8.3, 178, 18], [9.0, 170, 20],
  [9.6, 172, 18], [10.3, 176, 20], [11.0, 174, 18], [11.7, 178, 16], [12.3, 182, 16], [13.0, 176, 18], [13.8, 178, 16], [14.5, 180, 18],
  [15.2, 183, 20], [15.7, 186, 18], [16.0, 187, 18], [16.4, 185, 18], [17.0, 182, 16], [17.6, 178, 18], [18.2, 176, 0], [18.6, 180, 14],
  [19.3, 182, 16], [19.9, 178, 16], [20.4, 175, 0], [21.0, 178, 14], [21.5, 170, 0], [21.9, 174, 0], [22.201, 177, 0]
];

export interface SampleSet { project: Project; sites: Site[]; links: Link[] }

/** Two reference links (from engineering reports) used by the calculation tests. */
export function sampleProject(): SampleSet {
  const now = Date.now();
  const project: Project = { id: uid(), name: 'Пример проекта', notes: 'Два пролёта для знакомства с программой. Проект можно удалить.', createdAt: now, updatedAt: now };
  const site = (name: string, code: string, lat: number, lon: number, groundM: number, notes = ''): Site => ({ id: uid(), projectId: project.id, name, code, lat, lon, groundM, notes });
  const a = site('Объект №1', '', 55.6, 38.1, 166, 'Координаты условные: подобраны под длину и азимут из эталонного отчёта.');
  const b = site('Объект №2', '', 55.65289, 37.76024, 177, 'Координаты условные.');
  const m = site('Объект №3', '70.5108', 56.5486278, 84.0702556, 90);
  const s = site('Объект №4', '70.5304', 56.5639417, 84.0787056, 90);

  const l1 = baseLink(project.id, a.id, b.id);
  Object.assign(l1, { hA: 51, hB: 42, dishA: 1.8, dishB: 1.0, profileSource: 'manual' as const });
  l1.channels = [
    { ...emptyChannel(6000, 'H', true), gainA: 30, gainB: 30, radioName: 'ППУ 6 ГГц, 28 МГц', modes: MODES_6G.map((x) => ({ ...x })) },
    { ...emptyChannel(8000, 'V', true), combinerLossDb: 0.5, radioName: 'ППУ 8 ГГц, 28 МГц', modes: MODES_8G.map((x) => ({ ...x })) }
  ];
  l1.profile = PROFILE_1.map(([d, g, c]) => ({ d, g, c }));

  const l2 = baseLink(project.id, m.id, s.id);
  Object.assign(l2, { hA: 42, hB: 27, dishA: 0.3, dishB: 0.3, profileSource: 'manual' as const });
  l2.channels = [
    { ...emptyChannel(78500, 'H', true), bwMHz: 250, radioName: 'ППУ E-band 80 ГГц, 250 МГц', modes: MODES_EBAND.map((x) => ({ ...x })) },
    emptyChannel(81625, 'V', false)
  ];
  l2.climate = { ...DEFAULT_CLIMATE, rainR001: 20, availabilityPct: 99.9875 };
  l2.profile = [[0, 90, 0], [0.5, 90, 0], [1.0, 90, 0], [1.33, 90, 0], [1.34, 90, 12], [1.7, 90, 12], [1.782, 90, 0]].map(([d, g, c]) => ({ d, g, c }));
  l2.notes = 'Пролёт E-band из технического решения. Мощность и порог восстановлены по уровню приёма и запасу эталонного расчёта.';
  return { project, sites: [a, b, m, s], links: [l1, l2] };
}
