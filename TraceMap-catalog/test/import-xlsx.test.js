'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EXAMPLE_DIR, FIXTURE, EXAMPLE_CATALOG, ENTITY_FILES,
  run, tempDir, readYaml, loadData, editWorkbook, headerIndex, trimTrailing,
} = require('./helpers');

const BLANK_ARGS = out => ['--catalog', EXAMPLE_CATALOG, '--out', out];

// The out folder is always created first: the importer writes import-report.md to the project
// folder when --out does not exist, and a failing test must not leave files in the repo.
function importFile(file, outDir, extra = []) {
  fs.mkdirSync(outDir, { recursive: true });
  return run('scripts/import-xlsx.js', ['--file', file, '--out', outDir, '--catalog', EXAMPLE_CATALOG, ...extra]);
}

function writtenYaml(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort();
}

// Imported records compared with the source YAML, ignoring trailing newlines from '>' blocks.
function assertSameRecords(importedDir, sourceDir) {
  const a = loadDataNoCatalog(sourceDir);
  const b = loadDataNoCatalog(importedDir);
  for (const key of ENTITY_FILES) assert.deepEqual(b[key], trimTrailing(a[key]), key);
}
function loadDataNoCatalog(dir) {
  const out = {};
  for (const key of ENTITY_FILES) out[key] = readYaml(path.join(dir, `${key}.yaml`))[key] || [];
  return out;
}

test('round trip: fixture XLSX -> YAML matches data-example record for record', t => {
  const out = tempDir(t);
  const res = importFile(FIXTURE, out);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(writtenYaml(out), ENTITY_FILES.map(f => `${f}.yaml`).sort());
  assertSameRecords(out, EXAMPLE_DIR);
});

test('round trip: export -> import -> export gives the same workbook cells', async t => {
  const dir = tempDir(t);
  const first = path.join(dir, 'first.xlsx');
  assert.equal(run('scripts/generate-template.js', ['--populate', EXAMPLE_DIR, '--out', first]).status, 0);
  const yamlDir = path.join(dir, 'yaml');
  assert.equal(importFile(first, yamlDir).status, 0);
  fs.copyFileSync(EXAMPLE_CATALOG, path.join(yamlDir, 'catalog.yaml'));
  const second = path.join(dir, 'second.xlsx');
  assert.equal(run('scripts/generate-template.js', ['--populate', yamlDir, '--out', second]).status, 0);
  // Instructions names the catalog path the workbook was generated from, which differs here.
  const { cellDump } = require('./helpers');
  assert.equal(await cellDump(second, { skip: ['Instructions'] }), await cellDump(first, { skip: ['Instructions'] }));
});

test('imported YAML builds with build.js', t => {
  const out = tempDir(t);
  assert.equal(importFile(FIXTURE, out).status, 0);
  fs.copyFileSync(EXAMPLE_CATALOG, path.join(out, 'catalog.yaml'));
  const res = run('build.js', ['--data', out, '--out', path.join(out, 'out.html')]);
  assert.equal(res.status, 0, res.stderr);
});

test('nested sheets fold into parents in row order, without the foreign key', t => {
  const out = tempDir(t);
  assert.equal(importFile(FIXTURE, out).status, 0);
  const src = loadData(EXAMPLE_DIR);
  const regs = readYaml(path.join(out, 'regulations.yaml')).regulations;
  const maps = readYaml(path.join(out, 'mappings.yaml')).mappings;
  regs.forEach((r, i) => assert.deepEqual(r.key_dates, src.regulations[i].key_dates, r.id));
  for (const kd of regs.flatMap(r => r.key_dates || [])) assert.equal('regulation_id' in kd, false);
  for (const doc of maps.flatMap(m => m.documents || [])) assert.equal('obligation_id' in doc, false);
});

test('blank template: example row is skipped, row 3 is imported', async t => {
  const dir = tempDir(t);
  const blank = path.join(dir, 'blank.xlsx');
  assert.equal(run('scripts/generate-template.js', BLANK_ARGS(blank)).status, 0);
  await editWorkbook(blank, blank, wb => {
    const ws = wb.getWorksheet('Roles');
    ws.getCell('A3').value = 'cfo';
    ws.getCell('B3').value = 'Chief Financial Officer';
  });
  const out = path.join(dir, 'out');
  assert.equal(importFile(blank, out).status, 0);
  assert.deepEqual(readYaml(path.join(out, 'roles.yaml')).roles, [{ id: 'cfo', name: 'Chief Financial Officer' }]);
});

test('blank template with no data is refused, existing YAML untouched (exit 2)', t => {
  const dir = tempDir(t);
  const blank = path.join(dir, 'blank.xlsx');
  assert.equal(run('scripts/generate-template.js', BLANK_ARGS(blank)).status, 0);
  const out = path.join(dir, 'data');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'roles.yaml'), 'roles: []\n# keep me\n');
  const res = importFile(blank, out);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no data rows/);
  assert.match(fs.readFileSync(path.join(out, 'roles.yaml'), 'utf8'), /keep me/);
});

