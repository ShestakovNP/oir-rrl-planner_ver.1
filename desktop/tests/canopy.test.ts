/** Satellite trees: the COG reader on real GeoTIFF files (made with tifffile/libtiff) and the canopy along a path. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CogReader, floatPredictor } from '../src/data/cog';
import { canopyFromChm, canopyFromWorldCover, satelliteCanopy, CHM_URL, WORLDCOVER_URL, quadkey, worldCoverTile, type OpenCog } from '../src/data/canopy';
import { applyClutter } from '../src/data/calc/clutter';
import { vincenty } from '../src/data/calc/geo';

const file = (name: string) => readFileSync(new URL(`./data/${name}`, import.meta.url));
const ranged = (buf: Uint8Array, log?: number[]) => async (s: number, e: number) => { if (s >= buf.length) return null; const b = buf.subarray(s, Math.min(e, buf.length)); log?.push(b.length); return b; };
const A = { lat: 56.5, lon: 84.9 }, B = { lat: 56.53, lon: 84.9 };
const D = vincenty(A.lat, A.lon, B.lat, B.lon).km;

test('COG: BigTIFF, DEFLATE, предиктор — значения пикселей и привязка', async () => {
  const log: number[] = [];
  const r = (await CogReader.open(ranged(file('chm.tif'), log)))!;
  assert.equal(r.info.width, 400);
  assert.ok(Math.abs(r.info.sx - 1.2) < 1e-9);
  const fx = JSON.parse(file('fix.json').toString());
  const mid = Math.round((fx.chmRows[0] + fx.chmRows[1]) / 2);
  const [inForest, outside, beyond] = await r.pixels([[200, mid], [200, 5], [5000, 5]]);
  assert.equal(inForest, 24);
  assert.equal(outside, 0);
  assert.equal(beyond, null);
  assert.ok(log.length >= 3, 'заголовок, таблица тайлов и сам тайл — отдельными запросами');
});

test('TIFF: полосы и сжатие LZW (libtiff)', async () => {
  const r = (await CogReader.open(ranged(file('lzw.tif'))))!;
  const v = await r.pixels([[0, 0], [256, 0], [10, 299], [100, 150]]);
  const exp = (c: number, rr: number) => (rr * 257 + c) % 253;
  assert.deepEqual(v, [exp(0, 0), exp(256, 0), exp(10, 299), exp(100, 150)]);
});

test('Карта высот деревьев: лес 1–2 км с просекой, одиночные шумовые пиксели не дают деревьев', async () => {
  const qk = quadkey(A.lat, A.lon, 9);
  assert.equal(qk.length, 9);
  const open: OpenCog = async (url) => (url === CHM_URL(qk) ? CogReader.open(ranged(file('chm.tif'))) : null);
  const c = await canopyFromChm(open, A.lat, A.lon, B.lat, B.lon, D);
  assert.equal(c.source, 'chm');
  assert.equal(c.heightAt(1.5 / D), 24, 'в лесу высота деревьев 24 м');
  assert.equal(c.heightAt(0.5 / D), 0, 'до леса деревьев нет');
  assert.equal(c.heightAt(2.6 / D), 0, 'после леса деревьев нет');
  const share = c.share;
  assert.ok(share > 0.22 && share < 0.32, `доля леса ${share} (≈ 1 км из 3,3 км без просеки)`);
  // the clearing (≈ 0,99 км, 24 м wide) is a gap in the canopy
  const gap = [...Array(40)].map((_, i) => c.heightAt((0.95 + i * 0.002) / D)).some((h) => h === 0);
  assert.ok(gap, 'просека видна');
});

test('ESA WorldCover: класс «деревья» → лес заданной высоты', async () => {
  assert.equal(worldCoverTile(56.5, 84.9), 'N54E084');
  assert.equal(worldCoverTile(-0.5, -70.2), 'S03W072');
  const open: OpenCog = async (url) => (url === WORLDCOVER_URL('N54E084') ? CogReader.open(ranged(file('wc.tif'))) : null);
  const c = await canopyFromWorldCover(open, A.lat, A.lon, B.lat, B.lon, D, 18);
  assert.equal(c.heightAt(1.5 / D), 18);
  assert.equal(c.heightAt(0.3 / D), 0);
});

test('Профиль: деревья со спутника попадают в профиль поверх рельефа', async () => {
  const qk = quadkey(A.lat, A.lon, 9);
  const open: OpenCog = async (url) => (url === CHM_URL(qk) ? CogReader.open(ranged(file('chm.tif'))) : null);
  const canopy = await canopyFromChm(open, A.lat, A.lon, B.lat, B.lon, D);
  const ground = [{ d: 0, g: 100, c: 0 }, { d: D, g: 110, c: 0 }];
  const res = applyClutter(ground, A.lat, A.lon, B.lat, B.lon, [], { forestHeight: 20, canopy });
  const at = (km: number) => res.profile.reduce((best, p) => (Math.abs(p.d - km) < Math.abs(best.d - km) ? p : best));
  assert.equal(at(1.5).c, 24);
  assert.equal(at(1.5).t, 'f');
  assert.equal(at(0.5).c, 0);
  assert.match(res.summary, /карте высот деревьев/);
  assert.equal(res.canopy, 'chm');
});

test('COG: предиктор 3 (плавающая точка) по алгоритму libtiff', () => {
  const fx = JSON.parse(file('fpred.json').toString());
  const b = floatPredictor(Uint8Array.from(fx.enc), 5, 2, 4, 1);
  const f = new Float32Array(b.buffer, b.byteOffset, 10);
  assert.deepEqual(Array.from(f), fx.vals);
});

test('Настоящий файл Meta/WRI: BigTIFF 65536×65536, байт на пиксель, одна строка — одна полоса', async () => {
  const head = file('chm-real-head.bin');
  // only the first 4 KB of the real file are kept; the rest (tables, georeference) is zeros here
  const r = (await CogReader.open(async (s, e) => { const b = new Uint8Array(e - s); b.set(head.subarray(Math.min(s, head.length), Math.min(e, head.length))); return b; }))!;
  assert.equal(r.info.width, 65536);
  assert.equal(r.info.height, 65536);
  assert.equal(r.blocksOf([[100, 5], [60000, 5], [100, 6]]), 2, 'пиксели одной строки — одна загрузка');
});

test('Карта высот деревьев в полосах (как настоящая): тот же лес и не больше одной загрузки на точку', async () => {
  const qk = quadkey(A.lat, A.lon, 9);
  const log: number[] = [];
  const open: OpenCog = async (url) => (url === CHM_URL(qk) ? CogReader.open(ranged(file('chm-strips.tif'), log)) : null);
  const c = await canopyFromChm(open, A.lat, A.lon, B.lat, B.lon, D);
  assert.equal(c.heightAt(1.5 / D), 24);
  assert.equal(c.heightAt(0.5 / D), 0);
  assert.ok(c.share > 0.22 && c.share < 0.32, `доля леса ${c.share}`);
  const gap = [...Array(40)].map((_, i) => c.heightAt((0.95 + i * 0.002) / D)).some((h) => h === 0);
  assert.ok(gap, 'просека видна');
  const points = Math.ceil((D * 1000) / 10) + 1;
  assert.ok(log.length <= points + 5, `загрузок ${log.length} при ${points} точках`);
});

test('Длинный пролёт: не больше 1500 точек, то есть не больше 1500 загрузок', async () => {
  const qk = quadkey(A.lat, A.lon, 9);
  const log: number[] = [];
  const open: OpenCog = async (url) => (url === CHM_URL(qk) ? CogReader.open(ranged(file('chm-strips.tif'), log)) : null);
  // 45 km northwards: only the first 3,6 km are in the test file
  const far = { lat: A.lat + 45 / 111.37, lon: A.lon };
  await canopyFromChm(open, A.lat, A.lon, far.lat, far.lon, vincenty(A.lat, A.lon, far.lat, far.lon).km).catch(() => null);
  assert.ok(log.length <= 1500 + 5, `загрузок ${log.length}`);
});

test('Если карта высот деревьев не успела загрузиться — сразу WorldCover и причина', async () => {
  const qk = quadkey(A.lat, A.lon, 9);
  const open: OpenCog = async (url) => {
    if (url === CHM_URL(qk)) return new Promise(() => {}); // never answers
    return url === WORLDCOVER_URL('N54E084') ? CogReader.open(ranged(file('wc.tif'))) : null;
  };
  const c = await satelliteCanopy(open, A.lat, A.lon, B.lat, B.lon, D, 18, undefined, 50);
  assert.equal(c.source, 'worldcover');
  assert.match(c.chmError ?? '', /не загрузилась/);
});
