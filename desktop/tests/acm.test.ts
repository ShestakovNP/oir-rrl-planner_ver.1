import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acmAverageRate, momentsRain } from '../src/data/calc/acm';

test('ACM average rate: between the lowest and the highest rate, weighted by availability', () => {
  const modes = [{ rateMbps: 100, u: 0.01 }, { rateMbps: 200, u: 0.1 }, { rateMbps: 400, u: 1 }];
  // 400·(1−0.01) + 200·(0.01−0.001) + 100·(0.001−0.0001)
  const want = 400 * 0.99 + 200 * 0.009 + 100 * 0.0009;
  assert.ok(Math.abs(acmAverageRate(modes) - want) < 1e-9);
  assert.equal(acmAverageRate([]), 0);
  assert.equal(acmAverageRate([{ rateMbps: 50, u: 100 }]), 0);
});

test('method of moments reproduces Pd, mean and variance of the rain fade', () => {
  const pd = 3, asr = 6, da = 60; // %, dB, dB²
  const m = momentsRain(pd, asr, da)!;
  assert.ok(m && m.beta > 0 && m.delta > 0 && m.delta <= 1);
  // numeric moments of A < 0
  let P = 0, M1 = 0, M2 = 0;
  const F = (A: number) => m.pFor(-A) / 100;
  for (let A = -400; A < -1e-4; A += 0.005) { const dF = F(A + 0.005) - F(A); P += dF; M1 += (A + 0.0025) * dF; M2 += (A + 0.0025) ** 2 * dF; }
  assert.ok(Math.abs(P - pd / 100) < 1e-3, `Pd ${P}`);
  const mean = M1 / P, varr = M2 / P - mean * mean;
  assert.ok(Math.abs(mean + asr) < 0.05, `mean ${mean}`);
  assert.ok(Math.abs(varr - da) / da < 0.02, `var ${varr}`);
  assert.equal(momentsRain(3, 6, 20), null, 'variance below Asr² is not allowed');
  assert.ok(m.pFor(30) < m.pFor(10));
});
