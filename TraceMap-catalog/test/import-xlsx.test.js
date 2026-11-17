'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EXAMPLE_DIR, FIXTURE, EXAMPLE_CATALOG, ENTITY_FILES,
  run, tempDir, copyExample, readYaml, loadData, editYaml, editWorkbook, headerIndex, trimTrailing,
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

// Splits a built page into the embedded data object and the rest of the HTML around it.
function splitBuiltPage(html) {
  const start = 'window.TRACEMAP_DATA = ';
  const i = html.indexOf(start);
  const j = html.indexOf(';\n</script>', i);
  assert.ok(i >= 0 && j > i, 'built page has no embedded data block');
  return { shell: html.slice(0, i) + html.slice(j), data: JSON.parse(html.slice(i + start.length, j)) };
}

test('end to end: imported YAML builds the same HTML as the source YAML', t => {
  const dir = tempDir(t);
  const yamlDir = path.join(dir, 'imported');
  assert.equal(importFile(FIXTURE, yamlDir).status, 0);
  fs.copyFileSync(EXAMPLE_CATALOG, path.join(yamlDir, 'catalog.yaml'));

  const build = (dataDir, out) => {
    const res = run('build.js', ['--data', dataDir, '--out', out]);
    assert.equal(res.status, 0, res.stderr);
    return splitBuiltPage(fs.readFileSync(out, 'utf8'));
  };
  const source = build(EXAMPLE_DIR, path.join(dir, 'source.html'));
  const imported = build(yamlDir, path.join(dir, 'imported.html'));

  // Everything outside the data (app code, styles, page title) must be byte-identical.
  assert.equal(imported.shell, source.shell);

  // The data must match once the per-build stamp (time, folder name) is set aside and trailing
  // whitespace from YAML '>' blocks is trimmed (the known cosmetic loss).
  for (const page of [source, imported]) {
    assert.ok(page.data.build_metadata && page.data.build_metadata.built_at, 'build stamp present');
    delete page.data.build_metadata;
  }
  // Trimmed on both sides: catalog.yaml is copied as-is, so its own '>' blocks keep their newline.
  assert.deepEqual(trimTrailing(imported.data), trimTrailing(source.data));
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

test('duplicate mapping: a second Mappings row for one obligation is reported at that row', async t => {
  const dir = tempDir(t);
  let dupRow;
  let oblId;
  const file = await editWorkbook(FIXTURE, path.join(dir, 'dup-mapping.xlsx'), wb => {
    const ws = wb.getWorksheet('Mappings');
    const h = headerIndex(ws);
    oblId = ws.getCell(2, h['Obligation ID']).value;
    dupRow = ws.rowCount + 1;
    ws.getCell(dupRow, h['Obligation ID']).value = oblId;
    ws.getCell(dupRow, h.Status).value = 'verified';
  });
  const out = path.join(dir, 'out');
  const res = importFile(file, out);
  assert.equal(res.status, 1);
  assert.deepEqual(writtenYaml(out), []);
  const report = fs.readFileSync(path.join(out, 'import-report.md'), 'utf8');
  const row = `| Mappings | ${dupRow} | Obligation ID | \`${oblId}\` | \`each obligation on one Mappings row only\` |`;
  assert.ok(report.includes(row), `report is missing: ${row}\n\n${report}`);
});

test('unknown column: warned on row 1, ignored, and the import succeeds', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'extra-col.xlsx'), wb => {
    const ws = wb.getWorksheet('Roles');
    const col = ws.columnCount + 1;
    ws.getCell(1, col).value = 'Owner Notes';
    ws.getCell(2, col).value = 'ask HR';
  });
  const out = path.join(dir, 'out');
  const res = importFile(file, out);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Roles row 1, Owner Notes: Unrecognized column; its values are ignored/);
  assert.deepEqual(readYaml(path.join(out, 'roles.yaml')).roles, loadData(EXAMPLE_DIR).roles);
});

test('duplicate column: error on row 1 and no YAML written', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'dup-col.xlsx'), wb => {
    const ws = wb.getWorksheet('Mappings');
    ws.getCell(1, ws.columnCount + 1).value = 'Status';
  });
  const out = path.join(dir, 'out');
  const res = importFile(file, out);
  assert.equal(res.status, 1);
  assert.deepEqual(writtenYaml(out), []);
  const report = fs.readFileSync(path.join(out, 'import-report.md'), 'utf8');
  const row = '| Mappings | 1 | Status | (blank) | `one "Status" column (it appears twice)` |';
  assert.ok(report.includes(row), `report is missing: ${row}\n\n${report}`);
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
  const file = await editWorkbook(FIXTURE, path.join(dir, 'v1-9.xlsx'), wb => { wb.getWorksheet('Instructions').getCell('C2').value = '1.9'; });
  const res = importFile(file, path.join(dir, 'out'));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /newer than this importer/);
});

