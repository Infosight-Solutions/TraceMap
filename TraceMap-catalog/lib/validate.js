'use strict';

// Validation of an assembled TraceMap data object. Shared by build.js (YAML in) and
// scripts/import-xlsx.js (XLSX in) so both run the exact same checks.
//
// validate(d) returns { errors, warnings }, each a list of issues:
//   {
//     where:   'regulations.yaml "soc2"'   human label, as build.js has always printed it
//     message: 'missing name'
//     file:    'regulations.yaml'
//     entity:  'regulations'              key in d (undefined for catalog.yaml)
//     index:   0                          position in d[entity]
//     child:   'key_dates' | 'documents'  set when the issue is on a nested entry
//     childIndex: 0
//     field:   'name'                     field the issue is about, when there is one
//     value:   <the offending value>
//     expected: 'a value (required)'      what would have been accepted
//   }
// formatIssue(issue) gives the one-line text build.js prints: '<where>: <message>'.

const { ISO_DATE, COLUMNS } = require('./schema');

function isMissing(v) { return !v || (typeof v === 'string' && !v.trim()); }

function formatIssue(issue) { return issue.where + ': ' + issue.message; }

function validate(d) {
  const errors = [];
  const warnings = [];
  const err = (loc, message, extra) => errors.push(Object.assign({}, loc, { message }, extra));
  const warn = (loc, message, extra) => warnings.push(Object.assign({}, loc, { message }, extra));

  // Location helpers. A location carries the human label plus enough to find the source row.
  const at = (file, entity, index, where) => ({ where, file, entity, index });
  const atChild = (parent, child, childIndex, where) => Object.assign({}, parent, { where, child, childIndex });
  const fileOnly = file => ({ where: file, file });

  function indexById(list, file, entity) {
    const map = new Map();
    list.forEach((item, i) => {
      const loc = at(file, entity, i, file + ' entry ' + (i + 1));
      if (!item || typeof item !== 'object') return err(loc, 'is not a mapping');
      if (isMissing(item.id)) return err(loc, 'missing id', { field: 'id', expected: 'a value (required)' });
      if (map.has(item.id)) err(Object.assign({}, loc, { where: file }), 'duplicate id "' + item.id + '"', { field: 'id', value: item.id, expected: 'an ID not used by another row' });
      map.set(item.id, item);
    });
    return map;
  }

  function checkDate(loc, field, v) {
    if (v == null || v === '') return;
    if (!ISO_DATE.test(String(v)) || isNaN(Date.parse(v))) err(loc, field + ' "' + v + '" is not a YYYY-MM-DD date', { field, value: v, expected: 'YYYY-MM-DD' });
  }

  // Apply required + type checks from a COLUMNS definition to a list of items.
  // Cross-reference validation (IDs must exist in other files) stays in the entity loops below.
  function validateColumns(items, colDefs, locFn) {
    items.forEach(function(item, i) {
      if (!item || typeof item !== 'object') return;
      const loc = locFn(item, i);
      colDefs.forEach(function(col) {
        if (col.key === 'id') return; // id is handled by indexById
        const v = item[col.key];
        if (col.required && isMissing(v)) { err(loc, 'missing ' + col.key, { field: col.key, value: v, expected: 'a value (required)' }); return; }
        if (isMissing(v)) return;
        if (col.type === 'enum' && col.values) {
          const vals = Array.isArray(v) ? v : [v];
          vals.forEach(function(x) {
            if (!col.values.includes(String(x))) err(loc, col.key + ' must be one of ' + col.values.join(', '), { field: col.key, value: x, expected: col.values.join(' | ') });
          });
        } else if (col.type === 'date') {
          checkDate(loc, col.key, v);
        } else if (col.type === 'integer') {
          if (!(Number.isInteger(v) && v >= 0)) err(loc, col.key + ' must be a whole number', { field: col.key, value: v, expected: 'a whole number, 0 or greater' });
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
  const CAT = fileOnly('catalog.yaml');
  if (isMissing(c.title)) err(CAT, 'missing title', { field: 'title', expected: 'a value (required)' });
  if (!Array.isArray(c.layers) || c.layers.length === 0) err(CAT, 'layers must list at least one layer', { field: 'layers' });
  const layers = indexById(c.layers || [], 'catalog.yaml layers');
  const applicability = indexById(c.applicability || [], 'catalog.yaml applicability');
  const facets = new Map();
  (c.facets || []).forEach((f, i) => {
    const loc = fileOnly('catalog.yaml facets entry ' + (i + 1));
    loc.file = 'catalog.yaml';
    if (!f.field) return err(loc, 'missing field', { field: 'field' });
    if (!f.values || typeof f.values !== 'object') return err(loc, 'values must be a map of value: label', { field: 'values' });
    facets.set(f.field, f);
  });
  checkDate(CAT, 'as_of', c.as_of);

  const layerList = [...layers.keys()].join(' | ');
  const idsIn = file => 'an ID in ' + file;

  // --- build lookup maps ---
  const roles       = indexById(d.roles,       'roles.yaml',       'roles');
  const documents   = indexById(d.documents,   'documents.yaml',   'documents');
  const regulations = indexById(d.regulations, 'regulations.yaml', 'regulations');
  const topics      = indexById(d.topics,      'topics.yaml',      'topics');
  const controls    = indexById(d.controls,    'controls.yaml',    'controls');
  const obligations = indexById(d.obligations, 'obligations.yaml', 'obligations');

  // --- documents.yaml ---
  const docLoc = (doc, i) => at('documents.yaml', 'documents', i, 'documents.yaml "' + doc.id + '"');
  validateColumns(d.documents, COLUMNS.Documents, docLoc);
  d.documents.forEach((doc, i) => {
    const loc = docLoc(doc, i);
    if (!doc.layer) {
      if (doc.doc_type !== 'reference') err(loc, 'missing layer (only doc_type: reference may omit it)', { field: 'layer', expected: layerList + ' (may be blank only when doc_type is reference)' });
    } else if (!layers.has(doc.layer)) {
      err(loc, 'layer "' + doc.layer + '" is not defined in catalog.yaml layers', { field: 'layer', value: doc.layer, expected: layerList });
    }
    if (!doc.url && !doc.status_note) warn(loc, 'no url and no status_note, readers will see a dead entry', { field: 'url' });
  });

  // --- regulations.yaml ---
  const regLoc = (r, i) => at('regulations.yaml', 'regulations', i, 'regulations.yaml "' + r.id + '"');
  validateColumns(d.regulations, COLUMNS.Regulations, regLoc);
  d.regulations.forEach((r, i) => {
    const loc = regLoc(r, i);
    if (r.reg_document && !documents.has(r.reg_document)) err(loc, 'reg_document "' + r.reg_document + '" is not in documents.yaml', { field: 'reg_document', value: r.reg_document, expected: idsIn('Documents') });
    if (r.accountable_role && !roles.has(r.accountable_role)) err(loc, 'accountable_role "' + r.accountable_role + '" is not in roles.yaml', { field: 'accountable_role', value: r.accountable_role, expected: idsIn('Roles') });
    const ai = r.applies_if;
    if (ai == null) warn(loc, 'no applies_if; it will only show when no applicability boxes are checked', { field: 'applies_if' });
    else if (ai !== 'always') {
      const aiExpected = '"always" or IDs from catalog.yaml applicability: ' + [...applicability.keys()].join(' | ');
      if (!Array.isArray(ai)) err(loc, 'applies_if must be "always" or a list of applicability ids', { field: 'applies_if', value: ai, expected: aiExpected });
      else ai.forEach(a => { if (!applicability.has(a)) err(loc, 'applies_if "' + a + '" is not in catalog.yaml applicability', { field: 'applies_if', value: a, expected: aiExpected }); });
    }
    facets.forEach((f, field) => {
      const v = r[field];
      if (v == null) return warn(loc, 'no value for facet "' + field + '"', { field });
      (Array.isArray(v) ? v : [v]).forEach(x => {
        if (!(x in f.values)) err(loc, field + ' value "' + x + '" is not listed in catalog.yaml facets', { field, value: x, expected: Object.keys(f.values).join(' | ') });
      });
    });
    validateColumns(r.key_dates || [], kdCols, (k, j) => atChild(loc, 'key_dates', j, loc.where + ' key_dates entry ' + (j + 1)));
  });

  // --- topics.yaml ---
  const topicLoc = (t, i) => at('topics.yaml', 'topics', i, 'topics.yaml "' + t.id + '"');
  validateColumns(d.topics, COLUMNS.Topics, topicLoc);
  d.topics.forEach((t, i) => {
    const loc = topicLoc(t, i);
    (t.related || []).forEach(x => { if (!topics.has(x)) err(loc, 'related topic "' + x + '" does not exist', { field: 'related', value: x, expected: idsIn('Topics') }); });
  });

  // --- controls.yaml ---
  const ctlLoc = (cc, i) => at('controls.yaml', 'controls', i, 'controls.yaml "' + cc.id + '"');
  validateColumns(d.controls, COLUMNS.Controls, ctlLoc);
  d.controls.forEach((cc, i) => {
    const loc = ctlLoc(cc, i);
    if (!isMissing(cc.topic) && !topics.has(cc.topic)) err(loc, 'topic "' + cc.topic + '" is not in topics.yaml', { field: 'topic', value: cc.topic, expected: idsIn('Topics') });
  });

  // --- obligations.yaml ---
  const oblLoc = (o, i) => at('obligations.yaml', 'obligations', i, 'obligations.yaml "' + o.id + '"');
  validateColumns(d.obligations, COLUMNS.Obligations, oblLoc);
  d.obligations.forEach((o, i) => {
    const loc = oblLoc(o, i);
    if (!isMissing(o.regulation_id) && !regulations.has(o.regulation_id)) err(loc, 'regulation_id "' + o.regulation_id + '" is not in regulations.yaml', { field: 'regulation_id', value: o.regulation_id, expected: idsIn('Regulations') });
    if (o.common_control && !controls.has(o.common_control)) err(loc, 'common_control "' + o.common_control + '" is not in controls.yaml', { field: 'common_control', value: o.common_control, expected: idsIn('Controls') });
    (o.topics || []).forEach(t => { if (!topics.has(t)) err(loc, 'topic "' + t + '" is not in topics.yaml', { field: 'topics', value: t, expected: idsIn('Topics') }); });
    if (!o.common_control && !(o.topics || []).length) warn(loc, 'no common_control or topics; it will not appear on any topic page', { field: 'common_control' });
    if (o.accountable_role && !roles.has(o.accountable_role)) err(loc, 'accountable_role "' + o.accountable_role + '" is not in roles.yaml', { field: 'accountable_role', value: o.accountable_role, expected: idsIn('Roles') });
  });

  // --- mappings.yaml ---
  const mapLoc = (m, i) => at('mappings.yaml', 'mappings', i, 'mappings.yaml entry ' + (i + 1) + (m.obligation_id ? ' ("' + m.obligation_id + '")' : ''));
  validateColumns(d.mappings, COLUMNS.Mappings, mapLoc);
  const mapped = new Set();
  d.mappings.forEach((m, i) => {
    const loc = mapLoc(m, i);
    if (!isMissing(m.obligation_id) && !obligations.has(m.obligation_id)) err(loc, 'obligation_id "' + m.obligation_id + '" is not in obligations.yaml', { field: 'obligation_id', value: m.obligation_id, expected: idsIn('Obligations') });
    if (!isMissing(m.obligation_id)) {
      if (mapped.has(m.obligation_id)) err(loc, 'obligation mapped more than once; merge the entries', { field: 'obligation_id', value: m.obligation_id, expected: 'each obligation on one Mappings row only' });
      mapped.add(m.obligation_id);
    }
    const docEntryLoc = j => atChild(loc, 'documents', j, loc.where + ' document entry ' + (j + 1));
    validateColumns(m.documents || [], mdCols, (e, j) => docEntryLoc(j));
    (m.documents || []).forEach((e, j) => {
      // Printed against the mapping (as build.js always has), but located at the document entry.
      const refLoc = atChild(loc, 'documents', j, loc.where);
      if (!isMissing(e.document_id) && !documents.has(e.document_id)) err(refLoc, 'document_id "' + e.document_id + '" is not in documents.yaml', { field: 'document_id', value: e.document_id, expected: idsIn('Documents') });
      if (e.layer && !layers.has(e.layer)) err(refLoc, 'layer "' + e.layer + '" is not defined in catalog.yaml layers', { field: 'layer', value: e.layer, expected: layerList });
    });
    if ((m.status === 'deviations_noted' || m.status === 'verification_pending') && !m.rationale) {
      warn(loc, m.status + ' without a rationale', { field: 'rationale' });
    }
  });

  // --- glossary.yaml ---
  validateColumns(d.glossary, COLUMNS.Glossary, (g, i) => at('glossary.yaml', 'glossary', i, 'glossary.yaml entry ' + (i + 1)));

  return { errors, warnings };
}

module.exports = { validate, formatIssue, isMissing };
