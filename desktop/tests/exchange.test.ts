/** Project exchange between two engineers: export → import → edit → send back → update. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRepo } from '../src/storage/repo';
import { findExisting, importBundle, makeProjectBundle, parseBundle } from '../src/storage/exchange';
import { sampleProject } from '../src/data/samples';

test('обмен проектом: туда и обратно с обновлением', async () => {
  const me = await openRepo(), colleague = await openRepo();
  const s = sampleProject();
  await me.saveProject(s.project);
  for (const x of s.sites) await me.saveSite(x);
  for (const l of s.links) await me.saveLink(l);

  // I send the project with a comment
  const out = JSON.parse(JSON.stringify(await makeProjectBundle(me, s.project, 'проверь высоты')));
  assert.equal(parseBundle(out).note, 'проверь высоты');
  assert.equal(await findExisting(colleague, out), null, 'у коллеги проекта ещё нет');
  const r1 = await importBundle(colleague, out, 'copy');
  assert.equal(r1.projectId, s.project.id, 'новый проект сохраняет свой id');

  // The colleague edits heights, adds an object and sends it back
  const [l0] = await colleague.listLinks(s.project.id);
  await colleague.saveLink({ ...l0, hA: 77, notes: 'поднял антенну' });
  await colleague.saveSite({ id: 'new-site', projectId: s.project.id, name: 'Новый', code: '', lat: 56, lon: 84, groundM: null, notes: '' });
  const back = JSON.parse(JSON.stringify(await makeProjectBundle(colleague, (await colleague.listProjects())[0])));

  const ex = await findExisting(me, back);
  assert.equal(ex?.id, s.project.id, 'вернувшийся проект узнаётся');
  const r2 = await importBundle(me, back, 'replace');
  assert.equal(r2.projectId, s.project.id);
  assert.equal((await me.listProjects()).length, 1, 'дубликат не создан');
  const mine = await me.listLinks(s.project.id);
  assert.equal(mine.length, s.links.length);
  assert.equal(mine.find((l) => l.id === l0.id)?.hA, 77, 'правка коллеги применена');
  assert.equal((await me.listSites(s.project.id)).length, s.sites.length + 1, 'новый объект добавлен');

  // Saving as a copy keeps the original untouched
  const r3 = await importBundle(me, back, 'copy');
  assert.notEqual(r3.projectId, s.project.id);
  assert.equal((await me.listProjects()).length, 2);
  assert.ok((await me.listProjects()).some((p) => p.name.endsWith('(импорт)')));
});

test('обмен проектом: чужой файл отклоняется', () => {
  assert.throws(() => parseBundle({ hello: 1 }), /не файл ОИР RRL Planner/);
});
