/** Russian number and duration formatting shared by the UI and the PDF report. */

export function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Unavailability in percent of time. */
export function pct(u: number): string {
  if (!Number.isFinite(u)) return '—';
  if (u === 0) return '0 %';
  if (u < 0.0001) return '< 0,0001 %';
  const d = u < 0.001 ? 5 : u < 0.01 ? 4 : u < 1 ? 3 : 2;
  return fmt(u, d) + ' %';
}

const MIN_PER_YEAR = 525960;

/** Converts unavailability (% of a year) to a readable duration. */
export function downtime(u: number): string {
  const m = (u / 100) * MIN_PER_YEAR;
  if (!Number.isFinite(m)) return '—';
  if (m < 1) return '< 1 мин';
  if (m < 120) return Math.round(m) + ' мин';
  if (m < 48 * 60) return fmt(m / 60, 1) + ' ч';
  return fmt(m / 1440, 0) + ' сут';
}

export const minutesPerYear = (u: number) => (u / 100) * MIN_PER_YEAR;

export const polName = (p: 'H' | 'V') => (p === 'V' ? 'вертикальная' : 'горизонтальная');
export const polLong = (p: 'H' | 'V') => (p === 'V' ? 'Вертикальная (V)' : 'Горизонтальная (H)');

export function ghz(fMHz: number): string {
  const g = fMHz / 1000;
  return fmt(g, Number.isInteger(g) ? 0 : g * 10 === Math.round(g * 10) ? 1 : 2) + ' ГГц';
}

/** Removes the **bold** markers used in recommendation texts. */
export const stripMarks = (s: string) => s.replace(/\*\*/g, '');
