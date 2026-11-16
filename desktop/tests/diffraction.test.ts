/** Diffraction over the profile: ITU-R P.526 multiple isolated cylinders. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cylinders, knifeJ, roundedT } from '../src/data/calc/physics';

const D = 40, f = 7, lambda = 0.299792458 / f;
/** Flat ground at 0 m every 20 m, antennas at 50 m, plus the given bumps. */
const profile = (bump: (d: number) => number) => Array.from({ length: 2001 }, (_, i) => ({ d: (D * i) / 2000, top: bump((D * i) / 2000) }));

test('Открытая трасса — потерь нет', () => {
  const c = cylinders(profile(() => 0), D, 50, 50, f);
  assert.equal(c.loss, 0);
  assert.equal(c.cylinders.length, 0);
});

test('Острое препятствие выше луча — как препятствие-нож', () => {
  const c = cylinders(profile((d) => (Math.abs(d - 15) < 1e-9 ? 56 : 0)), D, 50, 50, f);
  assert.equal(c.cylinders.length, 1);
  const d1 = 15000, d2 = 25000, v = 6 * Math.sqrt((2 * (d1 + d2)) / (lambda * d1 * d2));
  assert.ok(Math.abs(c.loss - knifeJ(v)) < 0.5, `${c.loss} vs ${knifeJ(v)}`);
});

test('Широкий холм теряет больше острого той же высоты (скругление T(m,n))', () => {
  const sharp = cylinders(profile((d) => (Math.abs(d - 20) < 1e-9 ? 58 : 0)), D, 50, 50, f);
  const hill = cylinders(profile((d) => Math.max(0, 58 - ((d - 20) * 1000) ** 2 / 2 / 20000)), D, 50, 50, f);
  assert.ok(hill.cylinders.some((c) => c.T > 1), 'есть добавка за скругление');
  assert.ok(hill.loss > sharp.loss + 1, `${hill.loss} > ${sharp.loss}`);
  assert.ok(roundedT(20000, 20000, 20000, 8, lambda) > 0);
});

test('Два препятствия — два цилиндра, потери больше, чем от каждого', () => {
  const one = cylinders(profile((d) => (Math.abs(d - 10) < 1e-9 ? 55 : 0)), D, 50, 50, f);
  const two = cylinders(profile((d) => (Math.abs(d - 10) < 1e-9 || Math.abs(d - 30) < 1e-9 ? 55 : 0)), D, 50, 50, f);
  assert.equal(two.cylinders.length, 2);
  assert.ok(two.loss > one.loss + 3, `${two.loss} > ${one.loss}`);
});

test('Препятствие ниже луча, но в зоне Френеля — небольшие потери', () => {
  const c = cylinders(profile((d) => (Math.abs(d - 20) < 1e-9 ? 48 : 0)), D, 50, 50, f);
  assert.equal(c.cylinders.length, 0);
  assert.ok(c.loss > 0 && c.loss < 6, `${c.loss}`);
});

test('Точность наведения: антенна 1,8 м на 7 ГГц', async () => {
  const { beamwidth, pointingLoss, pointingTolerance } = await import('../src/data/calc/physics');
  const b = beamwidth(1.8, 7);
  assert.ok(Math.abs(b - 1.67) < 0.01, `${b}`);
  assert.ok(Math.abs(pointingLoss(1, b) - 4.3) < 0.1);
  assert.ok(Math.abs(pointingLoss(pointingTolerance(1, b), b) - 1) < 1e-9);
});
