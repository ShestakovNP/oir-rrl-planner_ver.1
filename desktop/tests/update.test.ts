/** Update check helpers and rows not yet filled in from the datasheet. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOfTag, buildOfVersion, notesItems, pickAsset } from '../src/net/updateAssets';
import { calculateLink } from '../src/data/calc/link';
import { sampleProject } from './fixtures';
import { defaultLibrary, isOldTemplateRadio } from '../src/data/samples';
import { MODES_6G } from './fixtures';

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

test('обновление: «Что нового» из текста выпуска', () => {
  assert.deepEqual(notesItems('- Первое\n- Второе\n\nУстановщики ОИР RRL Planner: .dmg …'), ['Первое', 'Второе']);
  assert.deepEqual(notesItems(null), []);
});

test('справочник: очищаются только нетронутые старые шаблоны, данные пользователя сохраняются', () => {
  const tpl = { name: 'Шаблон ц, 28 МГц', notes: '', modes: MODES_6G.map((m) => ({ ...m })) };
  assert.equal(isOldTemplateRadio(tpl), true, 'старый шаблон с заводскими цифрами');
  assert.equal(isOldTemplateRadio({ ...tpl, modes: tpl.modes.map((m, i) => (i ? m : { ...m, thresholdDbm: -82 })) }), false, 'шаблон, в котором пользователь поправил порог');
  assert.equal(isOldTemplateRadio({ name: 'Ericsson MINI-LINK 6 ГГц', notes: '', modes: MODES_6G.map((m) => ({ ...m })) }), false, 'своё ППУ с теми же цифрами, но своим названием');
  assert.equal(isOldTemplateRadio({ name: 'Шаблон своего ППУ', notes: '', modes: [{ name: 'QPSK', rateMbps: 50, txDbm: 20, thresholdDbm: -85 }] }), false, 'своё ППУ с названием «Шаблон…»');
});
