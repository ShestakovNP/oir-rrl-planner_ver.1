import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLink } from '../src/data/calc/link';
import { f699 } from '../src/data/calc/interference';
import { MODES_6G, baseLink } from '../src/data/samples';
import type { Link, Site } from '../src/data/types';

const site = (id: string, lat: number, lon: number): Site => ({ id, projectId: 'p', name: id, code: '', lat, lon, groundM: 150, notes: '' });
const X = site('X', 56.0, 84.0), Y = site('Y', 56.1, 84.0), Z1 = site('Z1', 56.0, 84.16), Z2 = site('Z2', 56.09, 84.03);

const mk = (a: Site, b: Site, f: number, pol: 'H' | 'V' = 'H'): Link => {
  const l = baseLink('p', a.id, b.id);
  l.id = `${a.id}-${b.id}`;
  Object.assign(l, { hA: 60, hB: 60, dishA: 0.6, dishB: 0.6 });
  l.channels[0] = { ...l.channels[0], freqMHz: f, pol, modes: MODES_6G.map((m) => ({ ...m })) };
  l.profile = Array.from({ length: 11 }, (_, i) => ({ d: (11.1 * i) / 10, g: 150, c: 0 }));
  return l;
};

test('F.699: full gain on axis, falls off the axis, floor behind', () => {
  assert.ok(Math.abs(f699(0, 30, 0.6, 6) - 30) < 1e-9);
  assert.ok(f699(10, 30, 0.6, 6) < 20);
  assert.ok(f699(90, 30, 0.6, 6) < 1 && f699(90, 38, 1.8, 6) < -5);
  assert.ok(f699(3, 38, 1.8, 6) < f699(3, 30, 0.6, 6), 'bigger dish — narrower beam');
});

test('a link from the same object on the same frequency degrades the threshold; another frequency does not', () => {
  const main = mk(X, Y, 6000);
  const all = (other: Link) => [main, other].map((l) => ({ link: l, A: [X, Y, Z1, Z2].find((s) => s.id === l.siteA)!, B: [X, Y, Z1, Z2].find((s) => s.id === l.siteB)! }));
  const alone = calculateLink(main, X, Y).channels[0];
  const near = calculateLink(main, X, Y, all(mk(X, Z2, 6000))).channels[0]; // small angle (~11°)
  const far = calculateLink(main, X, Y, all(mk(X, Z1, 6000))).channels[0]; // 90°
  const other = calculateLink(main, X, Y, all(mk(X, Z2, 6300))).channels[0];
  assert.equal(alone.intf, null);
  assert.ok(near.intf && near.intf.list.length === 1);
  assert.ok(near.intf!.list[0].theta > 5 && near.intf!.list[0].theta < 20, `theta ${near.intf!.list[0].theta}`);
  assert.ok(far.intf!.list[0].I < near.intf!.list[0].I - 15, 'wide angle — much weaker');
  assert.equal(other.intf, null, 'different frequency — no interference');
  const top = (c: typeof near) => c.modes.find((m) => m.name === 'QAM256')!;
  assert.ok(top(near).deg > top(far).deg && top(near).margin < top(alone).margin);
  const cross = calculateLink({ ...main, xpdA: 30, xpdB: 30 }, X, Y, all(mk(X, Z2, 6000, 'V'))).channels[0];
  assert.ok(cross.intf!.list[0].I < near.intf!.list[0].I - 29, 'orthogonal polarization with XPD 30 dB');
});
