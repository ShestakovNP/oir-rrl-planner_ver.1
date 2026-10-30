import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLink } from '../src/data/calc/link';
import { fresnelWater } from '../src/data/calc/water';
import { MODES_6G, baseLink } from '../src/data/samples';
import type { Site } from '../src/data/types';

const A: Site = { id: 'a', projectId: 'p', name: 'A', code: '', lat: 56.0, lon: 84.0, groundM: 100, notes: '' };
const B: Site = { id: 'b', projectId: 'p', name: 'B', code: '', lat: 56.18, lon: 84.0, groundM: 100, notes: '' };

function lakeLink(fMHz: number, water = true) {
  const l = baseLink('p', 'a', 'b');
  l.hA = 30; l.hB = 30; l.dishA = 0.6; l.dishB = 0.6;
  l.channels[0].freqMHz = fMHz;
  l.channels[0].modes = MODES_6G.map((m) => ({ ...m }));
  const D = 20.03;
  l.profile = Array.from({ length: 41 }, (_, i) => {
    const d = (D * i) / 40;
    return water && d > 2 && d < 18 ? { d, g: 100, c: 0, t: 'w' as const } : { d, g: 100, c: 0 };
  });
  return l;
}

test('Fresnel coefficient of water: near −1 at grazing incidence, V lower than H', () => {
  const h = fresnelWater(6, 0.005, 'H'), v = fresnelWater(6, 0.005, 'V');
  assert.ok(Math.hypot(...h) > 0.98);
  assert.ok(h[0] < -0.9);
  assert.ok(Math.hypot(...v) < Math.hypot(...h));
});

test('reflection over a lake is found in the middle and fades deeply', () => {
  const r = calculateLink(lakeLink(6000), A, B);
  const w = r.channels[0].refl;
  assert.ok(w, 'reflection expected');
  assert.ok(Math.abs(w!.d - r.path.D / 2) < 0.5, `point ${w!.d}`);
  assert.ok(w!.rho > 0.5, `rho ${w!.rho}`);
  assert.ok(w!.worst > 6, `worst ${w!.worst}`);
  assert.ok(w!.spacingA > 1 && w!.spacingA < 30, `spacing ${w!.spacingA}`);
  assert.ok(r.water > 0.7);
  const dry = calculateLink(lakeLink(6000, false), A, B);
  assert.equal(dry.channels[0].refl, null);
  assert.ok(Math.abs(dry.channels[0].ref!.prx - r.channels[0].ref!.prx - w!.applied) < 1e-6);
});

test('at E-band waves scatter the reflection (roughness)', () => {
  const w = calculateLink(lakeLink(80000), A, B).channels[0].refl!;
  const w6 = calculateLink(lakeLink(6000), A, B).channels[0].refl!;
  assert.ok(w.roughness < 0.8 && w6.roughness > 0.99, `roughness ${w.roughness} / ${w6.roughness}`);
  assert.ok(w.discA < w6.discA, 'narrow E-band beam rejects the reflected ray better');
});
