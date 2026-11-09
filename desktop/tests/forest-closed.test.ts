/** A path fully under forest with low antennas must not give a link (diffraction over many trees). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLink } from '../src/data/calc/link';
import { sampleProject } from './fixtures';

/** 44,8 km, ground 209 → 129 m rolling 130…165 m, forest 20 m almost everywhere, antennas 5 m. */
function forestPath() {
  const s = sampleProject();
  const base = s.links[0];
  const A = { ...s.sites.find((x) => x.id === base.siteA)!, lat: 57, lon: 84 };
  const B = { ...s.sites.find((x) => x.id === base.siteB)!, lat: 57, lon: 84 - 44.8 / (111.32 * Math.cos(57 * Math.PI / 180)) };
  const D = 44.8, pts = [];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i <= 448; i++) {
    const d = (D * i) / 448;
    const g = d < 1.5 ? 209 - (d / 1.5) * 70 : d > 44.3 ? 129 : 140 + 12 * Math.sin(d / 2.3) + 8 * Math.sin(d / 0.7) + 4 * rnd();
    const gap = rnd() < 0.12; // clearings
    pts.push({ d, g, c: d < 0.05 || gap ? 0 : 20, ...(d < 0.05 || gap ? {} : { t: 'f' as const }) });
  }
  const link = { ...base, siteA: A.id, siteB: B.id, hA: 5, hB: 5, dishA: 1.8, dishB: 1.8, profile: pts,
    channels: [{ ...base.channels[0], freqMHz: 7500, gainA: undefined, gainB: undefined }, { ...base.channels[1], enabled: false }] };
  return { link, A, B };
}

test('Закрытая лесом трасса с антеннами 5 м: связи нет', () => {
  const { link, A, B } = forestPath();
  const r = calculateLink(link as any, A, B);
  const c = r.channels[0];
  assert.ok(r.clearance.rel! < -1, 'трасса закрыта');
  assert.ok(c.modes.every((m) => m.margin < 0), 'ни один режим не работает');
  assert.equal(r.verdict.level, 'bad');
  assert.match(r.verdict.title, /закрыта препятствиями/);
  assert.ok(c.diffEdges.length >= 2, 'учтено больше одного препятствия');
});

test('Открытая трасса: потери на препятствиях нулевые', () => {
  const { link, A, B } = forestPath();
  const r = calculateLink({ ...link, hA: 120, hB: 120 } as any, A, B);
  assert.equal(r.channels[0].diff, 0);
  assert.equal(r.channels[0].diffEdges.length, 0);
});
