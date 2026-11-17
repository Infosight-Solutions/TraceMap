#!/usr/bin/env node
'use strict';

/**
 * Generate the TraceMap XLSX authoring template from lib/schema.js and catalog.yaml.
 *
 *   node scripts/generate-template.js                                   # data/catalog.yaml
 *   node scripts/generate-template.js --catalog data-example/catalog.yaml
 *   node scripts/generate-template.js --out dist/my-template.xlsx
 *   node scripts/generate-template.js --populate data                   # export existing YAML
 *
 * --populate <data-dir> fills the workbook from that folder's YAML (no example row). This is
 * also what "npm run export-xlsx" runs. The YAML is validated first with the same validate()
 * build.js uses; on errors, import-report.md is written to <data-dir> and no workbook is written.
 * With --populate and no --catalog, the catalog is <data-dir>/catalog.yaml.
 *
 * Static column definitions come from lib/schema.js. Two things come from catalog.yaml at
 * generation time, because each organization defines its own:
 *   - facets[]  -> one extra column per facet on the Regulations sheet, with a dropdown
 *   - layers[]  -> dropdown values for the layer columns on Documents and Mapping_Docs
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const ExcelJS = require('exceljs');
const { COLUMNS, SHEET_ORDER, TEMPLATE_VERSION } = require('../lib/schema');
const { validate, formatIssue } = require('../lib/validate');
const { REPORT_NAME, mdCell, mdCode, stamp, renderReport } = require('../lib/report');

const ROOT = path.resolve(__dirname, '..');

// ---------- layout constants ----------

const HEADER_ROW = 1;
const EXAMPLE_ROW = 2;
// Validation and unlocked formatting cover rows EXAMPLE_ROW..LAST_ROW.
const LAST_ROW = 2000;

const NAVY = 'FF1B3A5C';
const WHITE = 'FFFFFFFF';
const YELLOW = 'FFFFE699';
const EXAMPLE_GRAY = 'FF808080';

const MIN_WIDTH = 10;
const MAX_WIDTH = 60;

const DATE_FMT = 'yyyy-mm-dd';

// The importer detects the example row by this exact A2 note text; keep the two in sync.
const EXAMPLE_NOTE = 'EXAMPLE ROW — delete before importing';

// Sheets in which a column with key 'layer' gets the catalog's layer dropdown.
const LAYER_SHEETS = ['Documents', 'Mapping_Docs'];

// ---------- example row content ----------
// One illustrative record per sheet. Facet and layer columns are filled from catalog.yaml.
// Dates are written as ISO strings here and converted to Excel dates when written.

const EXAMPLES = {
  Regulations: {
    id: 'soc2',
    name: 'SOC 2',
    full_title: 'AICPA Trust Services Criteria (SOC 2 examination)',
    source_type: 'standard',
    obligation_type: 'certified_to',
    applies_if: 'customer_assurance',
    accountable_role: 'ciso',
    condition: 'When customers require it',
    summary: "An independent auditor's report on how a company protects customer data.",
    applies_when: 'Customers ask for a SOC 2 report | We process data on behalf of customers',
    does_not_apply: 'No law requires SOC 2',
    context_note: '',
    reg_document: 'REF-SOC2',
    source_url: 'https://www.aicpa-cima.com/',
    version_tracked: '2017 TSC with 2022 points of focus',
    version_note: '',
    wording_note: 'Summary. Official text is published by the AICPA.',
    total_obligations: 33,
    date_display: '',
    last_reviewed: '2026-07-10',
    sequence: 10,
    parent: '',
  },
  Reg_Key_Dates: {
    regulation_id: 'soc2',
    date: '2027-03-31',
    date_text: 'Q1 2027',
    label: 'Next SOC 2 Type II report due',
    detail: 'Covers the 12-month audit period ending March 31',
    kind: 'internal',
    pending: '', // blank = default (not pending); FALSE here would suggest it must be filled
  },
  Obligations: {
    id: 'soc2-cc6-1',
    regulation_id: 'soc2',
    control_id: 'CC6.1',
    title: 'Logical access security',
    text: 'Access security software and infrastructure protect information assets.',
    official_wording: false,
    wording_note: '',
    common_control: 'authentication',
    topics: 'access | identity',
    accountable_role: 'it_ops',
    family: 'CC6 Logical and physical access',
    version: '2017 TSC',
    plain_title: 'Lock down who can log in',
    plain_summary: 'Systems check who you are before letting you in.',
    sequence: '',
  },
  Mappings: {
    obligation_id: 'soc2-cc6-1',
    status: 'deviations_noted',
    rationale: 'Policy requires MFA but no procedure covers service accounts.',
    notes: '',
    mapped_against_version: '',
    review_interval_days: 180,
    last_reviewed: '2026-07-10',
  },
  Mapping_Docs: {
    obligation_id: 'soc2-cc6-1',
    document_id: 'POL-002',
    layer: '', // filled from catalog layers
  },
  Documents: {
    id: 'POL-002',
    title: 'Access Control Policy',
    layer: '', // filled from catalog layers
    doc_type: 'Policy',
    url: 'https://docs.example.com/policies/POL-002',
    status_note: '',
    revision: 'Rev 2',
    date_filed: '2026-01-20',
    last_reviewed: '2026-01-20',
    review_interval_days: 365,
    restricted: false,
    sequence: '',
    parent: 'POL-001',
  },
  Topics: {
    id: 'access',
    name: 'Who can access what',
    blurb: 'Deciding who gets an account and what they can reach.',
    summary: 'Only the right people should see or change company data.',
    applies_to_you: 'Adding a new hire to a system | Giving someone admin rights',
    related: 'identity | logging',
    parent: '',
  },
  Controls: {
    id: 'authentication',
    name: 'Confirm identity before granting access',
    topic: 'identity',
    summary: 'Users prove who they are before getting in, using MFA where risk justifies it.',
  },
  Roles: {
    id: 'ciso',
    name: 'Chief Information Security Officer',
  },
  Glossary: {
    term: 'Processor',
    definition: 'An organization that handles personal data on behalf of a controller.',
    aliases: 'processors',
  },
  Relationships: {
    from_item: 'POL-002',
    to_item: 'topic:access',
    type: 'references',
    description: 'The policy sets the rules this topic summarizes',
  },
};

const SHEET_DESCRIPTIONS = {
  Regulations: 'One row per regulation, standard, or framework. Facet columns at the right come from catalog.yaml.',
  Reg_Key_Dates: 'Key dates for regulations (effective dates, deadlines, internal milestones). Many rows per regulation.',
  Obligations: 'Individual requirements. Each belongs to one regulation.',
  Mappings: 'One row per obligation: its documentation status and rationale.',
  Mapping_Docs: 'Which documents address each mapped obligation. One row per obligation–document pair. (Legacy layout: still supported; a later release moves it to Relationships.)',
  Documents: 'Policies, standards, procedures, evidence, and reference summaries the catalog links to.',
  Topics: 'Plain-language topics shown as tiles on the home page.',
  Controls: 'Shared controls that satisfy requirements across several regulations. Each belongs to one topic.',
  Roles: 'Accountable roles. Use role titles, not people’s names.',
  Glossary: 'Plain definitions. Terms and aliases get a hover definition wherever they appear in summaries.',
  Relationships: 'Links between any two items (regulations, obligations, documents, topics, controls). One row per link. Optional.',
};

// ---------- CLI ----------

const USAGE = `Usage: node scripts/generate-template.js [--catalog <path>] [--out <path>] [--populate <data-dir>]

  --catalog <path>       catalog.yaml supplying facet columns and layer dropdowns
                         (default: data/catalog.yaml, or <data-dir>/catalog.yaml with --populate)
  --out <path>           workbook to write (default: dist/tracemap-template.xlsx)
  --populate <data-dir>  fill the workbook from the YAML files in <data-dir> instead of an example row.
                         The YAML is validated first; on errors, ${REPORT_NAME} is written to <data-dir>
                         and no workbook is written. "npm run export-xlsx" runs this for data/
                         (writing dist/tracemap-export.xlsx); use "npm run export-xlsx -- --populate <data-dir>"
                         for another folder.

Later flags override earlier ones, so npm script defaults can be overridden after "--".`;

function parseArgs(argv) {
  const args = {
    catalog: null,
    out: 'dist/tracemap-template.xlsx',
    populate: null,
  };
  const value = flag => {
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`${flag} needs a value\n\n${USAGE}`);
    return v;
  };
  let i;
  for (i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--catalog') args.catalog = value(a);
    else if (a === '--out') args.out = value(a);
    else if (a === '--populate') args.populate = value(a);
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${a}\n\n${USAGE}`);
    }
  }
  if (!args.catalog) args.catalog = args.populate ? path.join(args.populate, 'catalog.yaml') : 'data/catalog.yaml';
  return args;
}

function fail(msg) {
  console.error(`generate-template: ${msg}`);
  process.exit(1);
}

// ---------- catalog-driven columns ----------

function loadCatalog(file) {
  if (!fs.existsSync(file)) fail(`catalog not found: ${file}`);
  let catalog;
  try {
    catalog = normalizeDates(yaml.load(fs.readFileSync(file, 'utf8')) || {});
  } catch (e) {
    fail(`YAML syntax error in ${file}:\n  ${e.message}`);
  }
  const layers = (catalog.layers || []).map(l => l.id).filter(Boolean);
  if (!layers.length) fail(`${file} defines no layers[]; the layer dropdowns need at least one`);
  const facets = (catalog.facets || []).map(f => ({
    field: f.field,
    label: f.label || f.field,
    values: Object.keys(f.values || {}),
  }));
  return { layers, facets, catalog };
}

// Returns the full column list for a sheet: static COLUMNS plus catalog-driven additions.
// Catalog-driven dropdowns are expressed as enum columns so the rest of the code treats them alike.
function columnsFor(sheet, { layers, facets }) {
  let cols = COLUMNS[sheet].map(c => ({ ...c }));
  if (LAYER_SHEETS.includes(sheet)) {
    cols = cols.map(c => (c.key === 'layer'
      ? { ...c, type: 'enum', values: layers, note: [c.note, 'Layer IDs come from catalog.yaml layers.'].filter(Boolean).join(' ') }
      : c));
  }
  if (sheet === 'Regulations') {
    for (const f of facets) {
      cols.push({
        key: f.field,
        header: f.label,
        required: false,
        type: 'enum',
        values: f.values,
        note: `Facet "${f.field}" from catalog.yaml.`,
        facet: true,
      });
    }
  }
  return cols;
}

function exampleFor(sheet, cols, { layers }) {
  const ex = { ...EXAMPLES[sheet] };
  for (const c of cols) {
    if (c.facet) ex[c.key] = c.values[0] || '';
    if (c.key === 'layer' && LAYER_SHEETS.includes(sheet)) {
      ex[c.key] = sheet === 'Documents' ? layers[0] : layers[layers.length - 1];
    }
  }
  return ex;
}

// ---------- --populate: YAML records -> sheet rows ----------

// File and top-level key per top-level sheet. Reg_Key_Dates and Mapping_Docs are flattened
// from nested lists (regulation.key_dates[], mapping.documents[]), not read from their own files.
const SOURCES = {
  Regulations: ['regulations.yaml', 'regulations'],
  Obligations: ['obligations.yaml', 'obligations'],
  Mappings:    ['mappings.yaml',    'mappings'],
  Documents:   ['documents.yaml',   'documents'],
  Topics:      ['topics.yaml',      'topics'],
  Controls:    ['controls.yaml',    'controls'],
  Roles:       ['roles.yaml',       'roles'],
  Glossary:    ['glossary.yaml',    'glossary'],
  Relationships: ['relationships.yaml', 'relationships'],
};

// Files added after most catalogs were written; a missing one is normal, so no warning.
const QUIET_IF_MISSING = new Set(['relationships.yaml']);

// Nested lists that become their own sheets; not reported as unmapped fields.
const NESTED = { Regulations: 'key_dates', Mappings: 'documents' };

// js-yaml turns YYYY-MM-DD into Date objects; turn them back into ISO strings (same as build.js).
function normalizeDates(node) {
  if (Array.isArray(node)) return node.map(normalizeDates);
  if (node instanceof Date) return node.toISOString().slice(0, 10);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = normalizeDates(node[k]);
    return out;
  }
  return node;
}

function loadList(dir, file, key) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) {
    if (!QUIET_IF_MISSING.has(file)) console.warn(`  warning: ${p} not found; its sheet will be empty`);
    return [];
  }
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(p, 'utf8')) || {};
  } catch (e) {
    fail(`YAML syntax error in ${p}:\n  ${e.message}`);
  }
  const list = normalizeDates(doc)[key];
  if (list == null) return [];
  if (!Array.isArray(list)) fail(`${p}: top-level key "${key}" must be a list`);
  return list;
}

// Returns { sheetName: [record, ...] } for every entity sheet, in source YAML order.
function loadRecords(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`--populate directory not found: ${dir}`);
  const records = {};
  for (const [sheet, [file, key]] of Object.entries(SOURCES)) records[sheet] = loadList(dir, file, key);

  records.Reg_Key_Dates = [];
  for (const r of records.Regulations) {
    for (const kd of r.key_dates || []) records.Reg_Key_Dates.push({ regulation_id: r.id, ...kd });
  }
  records.Mapping_Docs = [];
  for (const m of records.Mappings) {
    for (const d of m.documents || []) records.Mapping_Docs.push({ obligation_id: m.obligation_id, ...d });
  }
  return records;
}

// Lists fields present in the YAML that have no column, so data loss is visible, not silent.
function reportUnmappedFields(sheet, cols, rows) {
  const known = new Set(cols.map(c => c.key));
  if (NESTED[sheet]) known.add(NESTED[sheet]);
  const unknown = new Map();
  for (const row of rows) {
    for (const k of Object.keys(row || {})) if (!known.has(k)) unknown.set(k, (unknown.get(k) || 0) + 1);
  }
  for (const [k, n] of unknown) console.warn(`  warning: ${sheet}: field "${k}" has no column; dropped from ${n} record(s)`);
}

// ---------- cell helpers ----------

function headerText(col) {
  return col.required ? `${col.header} *` : col.header;
}

function headerNote(col) {
  const lines = [`${col.key}${col.required ? ' (required)' : ' (optional)'}`];
  if (col.note) lines.push(col.note);
  switch (col.type) {
    case 'enum':      lines.push(`Allowed values: ${col.values.join(' | ')}`); break;
    case 'pipe_list': lines.push('Multiple values: separate with a pipe, e.g. a | b | c'); break;
    case 'date':      lines.push('Date in ISO format YYYY-MM-DD'); break;
    case 'integer':   lines.push('Whole number, 0 or greater'); break;
    case 'boolean':   lines.push('TRUE or FALSE'); break;
    default: break;
  }
  return lines.join('\n');
}

function toCellValue(col, v) {
  if (v === undefined || v === null || v === '') return null;
  switch (col.type) {
    case 'date': {
      const [y, m, d] = String(v).split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    case 'pipe_list':
      return Array.isArray(v) ? v.join(' | ') : String(v); // a scalar such as applies_if: always
    case 'boolean':
      return v === true || v === 'true' || v === 'TRUE';
    case 'integer':
      return Number(v);
    default:
      // Folded YAML scalars (>) end in a newline; drop trailing whitespace so cells stay clean.
      return typeof v === 'string' ? v.replace(/\s+$/, '') : v;
  }
}

function displayLength(col, v) {
  if (v === undefined || v === null || v === '') return 0;
  if (col.type === 'date') return DATE_FMT.length;
  return String(v).length;
}

function validationFor(col) {
  switch (col.type) {
    case 'enum':
      return {
        type: 'list',
        allowBlank: true,
        formulae: [`"${col.values.join(',')}"`],
        showErrorMessage: true,
        errorTitle: col.header,
        error: `Choose one of: ${col.values.join(', ')}`,
      };
    case 'boolean':
      return {
        type: 'list',
        allowBlank: true,
        formulae: ['"TRUE,FALSE"'],
        showErrorMessage: true,
        errorTitle: col.header,
        error: 'Choose TRUE or FALSE',
      };
    case 'integer':
      return {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        allowBlank: true,
        formulae: [0],
        showErrorMessage: true,
        errorTitle: col.header,
        error: 'Enter a whole number, 0 or greater',
      };
    case 'date':
      return {
        type: 'date',
        operator: 'greaterThan',
        allowBlank: true,
        formulae: [new Date(Date.UTC(1900, 0, 1))],
        showErrorMessage: true,
        errorTitle: col.header,
        error: 'Enter a date as YYYY-MM-DD',
      };
    default:
      return null; // string, pipe_list
  }
}

// Excel caps list validations written inline at 255 characters.
function checkListLength(sheet, col) {
  if (col.type !== 'enum') return;
  const len = col.values.join(',').length;
  if (!col.values.length) fail(`${sheet}.${col.key}: dropdown has no values`);
  if (len > 255) fail(`${sheet}.${col.key}: dropdown values exceed Excel's 255-character limit (${len})`);
}

const SHEET_PROTECTION = {
  selectLockedCells: true,
  selectUnlockedCells: true,
  formatCells: true,
  formatColumns: true,
  formatRows: true,
  insertRows: true,
  deleteRows: true,
  sort: true,
  autoFilter: true,
};

// ---------- entity sheets ----------

// Blank template: row 2 is the styled example row, with the A2 note the importer looks for.
// Populated (--populate, records is an array): no example row; records start at row 2.
// The importer skips row 2 only when the A2 note is present, so both layouts import correctly.
function addEntitySheet(wb, sheet, catalogInfo, records) {
  const cols = columnsFor(sheet, catalogInfo);
  const populating = Array.isArray(records);
  if (populating) reportUnmappedFields(sheet, cols, records);
  const rows = populating ? records : [exampleFor(sheet, cols, catalogInfo)];
  const lastDataRow = Math.max(HEADER_ROW + 1, HEADER_ROW + rows.length);
  const lastRow = Math.max(LAST_ROW, lastDataRow + 500);
  const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: HEADER_ROW }] });

  cols.forEach((col, i) => {
    checkListLength(sheet, col);
    const colIdx = i + 1;
    const column = ws.getColumn(colIdx);

    // Column-level style: everything below the header is unlocked; dates display as ISO.
    column.protection = { locked: false };
    if (col.type === 'date') column.numFmt = DATE_FMT;

    const contentLen = Math.max(0, ...rows.map(r => displayLength(col, toCellValue(col, r[col.key]))));
    const width = Math.max(headerText(col).length + 2, contentLen + 2);
    column.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));

    // Header
    const h = ws.getCell(HEADER_ROW, colIdx);
    h.value = headerText(col);
    h.font = { bold: true, color: { argb: NAVY } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? YELLOW : WHITE } };
    h.border = { bottom: { style: 'medium', color: { argb: NAVY } } };
    h.alignment = { vertical: 'middle' };
    h.protection = { locked: true };
    h.note = headerNote(col);

    // Example row or populated records, from row 2. Facet columns are ordinary columns here:
    // col.key is the facet field name, read from the record like any other.
    rows.forEach((rec, r) => {
      const c = ws.getCell(EXAMPLE_ROW + r, colIdx);
      c.value = toCellValue(col, rec[col.key]);
      c.protection = { locked: false };
      if (col.type === 'date') c.numFmt = DATE_FMT;
      if (!populating) c.font = { italic: true, color: { argb: EXAMPLE_GRAY } };
    });

    // Validation
    const v = validationFor(col);
    if (v) {
      const letter = column.letter;
      ws.dataValidations.add(`${letter}${EXAMPLE_ROW}:${letter}${lastRow}`, v);
    }
  });

  ws.getRow(HEADER_ROW).height = 20;
  if (!populating) ws.getCell(EXAMPLE_ROW, 1).note = EXAMPLE_NOTE;
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: lastDataRow, column: cols.length } };

  return { ws, cols, rowCount: populating ? rows.length : 0 };
}

// ---------- Instructions sheet ----------

function addInstructionsSheet(wb, built, catalogPath, populated) {
  const ws = wb.addWorksheet('Instructions');
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 100;

  const label = (r, text) => {
    const c = ws.getCell(r, 2);
    c.value = text;
    c.font = { bold: true, color: { argb: NAVY } };
    c.alignment = { vertical: 'top' };
  };
  const body = (r, text) => {
    const c = ws.getCell(r, 3);
    c.value = text;
    c.alignment = { wrapText: true, vertical: 'top' };
  };

  // Machine-read version cell. The importer reads C2; do not move it.
  label(2, 'Template version');
  const v = ws.getCell('C2');
  v.value = TEMPLATE_VERSION;
  v.font = { bold: true };
  v.alignment = { horizontal: 'left' };
  v.note = 'Read by the importer. Do not edit or move this cell.';

  let r = 4;
  const heading = text => {
    const c = ws.getCell(r, 2);
    c.value = text;
    c.font = { bold: true, size: 13, color: { argb: NAVY } };
    r += 1;
  };
  const para = (lbl, text) => {
    if (lbl) label(r, lbl);
    body(r, text);
    r += 1;
  };

  heading('TraceMap data template');
  para(null, 'Fill in one tab per kind of record, then run the importer to turn this workbook into the YAML files TraceMap builds from. ' +
    `Generated from ${path.relative(ROOT, path.resolve(catalogPath)) || catalogPath}; facet columns and layer dropdowns reflect that catalog.`);
  r += 1;

  heading('How each tab is laid out');
  para('Row 1', 'Column headers. Locked. Hover a header to see what the field means and what values it accepts.');
  para('Required columns', 'Header ends in * and has a yellow fill. Optional columns have a white header.');
  if (populated) {
    para('Row 2 onward', 'Data, one record per row. This workbook was filled from existing YAML files, so it has no example row.');
  } else {
    para('Row 2', 'Example row in gray italics. Delete it before importing (the importer also skips it automatically).');
    para('Row 3 onward', 'Your data. One record per row.');
  }
  para('Dropdowns', 'Columns with a fixed set of values (types, statuses, layers, facets, TRUE/FALSE) offer a dropdown and reject other values.');
  r += 1;

  heading('Tabs');
  for (const { sheet, cols } of built) {
    const extras = [];
    if (cols.some(c => c.facet)) extras.push(`facet columns: ${cols.filter(c => c.facet).map(c => c.header).join(', ')}`);
    if (cols.some(c => c.key === 'layer')) extras.push('layer dropdown from catalog.yaml');
    para(sheet, SHEET_DESCRIPTIONS[sheet] + (extras.length ? ` (${extras.join('; ')})` : ''));
  }
  r += 1;

  heading('Conventions');
  para('Lists', 'Fields that hold several values use a pipe between them: access | identity | logging. Spaces around the pipe are ignored.');
  para('IDs', 'IDs must be unique within their tab and must not contain a slash (/) or hash (#). Lowercase letters, digits, hyphens, and underscores are safest. Other tabs refer to records by these IDs, so changing one means updating every reference.');
  para('Dates', 'Use ISO format YYYY-MM-DD (for example 2026-07-10). Date columns are formatted to display this way.');
  para('TRUE / FALSE', 'Use the dropdown. Blank means the field is not set and the default applies.');
  para('Sequence', 'Optional sort position (Regulations, Obligations, Documents). Lower numbers come first; rows without one keep their order after those with one.');
  para('Parent', 'Optional ID of another row on the same tab (Regulations, Topics, Documents). A row cannot be its own parent, directly or through a chain.');
  para('Relationships', 'From Item and To Item take any regulation, obligation, document, topic, or control ID. If two kinds of item share an ID, add the kind in front: topic:logging or control:logging.');
  r += 1;

  heading('Importing');
  para('Run', 'From the TraceMap-catalog folder: npm run import -- --file <this-file.xlsx>  (writes YAML into data/). Then npm run build. ' +
    'If anything is wrong, no YAML is written and import-report.md lists each problem by tab, row, and column.');
  para('Version check', 'The importer reads the template version in C2. A different major version is refused; a different minor version produces a warning.');

  for (let i = 4; i < r; i++) ws.getRow(i).alignment = { wrapText: true, vertical: 'top' };
  return ws;
}

// ---------- validation before export ----------

// Runs the build's validate() on the YAML being exported. On errors: writes the report into the
// data folder, prints a summary, exits 1, and no workbook is written. Warnings print and continue.
function checkBeforeExport(records, catalog, args) {
  const data = { catalog };
  for (const [sheet, [, key]] of Object.entries(SOURCES)) data[key] = records[sheet];
  const { errors, warnings } = validate(data);
  const dataDir = path.resolve(ROOT, args.populate);
  const reportPath = path.join(dataDir, REPORT_NAME);

  for (const w of warnings) console.warn(`  warning: ${formatIssue(w)}`);
  if (!errors.length) {
    // A report from an earlier failed run no longer describes this data.
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    return;
  }

  // 'regulations.yaml "soc2" key_dates entry 1' -> '"soc2" key_dates entry 1'
  const entry = i => (i.where.startsWith(i.file) ? i.where.slice(i.file.length).trim() : i.where) || '—';
  fs.writeFileSync(reportPath, renderReport({
    title: 'TraceMap Export Report',
    action: 'export',
    outcome: 'no workbook written',
    meta: [
      ['Generated', stamp()],
      ['Data folder', args.populate],
      ['Catalog', args.catalog],
      ['Workbook (not written)', args.out],
    ],
    errors,
    warnings,
    errorColumns: [
      ['File', e => mdCell(e.file)], ['Entry', e => mdCell(entry(e))], ['Field', e => mdCell(e.field || '')],
      ['Value', e => mdCode(Array.isArray(e.value) ? e.value.join(' | ') : e.value)], ['Expected', e => mdCode(e.expected || e.message)],
    ],
    warningColumns: [
      ['File', w => mdCell(w.file)], ['Entry', w => mdCell(entry(w))], ['Field', w => mdCell(w.field || '')], ['Note', w => mdCell(w.message)],
    ],
  }));
  console.error(`generate-template: ${errors.length} error(s), ${warnings.length} warning(s) in ${args.populate}. No workbook written.`);
  console.error(`See ${path.relative(process.cwd(), reportPath).startsWith('..') ? reportPath : path.relative(process.cwd(), reportPath)} for details.`);
  process.exit(1);
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);

  const catalogPath = path.resolve(ROOT, args.catalog);
  const outPath = path.resolve(ROOT, args.out);
  const catalogInfo = loadCatalog(catalogPath);
  const records = args.populate ? loadRecords(path.resolve(ROOT, args.populate)) : null;
  if (records) checkBeforeExport(records, catalogInfo.catalog, args);
  const counts = [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TraceMap';
  wb.created = new Date();

  // Instructions is listed first in SHEET_ORDER but its "Tabs" section describes the entity
  // sheets, so build entity column lists first, then add sheets in SHEET_ORDER.
  const entitySheets = SHEET_ORDER.filter(s => s !== 'Instructions');
  for (const s of entitySheets) {
    if (!COLUMNS[s]) fail(`SHEET_ORDER lists "${s}" but COLUMNS has no definition for it`);
  }
  const planned = entitySheets.map(sheet => ({ sheet, cols: columnsFor(sheet, catalogInfo) }));

  for (const sheet of SHEET_ORDER) {
    if (sheet === 'Instructions') {
      const ws = addInstructionsSheet(wb, planned, args.catalog, Boolean(records));
      await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true });
    } else {
      const { ws, rowCount } = addEntitySheet(wb, sheet, catalogInfo, records ? records[sheet] : undefined);
      await ws.protect('', SHEET_PROTECTION);
      counts.push([sheet, rowCount]);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);

  const rel = path.relative(process.cwd(), outPath) || outPath;
  console.log(`Wrote ${rel}`);
  console.log(`  template version ${TEMPLATE_VERSION}; ${SHEET_ORDER.length} sheets`);
  console.log(`  layers: ${catalogInfo.layers.join(', ')}`);
  console.log(`  facets: ${catalogInfo.facets.map(f => f.field).join(', ') || '(none)'}`);
  if (records) {
    console.log(`  populated from ${path.relative(process.cwd(), path.resolve(ROOT, args.populate)) || args.populate} (no example row; data from row 2):`);
    for (const [sheet, n] of counts) console.log(`    ${sheet.padEnd(14)} ${String(n).padStart(4)} rows`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
