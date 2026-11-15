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
const { SOURCE_TYPES, OBLIGATION_TYPES, STATUSES, ISO_DATE, COLUMNS } = require('./lib/schema');

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
  if (!key) return doc;
  const list = doc[key];
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(p + ': top-level key "' + key + '" must be a list');
  return list;
}

// ---------- validation ----------

function isMissing(v) { return !v || (typeof v === 'string' && !v.trim()); }

function validate(d) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(where + ': ' + msg);
  const warn = (where, msg) => warnings.push(where + ': ' + msg);

  function indexById(list, file) {
    const map = new Map();
    list.forEach((item, i) => {
      const where = file + ' entry ' + (i + 1);
      if (!item || typeof item !== 'object') return err(where, 'is not a mapping');
      if (isMissing(item.id)) return err(where, 'missing id');
      if (map.has(item.id)) err(file, 'duplicate id "' + item.id + '"');
      map.set(item.id, item);
    });
    return map;
  }

  function checkDate(where, field, v) {
    if (v == null || v === '') return;
    if (!ISO_DATE.test(String(v)) || isNaN(Date.parse(v))) err(where, field + ' "' + v + '" is not a YYYY-MM-DD date');
  }

  // Apply required + type checks from a COLUMNS definition to a list of items.
  // Cross-reference validation (IDs must exist in other files) stays in the entity loops below.
  function validateColumns(items, colDefs, labelFn) {
    items.forEach(function(item, i) {
      if (!item || typeof item !== 'object') return;
      const where = labelFn(item, i);
      colDefs.forEach(function(col) {
        if (col.key === 'id') return; // id is handled by indexById
        const v = item[col.key];
        if (col.required && isMissing(v)) { err(where, 'missing ' + col.key); return; }
        if (isMissing(v)) return;
        if (col.type === 'enum' && col.values) {
          const vals = Array.isArray(v) ? v : [v];
          vals.forEach(function(x) {
            if (!col.values.includes(String(x))) err(where, col.key + ' must be one of ' + col.values.join(', '));
          });
        } else if (col.type === 'date') {
          checkDate(where, col.key, v);
        } else if (col.type === 'integer') {
          if (!(Number.isInteger(v) && v >= 0)) err(where, col.key + ' must be a whole number');
        }
        // 'boolean', 'string', 'pipe_list': no structural validation beyond presence
      });
    });
  }

  // Filtered column sets for child-row sheets; the foreign-key column is implicit from context.
  const kdCols = COLUMNS.Reg_Key_Dates.filter(col => col.key !== 'regulation_id');
  const mdCols = COLUMNS.Mapping_Docs.filter(col => col.key !== 'obligation_id');

  // --- catalog.yaml --- (no COLUMNS entry; validated inline)
  const c = d.catalog;
  if (isMissing(c.title)) err('catalog.yaml', 'missing title');
  if (!Array.isArray(c.layers) || c.layers.length === 0) err('catalog.yaml', 'layers must list at least one layer');
  const layers = indexById(c.layers || [], 'catalog.yaml layers');
  const applicability = indexById(c.applicability || [], 'catalog.yaml applicability');
  const facets = new Map();
  (c.facets || []).forEach((f, i) => {
    const where = 'catalog.yaml facets entry ' + (i + 1);
    if (!f.field) return err(where, 'missing field');
    if (!f.values || typeof f.values !== 'object') return err(where, 'values must be a map of value: label');
    facets.set(f.field, f);
  });
  checkDate('catalog.yaml', 'as_of', c.as_of);

  // --- build lookup maps ---
  const roles       = indexById(d.roles,       'roles.yaml');
  const documents   = indexById(d.documents,   'documents.yaml');
  const regulations = indexById(d.regulations, 'regulations.yaml');
  const topics      = indexById(d.topics,      'topics.yaml');
  const controls    = indexById(d.controls,    'controls.yaml');
  const obligations = indexById(d.obligations, 'obligations.yaml');

  // --- documents.yaml ---
  validateColumns(d.documents, COLUMNS.Documents, doc => 'documents.yaml "' + doc.id + '"');
  d.documents.forEach(doc => {
    const where = 'documents.yaml "' + doc.id + '"';
    if (!doc.layer) {
      if (doc.doc_type !== 'reference') err(where, 'missing layer (only doc_type: reference may omit it)');
    } else if (!layers.has(doc.layer)) {
      err(where, 'layer "' + doc.layer + '" is not defined in catalog.yaml layers');
    }
    if (!doc.url && !doc.status_note) warn(where, 'no url and no status_note, readers will see a dead entry');
  });

  // --- regulations.yaml ---
  validateColumns(d.regulations, COLUMNS.Regulations, r => 'regulations.yaml "' + r.id + '"');
  d.regulations.forEach(r => {
    const where = 'regulations.yaml "' + r.id + '"';
    if (r.reg_document && !documents.has(r.reg_document)) err(where, 'reg_document "' + r.reg_document + '" is not in documents.yaml');
    if (r.accountable_role && !roles.has(r.accountable_role)) err(where, 'accountable_role "' + r.accountable_role + '" is not in roles.yaml');
    const ai = r.applies_if;
    if (ai == null) warn(where, 'no applies_if; it will only show when no applicability boxes are checked');
    else if (ai !== 'always') {
      if (!Array.isArray(ai)) err(where, 'applies_if must be "always" or a list of applicability ids');
      else ai.forEach(a => { if (!applicability.has(a)) err(where, 'applies_if "' + a + '" is not in catalog.yaml applicability'); });
    }
    facets.forEach((f, field) => {
      const v = r[field];
      if (v == null) return warn(where, 'no value for facet "' + field + '"');
      (Array.isArray(v) ? v : [v]).forEach(x => {
        if (!(x in f.values)) err(where, field + ' value "' + x + '" is not listed in catalog.yaml facets');
      });
    });
    validateColumns(r.key_dates || [], kdCols, (k, i) => where + ' key_dates entry ' + (i + 1));
  });

  // --- topics.yaml ---
  validateColumns(d.topics, COLUMNS.Topics, t => 'topics.yaml "' + t.id + '"');
  d.topics.forEach(t => {
    const where = 'topics.yaml "' + t.id + '"';
    (t.related || []).forEach(x => { if (!topics.has(x)) err(where, 'related topic "' + x + '" does not exist'); });
  });

  // --- controls.yaml ---
  validateColumns(d.controls, COLUMNS.Controls, cc => 'controls.yaml "' + cc.id + '"');
  d.controls.forEach(cc => {
    const where = 'controls.yaml "' + cc.id + '"';
    if (!isMissing(cc.topic) && !topics.has(cc.topic)) err(where, 'topic "' + cc.topic + '" is not in topics.yaml');
  });

  // --- obligations.yaml ---
  validateColumns(d.obligations, COLUMNS.Obligations, o => 'obligations.yaml "' + o.id + '"');
  d.obligations.forEach(o => {
    const where = 'obligations.yaml "' + o.id + '"';
    if (!isMissing(o.regulation_id) && !regulations.has(o.regulation_id)) err(where, 'regulation_id "' + o.regulation_id + '" is not in regulations.yaml');
    if (o.common_control && !controls.has(o.common_control)) err(where, 'common_control "' + o.common_control + '" is not in controls.yaml');
    (o.topics || []).forEach(t => { if (!topics.has(t)) err(where, 'topic "' + t + '" is not in topics.yaml'); });
    if (!o.common_control && !(o.topics || []).length) warn(where, 'no common_control or topics; it will not appear on any topic page');
    if (o.accountable_role && !roles.has(o.accountable_role)) err(where, 'accountable_role "' + o.accountable_role + '" is not in roles.yaml');
  });

  // --- mappings.yaml ---
  validateColumns(d.mappings, COLUMNS.Mappings, (m, i) => 'mappings.yaml entry ' + (i + 1) + (m.obligation_id ? ' ("' + m.obligation_id + '")' : ''));
  const mapped = new Set();
  d.mappings.forEach((m, i) => {
    const where = 'mappings.yaml entry ' + (i + 1) + (m.obligation_id ? ' ("' + m.obligation_id + '")' : '');
    if (!isMissing(m.obligation_id) && !obligations.has(m.obligation_id)) err(where, 'obligation_id "' + m.obligation_id + '" is not in obligations.yaml');
    if (!isMissing(m.obligation_id)) {
      if (mapped.has(m.obligation_id)) err(where, 'obligation mapped more than once; merge the entries');
      mapped.add(m.obligation_id);
    }
    validateColumns(m.documents || [], mdCols, (e, j) => where + ' document entry ' + (j + 1));
    (m.documents || []).forEach(e => {
      if (!isMissing(e.document_id) && !documents.has(e.document_id)) err(where, 'document_id "' + e.document_id + '" is not in documents.yaml');
      if (e.layer && !layers.has(e.layer)) err(where, 'layer "' + e.layer + '" is not defined in catalog.yaml layers');
    });
    if ((m.status === 'deviations_noted' || m.status === 'verification_pending') && !m.rationale) {
      warn(where, m.status + ' without a rationale');
    }
  });

  // --- glossary.yaml ---
  validateColumns(d.glossary, COLUMNS.Glossary, (g, i) => 'glossary.yaml entry ' + (i + 1));

  return { errors, warnings };
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
    glossary: loadYaml(dir, 'glossary.yaml', 'glossary', false)
  };

  const { errors, warnings } = validate(data);
  warnings.forEach(w => console.warn('warning  ' + w));
  if (errors.length) {
    errors.forEach(e => console.error('error    ' + e));
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
