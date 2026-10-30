/** Builds single-link and project PDF reports and checks the file structure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildReport } from '../src/report/report';
import { calculateLink } from '../src/data/calc/link';
import { sampleProject } from '../src/data/samples';

const s = sampleProject();
const items = s.links.map((link) => ({ link, result: calculateLink(link, s.sites.find((x) => x.id === link.siteA)!, s.sites.find((x) => x.id === link.siteB)!) }));

test('single-link report is a valid PDF', () => {
  const bytes = buildReport([items[0]], s.project);
  const head = new TextDecoder().decode(bytes.slice(0, 8));
  const tail = new TextDecoder().decode(bytes.slice(-5));
  assert.equal(head, '%PDF-1.4');
  assert.equal(tail, '%%EOF');
  assert.ok(bytes.length > 50000);
  if (process.env.REPORT_OUT) writeFileSync(process.env.REPORT_OUT + '/single.pdf', bytes);
});

test('project report with summary page', () => {
  const bytes = buildReport(items, s.project);
  assert.ok(bytes.length > 60000);
  if (process.env.REPORT_OUT) writeFileSync(process.env.REPORT_OUT + '/project.pdf', bytes);
});
