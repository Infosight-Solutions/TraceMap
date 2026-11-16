'use strict';

// Shared helpers for the test suite (node:test, no extra dependencies).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLE_DIR = path.join(ROOT, 'data-example');
const FIXTURE = path.join(EXAMPLE_DIR, 'tracemap-example.xlsx');
const EXAMPLE_CATALOG = path.join(EXAMPLE_DIR, 'catalog.yaml');
const EXAMPLE_NOTE = 'EXAMPLE ROW — delete before importing';

const ENTITY_FILES = ['regulations', 'obligations', 'mappings', 'documents', 'topics', 'controls', 'roles', 'glossary'];

// Runs a project script with node; returns { status, stdout, stderr }.
function run(script, args = []) {
  const res = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

// A fresh temp directory, removed when the test finishes.
function tempDir(t, prefix = 'tracemap-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Copies the example YAML (and catalog) into a temp dir for mutation.
function copyExample(t) {
  const dir = tempDir(t);
  for (const f of fs.readdirSync(EXAMPLE_DIR)) if (f.endsWith('.yaml')) fs.copyFileSync(path.join(EXAMPLE_DIR, f), path.join(dir, f));
  return dir;
}

// js-yaml turns YYYY-MM-DD into Dates; build.js and the importer both work with ISO strings.
function normalizeDates(node) {
  if (Array.isArray(node)) return node.map(normalizeDates);
  if (node instanceof Date) return node.toISOString().slice(0, 10);
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, normalizeDates(v)]));
  return node;
}

function readYaml(file) {
  return normalizeDates(yaml.load(fs.readFileSync(file, 'utf8')) || {});
}

// The data object validate() expects, loaded from a folder like build.js does.
function loadData(dir) {
  const data = { catalog: readYaml(path.join(dir, 'catalog.yaml')) };
  for (const key of ENTITY_FILES) {
    const p = path.join(dir, `${key}.yaml`);
    data[key] = fs.existsSync(p) ? (readYaml(p)[key] || []) : [];
  }
  return data;
}

// Edits one YAML file in place: fn receives the parsed document.
function editYaml(dir, file, fn) {
  const p = path.join(dir, file);
  const doc = yaml.load(fs.readFileSync(p, 'utf8'));
  fn(doc);
  fs.writeFileSync(p, yaml.dump(doc));
}

async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

// Opens a workbook, lets fn change it, saves it to out.
async function editWorkbook(src, out, fn) {
  const wb = await readWorkbook(src);
  await fn(wb);
  await wb.xlsx.writeFile(out);
  return out;
}

function noteText(cell) {
  const n = cell.note;
  if (!n) return null;
  return typeof n === 'string' ? n : n.texts.map(x => x.text).join('');
}

// Header text -> column number for a sheet.
function headerIndex(ws) {
  const map = {};
  ws.getRow(1).eachCell((c, i) => { map[String(c.value).replace(/\s*\*$/, '')] = i; });
  return map;
}

// Number of non-empty rows below the header.
function dataRowCount(ws) {
  let n = 0;
  ws.eachRow((r, i) => { if (i > 1) n++; });
  return n;
}

// Every cell value in a workbook as one comparable string (ignores file metadata such as timestamps).
// skip: sheet names to leave out.
async function cellDump(file, { skip = [] } = {}) {
  const wb = await readWorkbook(file);
  const out = [];
  wb.eachSheet(ws => {
    if (skip.includes(ws.name)) return;
    ws.eachRow((r, i) => r.eachCell((c, j) => out.push(`${ws.name}!${i}:${j}=${JSON.stringify(c.value)}`)));
  });
  return out.join('\n');
}

// Recursively drops trailing whitespace from strings; YAML '>' blocks end in a newline that the
// workbook does not keep (the generator trims it).
function trimTrailing(node) {
  if (Array.isArray(node)) return node.map(trimTrailing);
  if (typeof node === 'string') return node.replace(/\s+$/, '');
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, trimTrailing(v)]));
  return node;
}

module.exports = {
  ROOT, EXAMPLE_DIR, FIXTURE, EXAMPLE_CATALOG, EXAMPLE_NOTE, ENTITY_FILES,
  run, tempDir, copyExample, readYaml, loadData, editYaml,
  readWorkbook, editWorkbook, noteText, headerIndex, dataRowCount, cellDump, trimTrailing,
};
