#!/usr/bin/env node
'use strict';

/**
 * Import a TraceMap XLSX workbook into the YAML files TraceMap builds from.
 *
 *   node scripts/import-xlsx.js --file <path.xlsx> [--out <data-dir>] [--catalog <path>]
 *
 * Defaults: --out data/, --catalog data/catalog.yaml. catalog.yaml is read (for facets, layers,
 * and validation) but never written; it is not part of the workbook.
 *
 * Pipeline: open workbook -> check template version (Instructions!C2) -> read entity sheets
 * (headers matched by name, example row skipped only if A2 carries the example note) ->
 * coerce cell types -> fold Reg_Key_Dates / Mapping_Docs into their parents -> run the same
 * validate() build.js uses -> write YAML on success, or import-report.md on failure.
 *
 * Exit codes: 0 success (warnings allowed), 1 validation errors, 2 file-level failure.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const ExcelJS = require('exceljs');
const { COLUMNS, SHEET_ORDER, TEMPLATE_VERSION } = require('../lib/schema');
const { validate } = require('../lib/validate');

const ROOT = path.resolve(__dirname, '..');

// Must match EXAMPLE_NOTE in generate-template.js exactly.
const EXAMPLE_NOTE = 'EXAMPLE ROW — delete before importing';
const REPORT_NAME = 'import-report.md';

// Top-level sheets -> key in the data object and output file.
const ENTITIES = {
  Regulations: 'regulations',
  Obligations: 'obligations',
  Mappings:    'mappings',
  Documents:   'documents',
  Topics:      'topics',
  Controls:    'controls',
  Roles:       'roles',
  Glossary:    'glossary',
};

// Child sheets folded into a parent list; the foreign key is dropped from the nested object.
const CHILDREN = {
  Reg_Key_Dates: { parentSheet: 'Regulations', fk: 'regulation_id', parentKey: 'id',            listKey: 'key_dates' },
  Mapping_Docs:  { parentSheet: 'Mappings',    fk: 'obligation_id', parentKey: 'obligation_id', listKey: 'documents' },
};
const CHILD_SHEET_FOR = { key_dates: 'Reg_Key_Dates', documents: 'Mapping_Docs' };

// pipe_list fields that hold a single keyword as a plain scalar rather than a list.
const SCALAR_KEYWORDS = { applies_if: ['always'] };

const DUMP_OPTIONS = { lineWidth: 120, sortKeys: false, noRefs: true };

// ---------- CLI ----------

function parseArgs(argv) {
  const args = { file: null, out: 'data', catalog: 'data/catalog.yaml' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--catalog') args.catalog = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/import-xlsx.js --file <path.xlsx> [--out <data-dir>] [--catalog <path>]');
      process.exit(0);
    } else {
      fatal(`Unknown argument: ${a}`);
    }
  }
  if (!args.file) fatal('--file <path.xlsx> is required');
  return args;
}

// File-level failure: nothing imported, no report, exit 2.
function fatal(msg) {
  console.error(`import: ${msg}`);
  process.exit(2);
}

// ---------- version ----------

function parseVersion(v) {
  if (v == null) return null;
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(String(v));
  return m ? { major: Number(m[1]), minor: Number(m[2] || 0), text: String(v).trim() } : null;
}

function checkVersion(wb) {
  const ws = wb.getWorksheet('Instructions');
  const expected = parseVersion(TEMPLATE_VERSION);
  const found = ws ? parseVersion(cellValue(ws.getCell('C2'))) : null;
  if (!found) {
    fatal('could not read the template version (Instructions sheet, cell C2). ' +
      'This does not look like a TraceMap template. Run "npm run generate-template" for a fresh one.');
  }
  if (found.major !== expected.major) {
    fatal(`template version ${found.text} is not compatible with this importer (expects ${TEMPLATE_VERSION}). ` +
      'Run "npm run generate-template" for a new template, then "npm run export-xlsx" to move your data into it.');
  }
  return { found, expected, olderMinor: found.minor < expected.minor, newerMinor: found.minor > expected.minor };
}

// ---------- catalog ----------

function loadCatalog(file) {
  if (!fs.existsSync(file)) fatal(`catalog not found: ${file}`);
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    fatal(`YAML syntax error in ${file}:\n  ${e.message}`);
  }
  // js-yaml turns YYYY-MM-DD into Date objects; validate() expects ISO strings (as build.js loads them).
  return JSON.parse(JSON.stringify(doc), (k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v) ? v.slice(0, 10) : v));
}

// Static COLUMNS plus the catalog's facet columns on Regulations (header = facet label).
// Layer values are not needed here: validate() checks layers against catalog.yaml.
function columnsFor(sheet, catalog) {
  const cols = COLUMNS[sheet].map(c => ({ ...c }));
  if (sheet === 'Regulations') {
    for (const f of catalog.facets || []) {
      if (!f || !f.field) continue;
      cols.push({ key: f.field, header: f.label || f.field, required: false, type: 'enum', values: Object.keys(f.values || {}), facet: true });
    }
  }
  return cols;
}

// ---------- cell reading ----------

// Reduce an ExcelJS cell value to a plain value: string, number, boolean, Date, or null.
function cellValue(cell) {
  let v = cell && cell.value;
  if (v == null) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
  if ('formula' in v || 'sharedFormula' in v) return v.result == null ? null : cellValue({ value: v.result });
  if ('hyperlink' in v) return cellValue({ value: v.text != null ? v.text : v.hyperlink });
  if ('error' in v) return { error: v.error };
  return String(v);
}

function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

const isoDate = d => d.toISOString().slice(0, 10);

// Convert a raw cell value for a column. Returns { value } or { error: expected-text }.
// Enum membership, required fields, and cross-references are left to validate().
function coerce(col, v) {
  if (v && typeof v === 'object' && 'error' in v) return { error: 'a value, not a spreadsheet error' };
  switch (col.type) {
    case 'date':
      if (v instanceof Date && !isNaN(v)) return { value: isoDate(v) };
      return { error: 'an Excel date (shown as YYYY-MM-DD)' };
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (Number.isInteger(n) && n >= 0) return { value: n };
      return { error: 'a whole number, 0 or greater' };
    }
    case 'boolean':
      if (typeof v === 'boolean') return { value: v };
      if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return { value: v.trim().toUpperCase() === 'TRUE' };
      return { error: 'TRUE or FALSE' };
    case 'pipe_list': {
      const parts = String(v).split('|').map(s => s.trim()).filter(Boolean);
      if (!parts.length) return { value: undefined };
      const keywords = SCALAR_KEYWORDS[col.key] || [];
      if (parts.length === 1 && keywords.includes(parts[0])) return { value: parts[0] };
      return { value: parts };
    }
    default: // string, enum
      if (v instanceof Date) return { value: isoDate(v) }; // Excel turned typed text into a date
      return { value: String(v).trim() || undefined };
  }
}

// ---------- reading a sheet ----------

function headerKey(text) {
  return String(text == null ? '' : text).replace(/\*\s*$/, '').trim().toLowerCase();
}

// Reads one entity sheet. Returns rows as { row, record } with record keys in COLUMNS order.
function readSheet(ws, sheet, cols, report, versionInfo) {
  // Map columns by header text (or field key), so reordered columns still import.
  const byHeader = new Map();
  for (const c of cols) {
    byHeader.set(headerKey(c.header), c);
    byHeader.set(headerKey(c.key), c);
  }
  const colIndex = new Map(); // key -> column number
  const headerRow = ws.getRow(1);
  for (let i = 1; i <= ws.columnCount; i++) {
    const text = cellValue(headerRow.getCell(i));
    if (isEmpty(text)) continue;
    const col = byHeader.get(headerKey(text));
    if (!col) {
      report.warn({ sheet, row: 1, column: String(text), note: 'Unrecognized column; its values are ignored' });
    } else if (colIndex.has(col.key)) {
      report.error({ sheet, row: 1, column: String(text), value: '', expected: `one "${col.header}" column (it appears twice)` });
    } else {
      colIndex.set(col.key, i);
    }
  }

  const missing = cols.filter(c => !colIndex.has(c.key));
  for (const c of missing) {
    if (c.required) {
      report.error({ sheet, row: 1, column: c.header, value: '(column missing)', expected: 'a required column; regenerate the template' });
    } else {
      const why = versionInfo.olderMinor
        ? `Column not in this older template (${versionInfo.found.text}); field left blank`
        : 'Column missing from sheet; field left blank';
      report.warn({ sheet, row: 1, column: c.header, note: why });
    }
  }

  const hasExample = noteText(ws.getCell('A2')) === EXAMPLE_NOTE;
  const firstRow = hasExample ? 3 : 2;

  const rows = [];
  for (let r = firstRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = new Map();
    for (const [key, idx] of colIndex) raw.set(key, cellValue(row.getCell(idx)));
    if ([...raw.values()].every(isEmpty)) continue;

    const record = {};
    for (const col of cols) {
      if (!raw.has(col.key)) continue;
      const v = raw.get(col.key);
      if (isEmpty(v)) continue;
      const res = coerce(col, v);
      if (res.error) {
        report.error({ sheet, row: r, column: col.header, value: displayValue(v), expected: res.error });
      } else if (res.value !== undefined) {
        record[col.key] = res.value;
      }
    }
    rows.push({ row: r, record });
  }
  return { rows, hasExample };
}

function noteText(cell) {
  const n = cell.note;
  if (!n) return null;
  if (typeof n === 'string') return n.trim();
  if (Array.isArray(n.texts)) return n.texts.map(t => t.text).join('').trim();
  return null;
}

function displayValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v) ? 'invalid date' : v.toISOString();
  if (typeof v === 'object' && 'error' in v) return String(v.error);
  return String(v);
}

// ---------- report ----------

function makeReport() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: e => errors.push(e),
    warn: w => warnings.push(w),
  };
}

const SHEET_RANK = Object.fromEntries(SHEET_ORDER.map((s, i) => [s, i]));
function byLocation(a, b) {
  const sa = SHEET_RANK[a.sheet] ?? 99;
  const sb = SHEET_RANK[b.sheet] ?? 99;
  if (sa !== sb) return sa - sb;
  return (typeof a.row === 'number' ? a.row : 0) - (typeof b.row === 'number' ? b.row : 0);
}

// Table cells: escape pipes, collapse newlines, show values as code.
const mdCell = s => String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const mdCode = s => (s === '' || s == null ? '(blank)' : '`' + mdCell(s).replace(/`/g, "'") + '`');

// Paths for messages: relative when inside the working directory, absolute otherwise.
function rel(p) {
  const r = path.relative(process.cwd(), p);
  return !r ? p : r.startsWith('..') ? p : r;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function renderReport(report, { file, versionInfo }) {
  const errs = [...report.errors].sort(byLocation);
  const warns = [...report.warnings].sort(byLocation);
  const lines = [
    '# TraceMap Import Report',
    '',
    `**Generated:** ${stamp(new Date())}`,
    `**File:** ${file}`,
    `**Template version:** ${versionInfo.found.text} (expected ${TEMPLATE_VERSION})`,
    '',
    '## Summary',
    '',
    `${errs.length} error${errs.length === 1 ? '' : 's'} — ${errs.length ? 'import aborted, no files written' : 'none'}`,
    `${warns.length} warning${warns.length === 1 ? '' : 's'} — ${errs.length ? 'import would succeed once errors are fixed; review before distributing' : 'review before distributing'}`,
    '',
    '## Errors',
    '',
  ];
  if (errs.length) {
    lines.push('| Sheet | Row | Column | Value | Expected |', '|---|---|---|---|---|');
    for (const e of errs) lines.push(`| ${mdCell(e.sheet)} | ${mdCell(e.row)} | ${mdCell(e.column)} | ${mdCode(e.value)} | ${mdCode(e.expected)} |`);
  } else {
    lines.push('None.');
  }
  lines.push('', '## Warnings', '');
  if (warns.length) {
    lines.push('| Sheet | Row | Column | Note |', '|---|---|---|---|');
    for (const w of warns) lines.push(`| ${mdCell(w.sheet)} | ${mdCell(w.row)} | ${mdCell(w.column)} | ${mdCell(w.note)} |`);
  } else {
    lines.push('None.');
  }
  return lines.join('\n') + '\n';
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);
  const filePath = path.resolve(args.file);
  const outDir = path.resolve(args.out);
  const catalogPath = path.resolve(args.catalog);

  if (!fs.existsSync(filePath)) fatal(`file not found: ${args.file}`);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch (e) {
    fatal(`could not open ${args.file} as an XLSX workbook (${e.message})`);
  }

  const versionInfo = checkVersion(wb);
  const catalog = loadCatalog(catalogPath);
  const report = makeReport();

  if (versionInfo.olderMinor) {
    console.warn(`import: warning: template version ${versionInfo.found.text} is older than ${TEMPLATE_VERSION}; ` +
      'columns it lacks are listed in the report. Consider regenerating the template.');
  } else if (versionInfo.newerMinor) {
    report.warn({ sheet: 'Instructions', row: 2, column: 'C', note: `Template ${versionInfo.found.text} is newer than this importer (${TEMPLATE_VERSION}); columns it does not know are ignored` });
  }

  // Read every entity sheet.
  const entitySheets = SHEET_ORDER.filter(s => s !== 'Instructions');
  const sheetCols = {};
  const sheetRows = {};
  for (const sheet of entitySheets) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) fatal(`workbook has no "${sheet}" sheet. Run "npm run generate-template" for a complete template.`);
    sheetCols[sheet] = columnsFor(sheet, catalog);
    sheetRows[sheet] = readSheet(ws, sheet, sheetCols[sheet], report, versionInfo).rows;
  }

  const totalRows = entitySheets.reduce((n, s) => n + sheetRows[s].length, 0);
  if (!totalRows) fatal(`${args.file} has no data rows; nothing to import (existing YAML left untouched).`);

  // Assemble the data object, remembering which sheet row each record came from.
  const data = { catalog };
  const rowOf = {}; // entity -> [sheet row per index]
  for (const [sheet, entity] of Object.entries(ENTITIES)) {
    data[entity] = sheetRows[sheet].map(r => r.record);
    rowOf[entity] = sheetRows[sheet].map(r => r.row);
  }

  // Fold child sheets into their parents, in sheet row order.
  const childRowOf = {}; // listKey -> Map(parentIndex -> [sheet row per child index])
  for (const [sheet, spec] of Object.entries(CHILDREN)) {
    const parentEntity = ENTITIES[spec.parentSheet];
    const parents = data[parentEntity];
    const byKey = new Map();
    parents.forEach((p, i) => { if (p[spec.parentKey] != null && !byKey.has(p[spec.parentKey])) byKey.set(p[spec.parentKey], i); });
    const rowsByParent = new Map();
    const fkHeader = sheetCols[sheet].find(c => c.key === spec.fk).header;
    for (const { row, record } of sheetRows[sheet]) {
      const fk = record[spec.fk];
      if (fk == null) continue; // validate-free case: reported below as a missing required value
      const pi = byKey.get(fk);
      if (pi === undefined) {
        report.error({ sheet, row, column: fkHeader, value: fk, expected: `an existing ${spec.parentKey === 'id' ? 'ID' : 'Obligation ID'} on the ${spec.parentSheet} sheet` });
        continue;
      }
      const { [spec.fk]: _drop, ...child } = record;
      (parents[pi][spec.listKey] = parents[pi][spec.listKey] || []).push(child);
      if (!rowsByParent.has(pi)) rowsByParent.set(pi, []);
      rowsByParent.get(pi).push(row);
    }
    // Child rows with no parent key at all.
    for (const { row, record } of sheetRows[sheet]) {
      if (record[spec.fk] == null) report.error({ sheet, row, column: fkHeader, value: '', expected: 'a value (required)' });
    }
    childRowOf[spec.listKey] = rowsByParent;
  }

  // Shared validation, then translate each issue back to sheet / row / column.
  const result = validate(data);
  const locate = issue => {
    if (!issue.entity) return { sheet: issue.file, row: '—', column: issue.field || '' };
    let sheet = Object.keys(ENTITIES).find(s => ENTITIES[s] === issue.entity);
    let row = rowOf[issue.entity][issue.index];
    if (issue.child) {
      sheet = CHILD_SHEET_FOR[issue.child];
      const rows = childRowOf[issue.child].get(issue.index) || [];
      row = rows[issue.childIndex];
    }
    const col = issue.field && sheetCols[sheet].find(c => c.key === issue.field);
    return { sheet, row: row == null ? '' : row, column: col ? col.header : (issue.field || '') };
  };
  for (const e of result.errors) {
    report.error({ ...locate(e), value: e.value == null ? '' : (Array.isArray(e.value) ? e.value.join(' | ') : e.value), expected: e.expected || e.message });
  }
  for (const w of result.warnings) report.warn({ ...locate(w), note: w.message });

  // Failure: report only, no YAML.
  if (report.errors.length) {
    const reportDir = fs.existsSync(outDir) ? outDir : ROOT;
    const reportPath = path.join(reportDir, REPORT_NAME);
    fs.writeFileSync(reportPath, renderReport(report, { file: args.file, versionInfo }));
    console.error(`import: ${report.errors.length} error(s), ${report.warnings.length} warning(s). No files written.`);
    console.error(`See ${rel(reportPath)} for details.`);
    process.exit(1);
  }

  // Success: one YAML file per entity, in sheet order.
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [sheet, entity] of Object.entries(ENTITIES)) {
    const file = path.join(outDir, `${entity}.yaml`);
    fs.writeFileSync(file, yaml.dump({ [entity]: data[entity] }, DUMP_OPTIONS));
    written.push([file, data[entity].length, sheet]);
  }
  // A report left over from an earlier failed import no longer describes this data.
  const stale = path.join(outDir, REPORT_NAME);
  if (fs.existsSync(stale)) fs.unlinkSync(stale);

  console.log(`Imported ${args.file} (template ${versionInfo.found.text}) into ${rel(outDir)}`);
  for (const [file, n] of written) console.log(`  ${path.basename(file).padEnd(18)} ${String(n).padStart(4)} records`);
  const kd = data.regulations.reduce((n, r) => n + (r.key_dates || []).length, 0);
  const md = data.mappings.reduce((n, m) => n + (m.documents || []).length, 0);
  console.log(`  (${kd} key dates folded into regulations, ${md} mapping documents folded into mappings)`);
  if (report.warnings.length) {
    console.log(`  ${report.warnings.length} warning(s):`);
    for (const w of [...report.warnings].sort(byLocation)) console.log(`    ${w.sheet} row ${w.row}${w.column ? ', ' + w.column : ''}: ${w.note}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
