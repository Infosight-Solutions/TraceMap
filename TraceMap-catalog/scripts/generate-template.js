#!/usr/bin/env node
'use strict';

/**
 * Generate the TraceMap XLSX authoring template from lib/schema.js and catalog.yaml.
 *
 *   node scripts/generate-template.js                                   # data/catalog.yaml
 *   node scripts/generate-template.js --catalog data-example/catalog.yaml
 *   node scripts/generate-template.js --out dist/my-template.xlsx
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
  },
  Topics: {
    id: 'access',
    name: 'Who can access what',
    blurb: 'Deciding who gets an account and what they can reach.',
    summary: 'Only the right people should see or change company data.',
    applies_to_you: 'Adding a new hire to a system | Giving someone admin rights',
    related: 'identity | logging',
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
};

const SHEET_DESCRIPTIONS = {
  Regulations: 'One row per regulation, standard, or framework. Facet columns at the right come from catalog.yaml.',
  Reg_Key_Dates: 'Key dates for regulations (effective dates, deadlines, internal milestones). Many rows per regulation.',
  Obligations: 'Individual requirements. Each belongs to one regulation.',
  Mappings: 'One row per obligation: its documentation status and rationale.',
  Mapping_Docs: 'Which documents address each mapped obligation. One row per obligation–document pair.',
  Documents: 'Policies, standards, procedures, evidence, and reference summaries the catalog links to.',
  Topics: 'Plain-language topics shown as tiles on the home page.',
  Controls: 'Shared controls that satisfy requirements across several regulations. Each belongs to one topic.',
  Roles: 'Accountable roles. Use role titles, not people’s names.',
  Glossary: 'Plain definitions. Terms and aliases get a hover definition wherever they appear in summaries.',
};

// ---------- CLI ----------

function parseArgs(argv) {
  const args = {
    catalog: 'data/catalog.yaml',
    out: 'dist/tracemap-template.xlsx',
    populate: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--catalog') args.catalog = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--populate') args.populate = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/generate-template.js [--catalog <path>] [--out <path>] [--populate <data-dir>]');
      process.exit(0);
    } else {
      fail(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`generate-template: ${msg}`);
  process.exit(1);
}

// ---------- catalog-driven columns ----------

function loadCatalog(file) {
  if (!fs.existsSync(file)) fail(`catalog not found: ${file}`);
  const catalog = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  const layers = (catalog.layers || []).map(l => l.id).filter(Boolean);
  if (!layers.length) fail(`${file} defines no layers[]; the layer dropdowns need at least one`);
  const facets = (catalog.facets || []).map(f => ({
    field: f.field,
    label: f.label || f.field,
    values: Object.keys(f.values || {}),
  }));
  return { layers, facets };
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
  if (col.type === 'date') {
    const [y, m, d] = String(v).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return v;
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

function addEntitySheet(wb, sheet, catalogInfo) {
  const cols = columnsFor(sheet, catalogInfo);
  const example = exampleFor(sheet, cols, catalogInfo);
  const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: HEADER_ROW }] });

  cols.forEach((col, i) => {
    checkListLength(sheet, col);
    const colIdx = i + 1;
    const column = ws.getColumn(colIdx);

    // Column-level style: everything below the header is unlocked; dates display as ISO.
    column.protection = { locked: false };
    if (col.type === 'date') column.numFmt = DATE_FMT;

    const width = Math.max(headerText(col).length + 2, displayLength(col, example[col.key]) + 2);
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

    // Example row
    const e = ws.getCell(EXAMPLE_ROW, colIdx);
    e.value = toCellValue(col, example[col.key]);
    e.font = { italic: true, color: { argb: EXAMPLE_GRAY } };
    e.protection = { locked: false };
    if (col.type === 'date') e.numFmt = DATE_FMT;

    // Validation
    const v = validationFor(col);
    if (v) {
      const letter = column.letter;
      ws.dataValidations.add(`${letter}${EXAMPLE_ROW}:${letter}${LAST_ROW}`, v);
    }
  });

  ws.getRow(HEADER_ROW).height = 20;
  ws.getCell(EXAMPLE_ROW, 1).note = 'EXAMPLE ROW — delete before importing';
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: cols.length } };

  return { ws, cols };
}

// ---------- Instructions sheet ----------

function addInstructionsSheet(wb, built, catalogPath) {
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
  para('Row 2', 'Example row in gray italics. Delete it before importing.');
  para('Row 3 onward', 'Your data. One record per row.');
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
  r += 1;

  heading('Importing');
  para('Run', 'From the TraceMap-catalog folder: node scripts/import-xlsx.js <this-file.xlsx>  (writes YAML into data/). Then npm run build.');
  para('Version check', 'The importer reads the template version in C2. A different major version is refused; a different minor version produces a warning.');

  for (let i = 4; i < r; i++) ws.getRow(i).alignment = { wrapText: true, vertical: 'top' };
  return ws;
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);
  if (args.populate) {
    fail('--populate is not implemented yet');
  }

  const catalogPath = path.resolve(ROOT, args.catalog);
  const outPath = path.resolve(ROOT, args.out);
  const catalogInfo = loadCatalog(catalogPath);

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
      const ws = addInstructionsSheet(wb, planned, args.catalog);
      await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true });
    } else {
      const { ws } = addEntitySheet(wb, sheet, catalogInfo);
      await ws.protect('', SHEET_PROTECTION);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);

  const rel = path.relative(process.cwd(), outPath) || outPath;
  console.log(`Wrote ${rel}`);
  console.log(`  template version ${TEMPLATE_VERSION}; ${SHEET_ORDER.length} sheets`);
  console.log(`  layers: ${catalogInfo.layers.join(', ')}`);
  console.log(`  facets: ${catalogInfo.facets.map(f => f.field).join(', ') || '(none)'}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
