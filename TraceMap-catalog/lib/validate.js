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
//
// Only fields the schema defines are checked. Unknown fields pass untouched, and fields whose
// name starts with "x-" are reserved for authors: validate() never looks at them (isExtension).
//
// options.today ('YYYY-MM-DD', default today) is the date valid_until is compared with.

const { ISO_DATE, COLUMNS, ITEM_KINDS, relationshipTypes } = require('./schema');
const { layoutIssues } = require('./layouts');

function isMissing(v) { return !v || (typeof v === 'string' && !v.trim()); }

function formatIssue(issue) { return issue.where + ': ' + issue.message; }

const isScalar = v => ['string', 'number', 'boolean'].includes(typeof v);

function validate(d, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
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
    // Date.parse rolls 2026-02-30 over to March 2, so also check the date reads back unchanged.
    const real = ISO_DATE.test(String(v)) && !isNaN(Date.parse(v)) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === String(v);
    if (!real) err(loc, field + ' "' + v + '" is not a YYYY-MM-DD date', { field, value: v, expected: 'YYYY-MM-DD' });
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
        const missing = typeof v === 'number' ? false : isMissing(v); // 0 is a value
        if (col.required && missing) { err(loc, 'missing ' + col.key, { field: col.key, value: v, expected: 'a value (required)' }); return; }
        if (missing) return;
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

  // parent must name another item of the same kind, and parent chains must not loop.
  // A loop is reported once, on its first item in file order.
  function checkParents(list, map, file, label, locFn) {
    const reported = new Set();
    list.forEach((item, i) => {
      if (!item || isMissing(item.parent)) return;
      const loc = locFn(item, i);
      if (item.parent === item.id) return err(loc, 'parent is the item itself', { field: 'parent', value: item.parent, expected: 'the ID of a different ' + label });
      if (!map.has(item.parent)) return err(loc, 'parent "' + item.parent + '" is not in ' + file, { field: 'parent', value: item.parent, expected: idsIn(label[0].toUpperCase() + label.slice(1) + 's') });
      const chain = [item.id];
      let cur = item.parent;
      while (cur && map.has(cur) && chain.length <= list.length) {
        if (cur === item.id) {
          const key = [...chain].sort().join('\u0000');
          if (!reported.has(key)) {
            reported.add(key);
            err(loc, 'parent chain loops back to this item: ' + chain.concat(cur).join(' → '), { field: 'parent', value: item.parent, expected: 'a parent chain that ends at an item with no parent' });
          }
          return;
        }
        if (chain.includes(cur)) return; // a loop further up; reported on its own items
        chain.push(cur);
        cur = map.get(cur).parent;
      }
    });
  }

  // Filtered column sets for child-row sheets; the foreign-key column is implicit from context.
  const kdCols = COLUMNS.Reg_Key_Dates.filter(col => col.key !== 'regulation_id');
  const mdCols = COLUMNS.Mapping_Docs.filter(col => col.key !== 'obligation_id');
  const attrCols = COLUMNS.Attributes.filter(col => col.key !== 'item_kind' && col.key !== 'item_id');

  // attributes[] on regulations, obligations, documents: a list of { name, value, unit, source },
  // each name once per item. value may be text or a number (stored as text by the importer).
  function checkAttributes(item, loc) {
    const list = item.attributes;
    if (list == null) return;
    if (!Array.isArray(list)) return err(loc, 'attributes must be a list of { name, value } entries', { field: 'attributes', expected: 'a list' });
    const entryLoc = j => atChild(loc, 'attributes', j, loc.where + ' attributes entry ' + (j + 1));
    validateColumns(list, attrCols, (a, j) => entryLoc(j));
    const names = new Set();
    list.forEach((a, j) => {
      if (!a || typeof a !== 'object') return err(entryLoc(j), 'is not a mapping');
      if (a.value != null && !isScalar(a.value)) err(entryLoc(j), 'value must be text or a number', { field: 'value', expected: 'text or a number' });
      if (isMissing(a.name)) return;
      if (names.has(a.name)) err(entryLoc(j), 'attribute "' + a.name + '" is listed twice', { field: 'name', value: a.name, expected: 'each attribute name once per item' });
      names.add(a.name);
    });
  }

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
  if (c.relationship_types != null && (!Array.isArray(c.relationship_types) || !c.relationship_types.length)) {
    err(CAT, 'relationship_types must list at least one type (leave it out to use the defaults)', { field: 'relationship_types' });
  } else if (c.relationship_types) {
    indexById(c.relationship_types, 'catalog.yaml relationship_types');
  }
  const relTypeIds = relationshipTypes(c).map(t => t.id);
  layoutIssues(c).forEach(i => err(Object.assign({}, CAT, { where: 'catalog.yaml ' + i.path }), i.message, { field: i.path, value: i.value, expected: i.expected }));

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
    if (doc.valid_until && ISO_DATE.test(String(doc.valid_until)) && String(doc.valid_until) < today) {
      warn(loc, 'valid_until ' + doc.valid_until + ' has passed; the document shows as Expired', { field: 'valid_until', value: doc.valid_until });
    }
    checkAttributes(doc, loc);
  });
  checkParents(d.documents, documents, 'documents.yaml', 'document', docLoc);

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
    checkAttributes(r, loc);
  });
  checkParents(d.regulations, regulations, 'regulations.yaml', 'regulation', regLoc);

  // --- topics.yaml ---
  const topicLoc = (t, i) => at('topics.yaml', 'topics', i, 'topics.yaml "' + t.id + '"');
  validateColumns(d.topics, COLUMNS.Topics, topicLoc);
  d.topics.forEach((t, i) => {
    const loc = topicLoc(t, i);
    (t.related || []).forEach(x => { if (!topics.has(x)) err(loc, 'related topic "' + x + '" does not exist', { field: 'related', value: x, expected: idsIn('Topics') }); });
  });
  checkParents(d.topics, topics, 'topics.yaml', 'topic', topicLoc);

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
    checkAttributes(o, loc);
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

  // --- relationships.yaml (optional file) ---
  const rels = d.relationships || [];
  const itemMaps = { regulations, obligations, documents, topics, controls };
  const relLoc = (x, i) => at('relationships.yaml', 'relationships', i, 'relationships.yaml entry ' + (i + 1));
  validateColumns(rels, COLUMNS.Relationships, relLoc);
  const seenRel = new Map();
  rels.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const loc = relLoc(x, i);
    if (!isMissing(x.type) && !relTypeIds.includes(x.type)) {
      err(loc, 'type "' + x.type + '" is not in catalog.yaml relationship_types', { field: 'type', value: x.type, expected: relTypeIds.join(' | ') });
    }
    if (x.attributes != null) {
      const a = x.attributes;
      if (typeof a !== 'object' || Array.isArray(a)) err(loc, 'attributes must be a map of key: value', { field: 'attributes', expected: 'key: value pairs' });
      else Object.keys(a).forEach(k => {
        if (!isScalar(a[k])) err(loc, 'attribute "' + k + '" must be text or a number, not a list or map', { field: 'attributes', value: k, expected: 'text or a number' });
      });
    }
    const ends = ['from_item', 'to_item'].map(field => {
      const v = x[field];
      if (isMissing(v)) return null; // reported by validateColumns
      const r = resolveItemRef(String(v), itemMaps);
      if (r.error) err(loc, field + ' ' + r.error, { field, value: v, expected: r.expected });
      return r.error ? null : r.kind + ':' + r.id;
    });
    if (!ends[0] || !ends[1]) return;
    if (ends[0] === ends[1]) return err(loc, 'from_item and to_item are the same item', { field: 'to_item', value: x.to_item, expected: 'a different item than from_item' });
    const key = ends[0] + '\u0000' + ends[1] + '\u0000' + x.type;
    if (seenRel.has(key)) err(loc, 'repeats entry ' + (seenRel.get(key) + 1) + ' (same items and type)', { field: 'type', value: x.type, expected: 'each relationship listed once' });
    else seenRel.set(key, i);
  });

  return { errors, warnings };
}

