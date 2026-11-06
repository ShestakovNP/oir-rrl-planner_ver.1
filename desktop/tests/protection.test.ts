import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLink } from '../src/data/calc/link';
import { defaultProtection, fdImprovement, sdImprovement } from '../src/data/calc/protection';
import { baseLink } from '../src/data/samples';
import { MODES_6G } from './fixtures';
import type { Site } from '../src/data/types';

/** A 50 km flat 6 GHz hop: long enough for multipath to matter. */
const sample = () => {
  const A: Site = { id: 'a', projectId: 'p', name: 'A', code: '', lat: 56.0, lon: 84.0, groundM: 150, notes: '' };
  const B: Site = { id: 'b', projectId: 'p', name: 'B', code: '', lat: 56.45, lon: 84.0, groundM: 150, notes: '' };
  const l = baseLink('p', 'a', 'b');
  Object.assign(l, { hA: 70, hB: 70, dishA: 1.8, dishB: 1.8 });
  l.channels[0].modes = MODES_6G.map((m) => ({ ...m }));
  l.profile = Array.from({ length: 21 }, (_, i) => ({ d: (50.1 * i) / 20, g: 150, c: 0 }));
  return { l, A, B };
};

test('P.530 improvement factors grow with margin and spacing', () => {
  assert.ok(sdImprovement(12, 6, 40, 1, 30, 0) > sdImprovement(6, 6, 40, 1, 30, 0));
  assert.ok(sdImprovement(12, 6, 40, 1, 35, 0) > sdImprovement(12, 6, 40, 1, 25, 0));
  assert.ok(sdImprovement(12, 6, 40, 1, 30, 10) < sdImprovement(12, 6, 40, 1, 30, 0));
  assert.equal(sdImprovement(0, 6, 40, 1, 30, 0), 1);
  assert.ok(fdImprovement(0.2, 6, 40, 30) > 1);
});

test('space diversity never worsens multipath outage, rain and level are unchanged', () => {
  const { l, A, B } = sample();
  const base = calculateLink(l, A, B).channels[0];
  const sd = calculateLink({ ...l, protection: defaultProtection(l, 'sd') }, A, B).channels[0];
  const m0 = base.ref!, m1 = sd.modes.find((m) => m.name === m0.name)!;
  assert.ok(sd.div && sd.div.a && sd.div.b);
  assert.ok(m1.mpYear <= m0.mpYear, `${m1.mpYear} <= ${m0.mpYear}`);
  assert.ok(sd.div!.b!.I >= 1 && sd.div!.b!.S === 12);
  assert.equal(m1.rainYear, m0.rainYear);
  assert.equal(m1.prx, m0.prx);
  assert.ok(sd.marginRequired <= base.marginRequired);
});

test('with a low multipath activity space diversity gives a real improvement', () => {
  const { l, A, B } = sample();
  const calm = { ...l, climate: { ...l.climate, dN1: -150 } };
  const base = calculateLink(calm, A, B).channels[0];
  const sd = calculateLink({ ...calm, protection: { ...defaultProtection(calm, 'sd'), hA2: 50, hB2: 50 } }, A, B).channels[0];
  const m0 = base.ref!, m1 = sd.modes.find((m) => m.name === m0.name)!;
  assert.ok(sd.div!.I > 1.5, `I = ${sd.div!.I}`);
  assert.ok(m1.mpYear < m0.mpYear);
});

test('hot standby costs coupler loss on both ends', () => {
  const { l, A, B } = sample();
  const base = calculateLink(l, A, B).channels[0];
  const hsb = calculateLink({ ...l, protection: { ...defaultProtection(l, 'hsb'), hsbLossDb: 1.5 } }, A, B).channels[0];
  assert.ok(Math.abs(base.ref!.prx - hsb.modes.find((m) => m.name === base.ref!.name)!.prx - 3) < 1e-9);
});
