'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { COLUMNS, SHEET_ORDER, TEMPLATE_VERSION, SCHEMA_VERSION, DEFAULT_RELATIONSHIP_TYPES } = require('../lib/schema');
const {
  EXAMPLE_DIR, FIXTURE, EXAMPLE_CATALOG, EXAMPLE_NOTE,
  run, tempDir, copyExample, readYaml, loadData, editYaml,
  readWorkbook, noteText, headerIndex, dataRowCount, cellDump,
} = require('./helpers');

const catalog = readYaml(EXAMPLE_CATALOG);
const layerIds = catalog.layers.map(l => l.id);
const ENTITY_SHEETS = SHEET_ORDER.filter(s => s !== 'Instructions');

// Data validation for the column under a header, read from row 2.
function validationAt(ws, header) {
  const col = headerIndex(ws)[header];
  return ws.getCell(2, col).dataValidation;
}
const listValues = v => v.formulae[0].replace(/^"|"$/g, '').split(',');

// One blank template and one populated workbook per run, shared by the tests below.
let blank;
let populated;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tracemap-gen-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const blankPath = path.join(dir, 'blank.xlsx');
  const popPath = path.join(dir, 'populated.xlsx');
  assert.equal(run('scripts/generate-template.js', ['--catalog', EXAMPLE_CATALOG, '--out', blankPath]).status, 0);
  assert.equal(run('scripts/generate-template.js', ['--populate', EXAMPLE_DIR, '--out', popPath]).status, 0);
  blank = await readWorkbook(blankPath);
  populated = await readWorkbook(popPath);
});

test('sheets appear in SHEET_ORDER with Instructions first', () => {
  for (const wb of [blank, populated]) assert.deepEqual(wb.worksheets.map(w => w.name), SHEET_ORDER);
});

test('template version is in Instructions!C2 as text', () => {
  const ins = blank.getWorksheet('Instructions');
  assert.equal(ins.getCell('B2').value, 'Template version');
  assert.equal(ins.getCell('C2').value, TEMPLATE_VERSION);
  assert.equal(populated.getWorksheet('Instructions').getCell('C2').value, TEMPLATE_VERSION);
  assert.equal(ins.getCell('B3').value, 'Data schema version');
  assert.equal(ins.getCell('C3').value, SCHEMA_VERSION);
});

test('headers follow COLUMNS, with facet columns appended to Regulations', () => {
  for (const sheet of ENTITY_SHEETS) {
    const ws = blank.getWorksheet(sheet);
    const headers = [];
    ws.getRow(1).eachCell(c => headers.push(c.value));
    const expected = COLUMNS[sheet].map(c => (c.required ? `${c.header} *` : c.header));
    if (sheet === 'Regulations') expected.push(...catalog.facets.map(f => f.label));
    assert.deepEqual(headers, expected, sheet);
  }
});

test('required headers are yellow with *, optional headers white', () => {
  const ws = blank.getWorksheet('Regulations');
  const cell = h => ws.getCell(1, headerIndex(ws)[h]);
  assert.equal(cell('ID').value, 'ID *');
  assert.equal(cell('ID').fill.fgColor.argb, 'FFFFE699');
  assert.equal(cell('Full Title').fill.fgColor.argb, 'FFFFFFFF');
});

test('every header has a tooltip; enum tooltips list the allowed values', () => {
  for (const sheet of ENTITY_SHEETS) {
    const ws = blank.getWorksheet(sheet);
    ws.getRow(1).eachCell(c => assert.ok(noteText(c), `${sheet} ${c.value} has no note`));
  }
  const ws = blank.getWorksheet('Mappings');
  assert.match(noteText(ws.getCell(1, headerIndex(ws).Status)), /verified \| deviations_noted/);
});

test('dropdowns: fixed enums, facets, layers, booleans', () => {
  const reg = blank.getWorksheet('Regulations');
  assert.deepEqual(listValues(validationAt(reg, 'Source Type')), COLUMNS.Regulations.find(c => c.key === 'source_type').values);
  for (const f of catalog.facets) assert.deepEqual(listValues(validationAt(reg, f.label)), Object.keys(f.values), f.field);
  assert.deepEqual(listValues(validationAt(blank.getWorksheet('Documents'), 'Layer')), layerIds);
  assert.deepEqual(listValues(validationAt(blank.getWorksheet('Mapping_Docs'), 'Layer Override')), layerIds);
  assert.deepEqual(listValues(validationAt(blank.getWorksheet('Documents'), 'Restricted')), ['TRUE', 'FALSE']);
  assert.deepEqual(listValues(validationAt(blank.getWorksheet('Relationships'), 'Type')), DEFAULT_RELATIONSHIP_TYPES.map(t => t.id));
  assert.deepEqual(listValues(validationAt(blank.getWorksheet('Attributes'), 'Item Kind')), ['regulation', 'obligation', 'document']);
  assert.equal(validationAt(reg, 'Sequence').type, 'whole');
  assert.equal(validationAt(reg, 'Total Obligations').type, 'whole');
  assert.equal(validationAt(reg, 'Last Reviewed').type, 'date');
  assert.equal(validationAt(reg, 'Summary'), undefined);
});

