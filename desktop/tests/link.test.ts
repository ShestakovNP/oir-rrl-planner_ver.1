/**
 * Reference checks of the calculation core against the two links verified
 * with DRRL. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLink } from '../src/data/calc/link';
import { parseCoord, vincenty } from '../src/data/calc/geo';
import { sampleProject } from '../src/data/samples';
import { minutesPerYear } from '../src/data/calc/format';

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('coordinates: DMS parsing', () => {
  near(parseCoord(`56°32'55.06"`), 56.548628, 1e-6, 'DMS');
  near(parseCoord('55,6'), 55.6, 1e-9, 'comma');
  near(parseCoord('37.5 W'), -37.5, 1e-9, 'west');
  assert.ok(Number.isNaN(parseCoord('')));
});

test('geodesy: Мельниково — Шегарка matches DRRL (1.782 km, 16.94° / 196.95°)', () => {
  const g = vincenty(parseCoord(`56°32'55.06"`), parseCoord(`84°04'12.92"`), parseCoord(`56°33'50.19"`), parseCoord(`84°04'43.34"`));
  near(g.km, 1.782, 0.002, 'distance');
  near(g.az1, 16.94, 0.02, 'azimuth A→B');
  near(g.az2, 196.95, 0.02, 'azimuth B→A');
});

const sample = sampleProject();
const site = (id: string) => sample.sites.find((s) => s.id === id)!;

test('E-band link: level, margin, tilt and availability', () => {
  const l = sample.links[1];
  const r = calculateLink(l, site(l.siteA), site(l.siteB));
  assert.equal(r.ok, true);
  const c = r.channels[0];
  const m = c.modes[0];
  near(m.prx, -31.4, 0.3, 'received level (DRRL −31.4 dBm)');
  near(m.margin, 19.1, 0.3, 'fade margin (DRRL 19.1 dB)');
  near(r.tiltA, -0.48, 0.02, 'elevation angle at Мельниково');
  near(r.tiltB, 0.48, 0.02, 'elevation angle at Шегарка');
  assert.equal(r.clearance.level, 'ok');
  assert.ok(m.ok, 'meets 0.0125 % objective');
  const minutes = minutesPerYear(m.u);
  assert.ok(minutes > 30 && minutes < 66, `downtime ${minutes} min/year within the DRRL ballpark and below the 66 min objective`);
  const pol = r.polarization.channels[0];
  assert.equal(pol.winner, 'V', 'vertical polarization is more stable in E-band rain');
});

test('Скумбрия: QAM16 guaranteed on 6 GHz as in DRRL, two channels evaluated', () => {
  const l = sample.links[0];
  const r = calculateLink(l, site(l.siteA), site(l.siteB));
  assert.equal(r.ok, true);
  assert.equal(r.channels.length, 2);
  const c1 = r.channels[0];
  assert.equal(c1.best?.name, 'QAM16');
  near(c1.modes[1].prx, -52.1, 0.5, 'QAM16 received level');
  assert.equal(r.clearance.level, 'warn', 'semi-open path');
  const raise = r.recs.find((x) => x.title === 'Поднимите антенны');
  assert.ok(raise, 'recommends raising antennas');
  assert.equal(r.coChannel, false);
});

test('co-channel same polarization is flagged', () => {
  const l = structuredClone(sample.links[0]);
  l.channels[1].freqMHz = 6000;
  l.channels[1].pol = 'H';
  const r = calculateLink(l, site(l.siteA), site(l.siteB));
  assert.ok(r.recs.some((x) => x.title === 'Стволы глушат друг друга'));
});

test('missing profile falls back to flat ground with a warning', () => {
  const l = structuredClone(sample.links[1]);
  l.profile = [];
  const r = calculateLink(l, site(l.siteA), site(l.siteB));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.length > 0);
});

test('XPD matters only when both channels share a frequency', () => {
  const base = sample.links[0];
  const A = site(base.siteA), B = site(base.siteB);
  // different bands: no XPD needed, no warning, no degradation
  const r0 = calculateLink(base, A, B);
  assert.equal(r0.coChannel, false);
  assert.ok(r0.channels.every((c) => c.modes.every((m) => m.deg === 0)));
  assert.ok(!r0.recs.some((x) => /развязку поляризаций/i.test(x.title)));
  // same frequency, H + V, XPD not entered: asks for it
  const l1 = structuredClone(base);
  l1.channels[1].freqMHz = 6000;
  const r1 = calculateLink(l1, A, B);
  assert.equal(r1.coChannel, true);
  assert.ok(r1.recs.some((x) => x.title === 'Укажите развязку поляризаций антенн'));
  // XPD entered: cross-polar interference reduces the margin
  const l2 = structuredClone(l1);
  l2.xpdA = 30; l2.xpdB = 30;
  const r2 = calculateLink(l2, A, B);
  assert.ok(r2.channels[0].modes.some((m) => m.deg > 0));
  assert.ok(r2.channels[0].modes[3].margin < r1.channels[0].modes[3].margin);
});
