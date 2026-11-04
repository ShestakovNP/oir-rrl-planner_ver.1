/** Update check helpers and rows not yet filled in from the datasheet. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOfTag, buildOfVersion, pickAsset } from '../src/net/updateAssets';
import { calculateLink } from '../src/data/calc/link';
import { sampleProject } from '../src/data/samples';
import { defaultLibrary } from '../src/data/samples';

test('обновление: номер сборки из тега и установщик для системы', () => {
  assert.equal(buildOfTag('build-57'), 57);
  assert.equal(buildOfTag('v1.0.0'), 0);
  assert.equal(buildOfVersion('1.0.12'), 12);
  assert.equal(buildOfVersion('1.0.0'), 0);
  const assets = [
    { name: 'ОИР RRL Planner_1.0.0_universal.dmg', browser_download_url: 'https://x/mac.dmg' },
    { name: 'ОИР RRL Planner_1.0.0_x64_en-US.msi', browser_download_url: 'https://x/win.msi' },
    { name: 'ОИР RRL Planner_1.0.0_x64-setup.exe', browser_download_url: 'https://x/win.exe' }
  ];
  assert.equal(pickAsset(assets, 'mac')?.browser_download_url, 'https://x/mac.dmg');
  assert.equal(pickAsset(assets, 'win')?.browser_download_url, 'https://x/win.exe');
  assert.equal(pickAsset(assets.slice(0, 2), 'win')?.browser_download_url, 'https://x/win.msi');
});

test('типы модуляции с нулями из паспорта не участвуют в расчёте', () => {
  const s = sampleProject();
  const l = s.links[0];
  const A = s.sites.find((x) => x.id === l.siteA)!, B = s.sites.find((x) => x.id === l.siteB)!;
  const ch = [{ ...l.channels[0], modes: [...l.channels[0].modes, { name: 'QAM256', rateMbps: 0, txDbm: 0, thresholdDbm: 0 }] }, l.channels[1]] as typeof l.channels;
  const r = calculateLink({ ...l, channels: ch }, A, B);
  assert.equal(r.channels[0].modes.length, l.channels[0].modes.length);
});

test('справочник ППУ изначально пустой', () => {
  assert.equal(defaultLibrary().radios.length, 0);
  assert.ok(defaultLibrary().antennas.length > 0);
});
