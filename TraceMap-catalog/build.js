#!/usr/bin/env node
/*
 * tracemap build
 *
 * Reads the YAML files in a data directory, validates every cross-reference,
 * and writes one self-contained HTML file with the data, styles, and app code
 * embedded. The output needs no server and no network access.
 *
 * Usage:
 *   node build.js                       # data/ -> dist/tracemap.html
 *   node build.js --data data-example   # public example dataset
 *   node build.js --data data --out dist/catalog.html
 */
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { validate, formatIssue } = require('./lib/validate');
const { checkDataVersions } = require('./lib/versions');

const TOOL_VERSION = '0.2.0';

// ---------- arguments ----------
function parseArgs(argv) {
  const args = { data: 'data', out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') args.data = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node build.js [--data <dir>] [--out <file>]');
      process.exit(0);
    } else {
      console.error('Unknown argument: ' + a);
      process.exit(1);
    }
  }
  if (!args.out) {
    const base = path.basename(path.resolve(args.data));
    args.out = base === 'data'
      ? 'dist/tracemap.html'
      : 'dist/tracemap-' + base.replace(/^data-/, '') + '.html';
  }
  return args;
}

// ---------- loading ----------
function toIsoDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}

// js-yaml turns YYYY-MM-DD into Date objects; turn them back into strings.
function normalizeDates(node) {
  if (Array.isArray(node)) return node.map(normalizeDates);
  if (node instanceof Date) return toIsoDate(node);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = normalizeDates(node[k]);
    return out;
  }
  return node;
}

// schema_version of every file that was read, for checkDataVersions().
const versions = [];

function loadYaml(dir, file, key, required) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) {
    if (required) throw new Error('Missing required file: ' + p);
    return key ? [] : {};
  }
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(p, 'utf8')) || {};
  } catch (e) {
    throw new Error('YAML syntax error in ' + p + ':\n  ' + e.message);
  }
  doc = normalizeDates(doc);
  versions.push([file, doc.schema_version]);
  if (!key) return doc;
  const list = doc[key];
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(p + ': top-level key "' + key + '" must be a list');
  return list;
}

// ---------- main ----------
function main() {
  const args = parseArgs(process.argv);
  const dir = path.resolve(args.data);

  const data = {
    catalog: loadYaml(dir, 'catalog.yaml', null, true),
    roles: loadYaml(dir, 'roles.yaml', 'roles', false),
    documents: loadYaml(dir, 'documents.yaml', 'documents', true),
    regulations: loadYaml(dir, 'regulations.yaml', 'regulations', true),
    topics: loadYaml(dir, 'topics.yaml', 'topics', true),
    controls: loadYaml(dir, 'controls.yaml', 'controls', false),
    obligations: loadYaml(dir, 'obligations.yaml', 'obligations', true),
    mappings: loadYaml(dir, 'mappings.yaml', 'mappings', true),
    glossary: loadYaml(dir, 'glossary.yaml', 'glossary', false),
    relationships: loadYaml(dir, 'relationships.yaml', 'relationships', false)
  };

  // A different major schema version means the files may not mean what this build expects,
  // so stop before validating them.
  const sv = checkDataVersions(versions);
  sv.warnings.forEach(w => console.warn('warning  ' + w));
  if (sv.errors.length) {
    sv.errors.forEach(e => console.error('error    ' + e));
    console.error('\nBuild failed: schema version. Nothing was written.');
    process.exit(1);
  }

  const { errors, warnings } = validate(data);
  warnings.forEach(w => console.warn('warning  ' + formatIssue(w)));
  if (errors.length) {
    errors.forEach(e => console.error('error    ' + formatIssue(e)));
    console.error('\nBuild failed: ' + errors.length + ' error(s). Nothing was written.');
    process.exit(1);
  }

  data.build_metadata = {
    tool_version: TOOL_VERSION,
    built_at: new Date().toISOString(),
    data_dir: path.basename(dir)
  };

  const src = path.join(__dirname, 'src');
  const template = fs.readFileSync(path.join(src, 'template.html'), 'utf8');
  const css = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
  // "</" inside a script block would end it early; escape it.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');

  const replace = (text, token, value) => {
    if (!text.includes(token)) throw new Error('template.html is missing the ' + token + ' placeholder');
    return text.split(token).join(value);
  };
  let html = template;
  html = replace(html, '/*__STYLES__*/', css);
  html = replace(html, '/*__COMPLIANCE_DATA__*/', 'window.TRACEMAP_DATA = ' + json + ';');
  html = replace(html, '/*__APP__*/', app.replace(/<\/script/gi, '<\\/script'));
  const c = data.catalog;
  const orgPart = c.organization ? c.organization + ' · ' : '';
  const purposePart = c.title || 'TraceMap';
  const brandSuffix = purposePart !== 'TraceMap' ? ' · TraceMap' : '';
  html = replace(html, '__TITLE__', escapeHtml(orgPart + purposePart + brandSuffix));

  const out = path.resolve(args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);

  console.log('Built ' + path.relative(process.cwd(), out));
  console.log('  ' + data.regulations.length + ' regulations, ' + data.obligations.length + ' obligations, ' +
    data.mappings.length + ' mappings, ' + data.documents.length + ' documents, ' + data.topics.length + ' topics');
  if (warnings.length) console.log('  ' + warnings.length + ' warning(s) above');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