// Resolves a relationship endpoint ("soc2" or "regulation:soc2") against the ID maps.
// Returns { kind, id } or { error, expected }. kind is a key of ITEM_KINDS.
function resolveItemRef(ref, itemMaps) {
  const kinds = Object.keys(ITEM_KINDS);
  const all = 'an ID in ' + kinds.map(k => ITEM_KINDS[k]).join(', ') + ' (prefix with kind: when ambiguous)';
  const colon = ref.indexOf(':');
  if (colon > 0 && ITEM_KINDS[ref.slice(0, colon)]) {
    const kind = ref.slice(0, colon);
    const id = ref.slice(colon + 1);
    if (itemMaps[ITEM_KINDS[kind]].has(id)) return { kind, id };
    return { error: '"' + ref + '" is not in ' + ITEM_KINDS[kind] + '.yaml', expected: 'an ID in ' + ITEM_KINDS[kind] + '.yaml' };
  }
  const hits = kinds.filter(k => itemMaps[ITEM_KINDS[k]].has(ref));
  if (hits.length === 1) return { kind: hits[0], id: ref };
  if (!hits.length) return { error: '"' + ref + '" is not the ID of any item', expected: all };
  return {
    error: '"' + ref + '" matches more than one item (' + hits.join(', ') + '); write it as ' + hits.map(k => k + ':' + ref).join(' or '),
    expected: hits.map(k => k + ':' + ref).join(' | '),
  };
}

module.exports = { validate, formatIssue, isMissing, resolveItemRef };