test('blank template: row 2 is the gray example row with the importer note', () => {
  for (const sheet of ENTITY_SHEETS) {
    const ws = blank.getWorksheet(sheet);
    assert.equal(noteText(ws.getCell('A2')), EXAMPLE_NOTE, sheet);
    assert.equal(ws.getCell('A2').font.italic, true, sheet);
    assert.equal(dataRowCount(ws), 1, sheet);
  }
});

test('sheets are protected with the header locked and data cells unlocked', () => {
  const ws = blank.getWorksheet('Obligations');
  assert.ok(ws.sheetProtection && ws.sheetProtection.sheet);
  assert.notEqual(ws.getCell('A1').protection && ws.getCell('A1').protection.locked, false);
  assert.equal(ws.getCell('A2').protection.locked, false);
  assert.equal(ws.getColumn(1).protection.locked, false); // empty rows below inherit this
});

test('populated workbook: no example row, data from row 2, counts match the YAML', () => {
  const d = loadData(EXAMPLE_DIR);
  const expected = {
    Regulations: d.regulations.length,
    Reg_Key_Dates: d.regulations.reduce((n, r) => n + (r.key_dates || []).length, 0),
    Obligations: d.obligations.length,
    Mappings: d.mappings.length,
    Mapping_Docs: d.mappings.reduce((n, m) => n + (m.documents || []).length, 0),
    Documents: d.documents.length,
    Topics: d.topics.length,
    Controls: d.controls.length,
    Roles: d.roles.length,
    Glossary: d.glossary.length,
    Attributes: ['regulations', 'obligations', 'documents'].reduce((n, e) => n + d[e].reduce((m, x) => m + (x.attributes || []).length, 0), 0),
    Relationships: d.relationships.length,
  };
  for (const sheet of ENTITY_SHEETS) {
    const ws = populated.getWorksheet(sheet);
    assert.equal(dataRowCount(ws), expected[sheet], sheet);
    assert.equal(noteText(ws.getCell('A2')), null, `${sheet} A2 note`);
  }
  assert.equal(populated.getWorksheet('Regulations').getCell('A2').value, d.regulations[0].id);
  assert.equal(populated.getWorksheet('Roles').getCell('A2').value, d.roles[0].id);
});

test('populated cells: lists joined with " | ", dates as Excel dates, booleans as booleans, facets filled', () => {
  const d = loadData(EXAMPLE_DIR);
  const reg = populated.getWorksheet('Regulations');
  const h = headerIndex(reg);
  assert.equal(reg.getCell(2, h['Applies When']).value, d.regulations[0].applies_when.join(' | '));
  assert.ok(reg.getCell(2, h['Last Reviewed']).value instanceof Date);
  assert.equal(reg.getCell(2, h.Category).value, d.regulations[0].category);

  const docs = populated.getWorksheet('Documents');
  const restricted = [];
  docs.eachRow((r, i) => { if (i > 1 && r.getCell(headerIndex(docs).Restricted).value === true) restricted.push(r.getCell(1).value); });
  assert.deepEqual(restricted, d.documents.filter(x => x.restricted === true).map(x => x.id));
});

test('committed fixture matches what generate-template:fixture produces now', async t => {
  const out = path.join(tempDir(t), 'fixture.xlsx');
  assert.equal(run('scripts/generate-template.js', ['--catalog', EXAMPLE_CATALOG, '--populate', EXAMPLE_DIR, '--out', out]).status, 0);
  assert.equal(await cellDump(out), await cellDump(FIXTURE), 'run "npm run generate-template:fixture" and commit the result');
});

test('--populate refuses invalid YAML: report written, no workbook, exit 1', t => {
  const dir = copyExample(t);
  editYaml(dir, 'mappings.yaml', doc => { doc.mappings[0].status = 'done'; });
  const out = path.join(dir, 'should-not-exist.xlsx');
  const res = run('scripts/generate-template.js', ['--populate', dir, '--out', out]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /1 error\(s\).*No workbook written/);
  assert.equal(fs.existsSync(out), false);
  const report = fs.readFileSync(path.join(dir, 'import-report.md'), 'utf8');
  assert.match(report, /# TraceMap Export Report/);
  assert.match(report, /\| mappings\.yaml \| entry 1 .*\| status \| `done` \|/);
});

test('--populate removes a stale report after a clean export', t => {
  const dir = copyExample(t);
  fs.writeFileSync(path.join(dir, 'import-report.md'), 'old');
  assert.equal(run('scripts/generate-template.js', ['--populate', dir, '--out', path.join(dir, 'x.xlsx')]).status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'import-report.md')), false);
});

test('flags without a value are rejected', () => {
  const res = run('scripts/generate-template.js', ['--populate']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--populate needs a value/);
});

test('export-xlsx npm script overrides cleanly with -- --populate <dir>', t => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const script = pkg.scripts['export-xlsx'].replace(/^node /, '').split(' ');
  const out = path.join(tempDir(t), 'export.xlsx');
  // Same argument list npm would build for: npm run export-xlsx -- --populate data-example --out <tmp>
  const res = run(script[0], [...script.slice(1), '--populate', 'data-example', '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(out));
});
