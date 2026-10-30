/**
 * Units for input fields with a value box and a unit selector.
 * Values are always stored in the base unit (metres, GHz, dBi); the unit only
 * changes how the number is shown and typed.
 */

export interface Unit<Id extends string = string> {
  id: Id;
  label: string;
  /** Converts a value typed in this unit to the base unit. */
  toBase(v: number): number;
  /** Converts a base-unit value to this unit for display. */
  fromBase(v: number): number;
}

const scale = <Id extends string>(id: Id, label: string, k: number): Unit<Id> => ({ id, label, toBase: (v) => v * k, fromBase: (v) => v / k });

export type LengthUnit = 'm' | 'cm' | 'mm';
export const LENGTH_UNITS: Unit<LengthUnit>[] = [scale('m', 'м', 1), scale('cm', 'см', 0.01), scale('mm', 'мм', 0.001)];

export type FreqUnit = 'GHz' | 'MHz' | 'kHz';
export const FREQ_UNITS: Unit<FreqUnit>[] = [scale('GHz', 'ГГц', 1), scale('MHz', 'МГц', 1e-3), scale('kHz', 'кГц', 1e-6)];

/**
 * Antenna gain, as written in the datasheet. дБ, дБи and дБм are taken as the same
 * number (gain relative to an isotropic radiator); дБм is offered because some
 * documents label gain that way. дБд is relative to a half-wave dipole: dBi = dBd + 2.15.
 */
export type GainUnit = 'dB' | 'dBi' | 'dBd' | 'dBm';
export const GAIN_UNITS: Unit<GainUnit>[] = [
  { id: 'dB', label: 'дБ', toBase: (v) => v, fromBase: (v) => v },
  { id: 'dBi', label: 'дБи', toBase: (v) => v, fromBase: (v) => v },
  { id: 'dBd', label: 'дБд', toBase: (v) => v + 2.15, fromBase: (v) => v - 2.15 },
  { id: 'dBm', label: 'дБм', toBase: (v) => v, fromBase: (v) => v }
];

export const findUnit = <Id extends string>(list: Unit<Id>[], id: string | undefined): Unit<Id> => list.find((u) => u.id === id) ?? list[0];
