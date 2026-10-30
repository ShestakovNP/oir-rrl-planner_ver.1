/** Buildings and forest merged into the profile (no network: synthetic OSM objects). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyClutter, type ClutterObject } from '../src/data/calc/clutter';
import { intermediate } from '../src/data/calc/geo';

const A = [56.5486, 84.0703] as const, B = [56.5639, 84.0787] as const; // ≈1.78 km
const square = (t: number, halfDeg: number): ClutterObject => {
  const [la, lo] = intermediate(A[0], A[1], B[0], B[1], t);
  const ring: [number, number][] = [[la - halfDeg, lo - halfDeg * 1.8], [la - halfDeg, lo + halfDeg * 1.8], [la + halfDeg, lo + halfDeg * 1.8], [la + halfDeg, lo - halfDeg * 1.8]];
  return { kind: 'building', height: 0, measured: true, ring, bbox: [la - halfDeg, lo - halfDeg * 1.8, la + halfDeg, lo + halfDeg * 1.8] };
};

test('a building on the path raises clutter only where it stands', () => {
  const ground = [{ d: 0, g: 90, c: 0 }, { d: 1.782, g: 90, c: 0 }];
  const b = { ...square(0.5, 0.0002), height: 25 };
  const r = applyClutter(ground, A[0], A[1], B[0], B[1], [b], { forestHeight: 20 });
  const mid = r.profile.reduce((best, p) => (Math.abs(p.d - 0.891) < Math.abs(best.d - 0.891) ? p : best));
  assert.equal(mid.c, 25);
  assert.equal(r.profile[0].c, 0);
  assert.equal(r.profile[r.profile.length - 1].c, 0);
  assert.equal(r.buildings, 1);
  assert.ok(r.coverage > 0 && r.coverage < 0.1, `coverage ${r.coverage}`);
});

test('forest uses the chosen height; the taller obstacle wins', () => {
  const ground = [{ d: 0, g: 90, c: 0 }, { d: 1.782, g: 90, c: 0 }];
  const forest = { ...square(0.7, 0.002), kind: 'forest' as const, height: 18, measured: false };
  const tower = { ...square(0.7, 0.0001), height: 40 };
  const r = applyClutter(ground, A[0], A[1], B[0], B[1], [forest, tower], { forestHeight: 18 });
  const cs = r.profile.map((p) => p.c);
  assert.ok(cs.includes(18) && cs.includes(40));
  assert.equal(r.forests, 1);
});

test('Overpass answer: heights from tags, levels, type; multipolygon outer ways joined', async () => {
  const { parseOverpass } = await import('../src/data/calc/clutter');
  const sq = (la: number, lo: number, d: number) => [[la, lo], [la, lo + d], [la + d, lo + d], [la + d, lo], [la, lo]].map(([a, b]) => ({ lat: a, lon: b }));
  const objs = parseOverpass({ elements: [
    { type: 'way', tags: { building: 'yes', height: '21 m' }, geometry: sq(56.55, 84.07, 0.0002) },
    { type: 'way', tags: { building: 'apartments', 'building:levels': '5' }, geometry: sq(56.551, 84.07, 0.0002) },
    { type: 'way', tags: { building: 'garage' }, geometry: sq(56.552, 84.07, 0.0001) },
    { type: 'relation', tags: { landuse: 'forest' }, members: [
      { role: 'outer', geometry: [{ lat: 56.56, lon: 84.07 }, { lat: 56.56, lon: 84.08 }, { lat: 56.57, lon: 84.08 }] },
      { role: 'outer', geometry: [{ lat: 56.57, lon: 84.08 }, { lat: 56.57, lon: 84.07 }, { lat: 56.56, lon: 84.07 }] }
    ] }
  ] }, { forestHeight: 22 });
  assert.deepEqual(objs.map((o) => [o.kind, o.height, o.measured]), [['building', 21, true], ['building', 17, true], ['building', 3, false], ['forest', 22, false]]);
  assert.ok(objs[3].ring.length >= 5, 'two open outer ways joined into one ring');
});