test('a 1.0 workbook without the new sheets, C3, or new columns imports with warnings', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'v1-0.xlsx'), wb => {
    wb.getWorksheet('Instructions').getCell('C2').value = '1.0';
    wb.getWorksheet('Instructions').getCell('C3').value = null; // 1.0 templates had no C3: schema 1.0
    wb.removeWorksheet(wb.getWorksheet('Relationships').id);
    wb.removeWorksheet(wb.getWorksheet('Attributes').id);
    const reg = wb.getWorksheet('Regulations');
    reg.spliceColumns(headerIndex(reg).Sequence, 1);
  });
  const out = path.join(dir, 'out');
  const res = importFile(file, out);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Relationships row —: Sheet not in this older template \(1\.0\)/);
  assert.match(res.stdout, /Regulations row 1, Sequence: Column not in this older template/);
  assert.match(res.stdout, /Attributes row —: Sheet not in this older template/);
  assert.doesNotMatch(res.stdout, /schema_version|C3/);
  assert.deepEqual(readYaml(path.join(out, 'relationships.yaml')).relationships, []);
});

test('imported YAML files start with the data schema version; a newer major in C3 is refused', async t => {
  const dir = tempDir(t);
  const out = path.join(dir, 'out');
  assert.equal(importFile(FIXTURE, out).status, 0);
  const { SCHEMA_VERSION } = require('../lib/schema');
  for (const f of ENTITY_FILES) assert.ok(fs.readFileSync(path.join(out, `${f}.yaml`), 'utf8').startsWith(`schema_version: '${SCHEMA_VERSION}'\n`), f);

  const v9 = await editWorkbook(FIXTURE, path.join(dir, 'v9.xlsx'), wb => { wb.getWorksheet('Instructions').getCell('C3').value = '9.0'; });
  const res = importFile(v9, path.join(dir, 'out9'));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /workbook \(Instructions C3\) is schema 9\.0, newer than this TraceMap/);
});

test('attributes rows need a known Item Kind and an existing Item ID', async t => {
  const dir = tempDir(t);
  const file = await editWorkbook(FIXTURE, path.join(dir, 'bad-attr.xlsx'), wb => {
    const ws = wb.getWorksheet('Attributes');
    ws.addRow(['topic', 'access', 'Owner', 'ciso']);
    ws.addRow(['document', 'NOPE', 'Pages', '3']);
  });
  const out = path.join(dir, 'out');
  assert.equal(importFile(file, out).status, 1);
  const report = fs.readFileSync(path.join(out, 'import-report.md'), 'utf8');
  assert.match(report, /\| Attributes \| 4 \| Item Kind \| `topic` \| `regulation \\\| obligation \\\| document` \|/);
  assert.match(report, /\| Attributes \| 5 \| Item ID \| `NOPE` \| `an existing ID on the Documents sheet` \|/);
});

test('round trip keeps sequence, parent, attributes, relationships, dates, and x- fields', async t => {
  const src = copyExample(t);
  editYaml(src, 'regulations.yaml', doc => {
    const [a, b] = doc.regulations;
    Object.assign(a, { sequence: 2, created_at: '2025-01-02', modified_at: '2026-03-04', 'x-owner': 'grc-team', 'x-score': 7 });
    b.parent = a.id;
    b.key_dates[0]['x-source'] = 'Official Journal';
  });
  editYaml(src, 'documents.yaml', doc => {
    Object.assign(doc.documents[1], { parent: doc.documents[0].id, valid_until: '2030-12-31' });
    doc.documents[2].attributes = [{ name: 'Pages', value: '14', unit: 'pages', source: 'DMS' }];
  });
  editYaml(src, 'obligations.yaml', doc => { doc.obligations[0].attributes = [{ name: 'Effort', value: 'low' }]; });
  editYaml(src, 'relationships.yaml', doc => {
    doc.relationships = [{
      from_item: 'topic:logging', to_item: 'control:logging', type: 'related', description: 'Same subject',
      attributes: { strength: 'strong', reviewed_by: 'ciso' }, created_at: '2026-01-01', 'x-ticket': 'GRC-142',
    }];
  });
  const xlsx = path.join(src, 'export.xlsx');
  assert.equal(run('scripts/generate-template.js', ['--populate', src, '--out', xlsx]).status, 0);
  const out = path.join(src, 'imported');
  const res = importFile(xlsx, out);
  assert.equal(res.status, 0, res.stderr);
  assertSameRecords(out, src);
});

test('an x- field holding a list is reported on export and left out; other fields still export', t => {
  const src = copyExample(t);
  editYaml(src, 'roles.yaml', doc => { doc.roles[0]['x-members'] = ['a', 'b']; doc.roles[0].legacy_note = 'old'; });
  const res = run('scripts/generate-template.js', ['--populate', src, '--out', path.join(src, 'x.xlsx')]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /Roles: field "x-members" holds a list or map/);
  assert.match(res.stderr, /Roles: field "legacy_note" has no column; dropped from 1 record\(s\)\. Rename it to x-legacy_note to keep it\./);
});

test('export stops when a relationship attribute contains the | separator', t => {
  const src = copyExample(t);
  editYaml(src, 'relationships.yaml', doc => {
    doc.relationships = [{ from_item: 'topic:logging', to_item: 'control:logging', type: 'related', attributes: { note: 'a | b' } }];
  });
  const out = path.join(src, 'x.xlsx');
  const res = run('scripts/generate-template.js', ['--populate', src, '--out', out]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /attribute "note: a \| b" contains "\|"/);
  assert.equal(fs.existsSync(out), false);
});

test('a successful import removes a stale import-report.md', t => {
  const out = tempDir(t);
  fs.writeFileSync(path.join(out, 'import-report.md'), 'old');
  assert.equal(importFile(FIXTURE, out).status, 0);
  assert.equal(fs.existsSync(path.join(out, 'import-report.md')), false);
});
