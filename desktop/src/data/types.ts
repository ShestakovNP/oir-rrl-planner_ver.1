/** Domain model of ОИР RRL Planner. Everything here is plain JSON-serialisable data. */

export type Pol = 'H' | 'V';

export interface Project {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface Site {
  id: string;
  projectId: string;
  name: string;
  /** Base-station number or other internal code, e.g. "70.5304". */
  code: string;
  lat: number;
  lon: number;
  /** Ground elevation above sea level, m. null = unknown (taken from the profile). */
  groundM: number | null;
  notes: string;
}

/** One modulation mode of a radio, from the equipment datasheet. */
export interface ModMode {
  name: string;
  rateMbps: number;
  txDbm: number;
  thresholdDbm: number;
}

export interface Channel {
  enabled: boolean;
  freqMHz: number;
  bwMHz: number;
  pol: Pol;
  /** OMT / diplexer loss at each end, dB. */
  combinerLossDb: number;
  /** Antenna gain at this frequency, dBi. null = derive from the dish diameter. */
  gainA: number | null;
  gainB: number | null;
  radioName: string;
  modes: ModMode[];
}

export interface ProfilePoint {
  /** Distance from site A, km. */
  d: number;
  /** Ground elevation, m above sea level. */
  g: number;
  /** Clutter (forest, buildings) above ground, m. */
  c: number;
  /** What is at this point: b = building, f = forest, w = water surface; absent = open ground. */
  t?: 'b' | 'f' | 'w';
}

export interface Climate {
  /** Median effective Earth radius factor. */
  k: number;
  /** k exceeded 99.9 % of the time (sub-refraction). */
  kMin: number;
  /** Point refractivity gradient in the lowest 65 m, N-units/km (ITU-R P.453). */
  dN1: number;
  /** Rain rate exceeded 0.01 % of the time, mm/h. */
  rainR001: number;
  /** Gaseous attenuation, dB/km. null = from frequency (ITU-R P.676). */
  gasDbPerKm: number | null;
  /** Worst-month to average-year conversion factor for multipath. */
  monthToYear: number;
  /** Required availability, %. */
  availabilityPct: number;
}

export interface Link {
  id: string;
  projectId: string;
  siteA: string;
  siteB: string;
  hA: number;
  hB: number;
  dishA: number;
  dishB: number;
  antennaA: string;
  antennaB: string;
  /** Cross-polar discrimination from the antenna datasheet, dB. Only used when both channels share a frequency. */
  xpdA: number | null;
  xpdB: number | null;
  feederA: number;
  feederB: number;
  otherLoss: number;
  channels: [Channel, Channel];
  climate: Climate;
  profile: ProfilePoint[];
  profileSource: 'none' | 'manual' | 'srtm';
  profileFetchedAt: number | null;
  /** Where the clutter column (buildings, forest) came from. */
  clutterSource?: 'none' | 'manual' | 'osm';
  clutterFetchedAt?: number | null;
  clutterSummary?: string;
  /** Forest height used for OSM forest areas, m. */
  forestHeight?: number;
  /** Magnetic declination, degrees (east +). null = not set. */
  declination: number | null;
  notes: string;
  updatedAt: number;
}

/** Equipment library. */
export interface Radio {
  id: string;
  name: string;
  band: string;
  modes: ModMode[];
  notes: string;
}

export interface AntennaModel {
  id: string;
  name: string;
  diameterM: number;
  /** Unit the diameter is shown in (value is always stored in metres). */
  diameterUnit?: 'm' | 'cm' | 'mm';
  /** XPD from the datasheet, dB; null = not specified. Not shown in the antenna card. */
  xpdDb: number | null;
  /** Datasheet gains; between points the gain is interpolated. Stored in GHz / dBi, shown in the chosen units. */
  gains: { freqGHz: number; gainDbi: number; freqUnit?: 'GHz' | 'MHz' | 'kHz'; gainUnit?: 'dB' | 'dBi' | 'dBd' | 'dBm' }[];
  notes: string;
}

export interface Library {
  radios: Radio[];
  antennas: AntennaModel[];
}

export const DEFAULT_CLIMATE: Climate = {
  k: 1.33,
  kMin: 0.67,
  dN1: -400,
  rainR001: 30,
  gasDbPerKm: null,
  monthToYear: 0.25,
  availabilityPct: 99.98517
};

export function emptyChannel(freqMHz: number, pol: Pol, enabled: boolean): Channel {
  return { enabled, freqMHz, bwMHz: 28, pol, combinerLossDb: 0, gainA: null, gainB: null, radioName: '', modes: [] };
}