test('columns are matched by header, so reordering them still imports', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'reordered.xlsx'), wb => {
    const ws = wb.getWorksheet('Roles');
    ws.eachRow(r => { const a = r.getCell(1).value; r.getCell(1).value = r.getCell(2).value; r.getCell(2).value = a; });
  });
  const out = path.join(dir, 'out');
  assert.equal(importFile(file, out).status, 0);
  assert.deepEqual(readYaml(path.join(out, 'roles.yaml')).roles, loadData(EXAMPLE_DIR).roles);
});

test('booleans typed as text TRUE/FALSE are accepted', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'text-bool.xlsx'), wb => {
    const ws = wb.getWorksheet('Documents');
    ws.getCell(2, headerIndex(ws).Restricted).value = 'true';
  });
  const out = path.join(dir, 'out');
  assert.equal(importFile(file, out).status, 0);
  assert.equal(readYaml(path.join(out, 'documents.yaml')).documents[0].restricted, true);
});

test('errors: report lists sheet/row/column, no YAML written, exit 1', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'corrupt.xlsx'), wb => {
    const set = (sheet, header, row, v) => { const ws = wb.getWorksheet(sheet); ws.getCell(row, headerIndex(ws)[header]).value = v; };
    set('Mappings', 'Status', 14, 'done');                       // invalid enum
    set('Regulations', 'Short Name', 3, null);                   // missing required
    set('Obligations', 'Regulation ID', 5, 'ghost-reg');         // orphan reference
    set('Mapping_Docs', 'Obligation ID', 10, 'no-such-obligation'); // orphan child row
    set('Documents', 'Date Filed', 4, '2026-02-30');             // date typed as text
    set('Reg_Key_Dates', 'Pending', 3, 'maybe');                 // bad boolean
    set('Regulations', 'Total Obligations', 4, -1);              // negative integer
  });
  const out = path.join(dir, 'out');
  const res = importFile(file, out);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /7 error\(s\).*No files written/);
  assert.deepEqual(writtenYaml(out), []);

  const report = fs.readFileSync(path.join(out, 'import-report.md'), 'utf8');
  for (const row of [
    '| Mappings | 14 | Status | `done` | `verified \\| deviations_noted \\| verification_pending \\| not_assessed` |',
    '| Regulations | 3 | Short Name | (blank) | `a value (required)` |',
    '| Obligations | 5 | Regulation ID | `ghost-reg` | `an ID in Regulations` |',
    '| Mapping_Docs | 10 | Obligation ID | `no-such-obligation` | `an existing Obligation ID on the Mappings sheet` |',
    '| Documents | 4 | Date Filed | `2026-02-30` | `an Excel date (shown as YYYY-MM-DD)` |',
    '| Reg_Key_Dates | 3 | Pending | `maybe` | `TRUE or FALSE` |',
    '| Regulations | 4 | Total Obligations | `-1` | `a whole number, 0 or greater` |',
  ]) assert.ok(report.includes(row), `report is missing: ${row}\n\n${report}`);
});

test('warnings: listed by sheet/row and the import still succeeds', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'warn.xlsx'), wb => {
    const ws = wb.getWorksheet('Mappings');
    const h = headerIndex(ws);
    ws.eachRow((r, i) => { if (i > 1 && r.getCell(h.Status).value === 'deviations_noted') r.getCell(h.Rationale).value = null; });
  });
  const res = importFile(file, path.join(dir, 'out'));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Mappings row \d+, Rationale: deviations_noted without a rationale/);
});

test('file-level failures exit 2', async t => {
  const dir = tempDir(t);
  const out = path.join(dir, 'out');
  assert.equal(importFile(path.join(dir, 'missing.xlsx'), out).status, 2);
  assert.equal(importFile(path.join(__dirname, '..', 'package.json'), out).status, 2);

  const major = await editWorkbook(FIXTURE, path.join(dir, 'v2.xlsx'), wb => { wb.getWorksheet('Instructions').getCell('C2').value = '2.0'; });
  const res = importFile(major, out);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /npm run export-xlsx/);

  const noVersion = await editWorkbook(FIXTURE, path.join(dir, 'nover.xlsx'), wb => { wb.getWorksheet('Instructions').getCell('C2').value = null; });
  assert.match(importFile(noVersion, out).stderr, /npm run generate-template/);

  const noSheet = await editWorkbook(FIXTURE, path.join(dir, 'nosheet.xlsx'), wb => { wb.removeWorksheet(wb.getWorksheet('Glossary').id); });
  assert.equal(importFile(noSheet, out).status, 2);
  assert.deepEqual(fs.readdirSync(out), [], 'nothing written on file-level failure');
});

test('a newer minor template version imports with a warning', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'v1-1.xlsx'), wb => { wb.getWorksheet('Instructions').getCell('C2').value = '1.1'; });
  const res = importFile(file, path.join(dir, 'out'));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /newer than this importer/);
});

test('a successful import removes a stale import-report.md', t => {
  const out = tempDir(t);
  fs.writeFileSync(path.join(out, 'import-report.md'), 'old');
  assert.equal(importFile(FIXTURE, out).status, 0);
  assert.equal(fs.existsSync(path.join(out, 'import-report.md')), false);
});
