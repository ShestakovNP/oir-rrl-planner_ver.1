/** Checks of the ГОСТ Р 53363-2009 module. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G_CRIT, diversity, gostRain, gostRainRate, kOfG, levelsOf, multipath, normalTail, regionStats, selectiveMargin, subrefraction
} from '../src/data/calc/gost';
import { calculateLink } from '../src/data/calc/link';
import { sampleProject } from '../src/data/samples';

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('ГОСТ: эквивалентный радиус и критический градиент', () => {
  near(kOfG(0), 1, 1e-12, 'g = 0 → k = 1');
  near(kOfG(-7.85e-8), 4 / 3, 0.01, 'k = 4/3');
  assert.ok(kOfG(G_CRIT * 0.999) > 500, 'g → gкр: k → ∞');
});

test('ГОСТ: хвост нормального распределения (12.1)', () => {
  near(normalTail(0), 0.5, 1e-6, 'n = 0');
  near(normalTail(1.96), 0.025, 1e-4, 'n = 1,96');
  near(normalTail(3), 0.00135, 1e-5, 'n = 3');
});

test('ГОСТ: σ(R) растёт на коротких трассах (Б.1)', () => {
  const p = { region: 2, season: 'summer' as const, terrain: 'land' as const, rainTerritory: 0, kAppPct: 0, sesrNormPct: null };
  const long = regionStats(p, 60), short = regionStats(p, 10);
  near(long.sigmaR, 8e-8, 1e-15, 'R ≥ 50 км: σ без поправки');
  assert.ok(short.sigmaR > long.sigmaR, 'R = 10 км: σ(R) больше');
});

test('ГОСТ: субрефракция — открытая трасса не теряет связь', () => {
  assert.equal(subrefraction(() => 20, -10e-8, 8e-8).p, 0);
  const p = subrefraction((g) => 10 - (g + 10e-8) * 1e8, -10e-8, 8e-8);
  near(p.p, 100 * normalTail(10 / 8), 0.05, 'g0 = ḡ + 10·10⁻⁸');
});

test('ГОСТ: интенсивность дождя (16.1) для Томска ≈ 20 мм/ч', () => {
  near(gostRainRate(1.05, 56.5, 84.95), 20, 0.5, 'J');
});

test('ГОСТ: дождь — AS падает с ростом запаса', () => {
  const a = gostRain(20, 18, 'V', 10, 20, 56, 84).AS, b = gostRain(20, 18, 'V', 10, 30, 56, 84).AS, c = gostRain(20, 18, 'V', 10, 40, 56, 84).AS;
  assert.ok(a > b && b > c && c > 0, `${a} > ${b} > ${c}`);
});

test('ГОСТ: многолучёвость (13.1) и селективный запас', () => {
  const m = multipath(40, 8, 30, Infinity, 200, 1, 'land');
  near(m.p0, 8 ** 1.5 * 4.1e-4 * 1600, 1e-9, 'p0 для R > 20 км');
  near(m.pFlat, m.p0 * 1e-3, 1e-12, 'p пл = p0·10^(−F/10)');
  assert.deepEqual(levelsOf('QAM256'), { M: 256, psk: false });
  assert.deepEqual(levelsOf('QPSK'), { M: 4, psk: true });
  const f16 = selectiveMargin(0.1, 16, false, 40, 8, false), f256 = selectiveMargin(0.4, 256, false, 40, 8, false);
  assert.ok(f16 > f256, 'многопозиционная модуляция — меньше селективный запас');
  const coast = multipath(40, 8, 30, Infinity, 50, 1, 'coast');
  assert.ok(coast.p0 > m.p0, 'приморская трасса хуже сухопутной');
});

test('ГОСТ: разнесённый приём уменьшает замирания (14)', () => {
  const m = multipath(40, 8, 30, 40, 200, 1, 'land');
  const sd = diversity('sd', m, 8, 40, 30, { S: 10, coastal: false });
  const fd = diversity('fd', m, 8, 40, 30, { dfGHz: 0.3, coastal: false });
  assert.ok(sd.p < m.p && sd.I > 1, `SD ${sd.p} < ${m.p}`);
  assert.ok(fd.p < m.p && fd.I > 1, `FD ${fd.p} < ${m.p}`);
});

test('ГОСТ: расчёт пролёта переключается и даёт результат того же порядка, что МСЭ-R', () => {
  const s = sampleProject();
  const site = (id: string) => s.sites.find((x) => x.id === id)!;
  for (const l of s.links) {
    const itu = calculateLink(l, site(l.siteA), site(l.siteB));
    const gost = calculateLink({ ...l, climate: { ...l.climate, method: 'gost', gost: { region: 9, season: 'summer', terrain: 'land', rainTerritory: 8, kAppPct: 0, sesrNormPct: null } } }, site(l.siteA), site(l.siteB));
    assert.equal(gost.method, 'gost');
    assert.ok(gost.channels.every((c) => c.gost && c.modes.every((m) => m.g)), 'данные ГОСТ у всех режимов');
    near(gost.channels[0].modes[0].margin, itu.channels[0].modes[0].margin, 1, 'запас почти не зависит от методики');
    const ui = itu.channels[0].modes[0].u, ug = gost.channels[0].modes[0].u;
    assert.ok(ug < ui * 10 + 1e-4 && ug > ui / 10 - 1e-4, `неготовность ГОСТ ${ug} и МСЭ-R ${ui} одного порядка`);
  }
});
