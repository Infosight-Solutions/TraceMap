'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { validate, formatIssue } = require('../lib/validate');
const { EXAMPLE_DIR, loadData, run, copyExample, editYaml } = require('./helpers');

const fresh = () => loadData(EXAMPLE_DIR);
const find = (issues, pred) => issues.find(pred);

// The example data's as_of date, so expiry checks do not depend on when the tests run.
const TODAY = { today: '2026-09-01' };

test('example data validates with no errors or warnings', () => {
  const { errors, warnings } = validate(fresh(), TODAY);
  assert.deepEqual(errors.map(formatIssue), []);
  assert.deepEqual(warnings.map(formatIssue), []);
});

test('issues keep the exact one-line text build.js prints', () => {
  const d = fresh();
  d.regulations[0].source_type = 'law';
  d.mappings[0].documents[0].document_id = 'NOPE';
  const { errors } = validate(d);
  const lines = errors.map(formatIssue);
  assert.ok(lines.includes('regulations.yaml "soc2": source_type must be one of mandate, guidance, standard, market'));
  assert.ok(lines.some(l => /^mappings\.yaml entry 1 \(".+"\): document_id "NOPE" is not in documents\.yaml$/.test(l)));
});

test('enum error carries entity, index, field, value, and allowed values', () => {
  const d = fresh();
  d.mappings[3].status = 'done';
  const e = find(validate(d).errors, i => i.field === 'status');
  assert.equal(e.entity, 'mappings');
  assert.equal(e.index, 3);
  assert.equal(e.value, 'done');
  assert.equal(e.expected, 'verified | deviations_noted | verification_pending | not_assessed');
});

test('missing required field is located on its record', () => {
  const d = fresh();
  delete d.regulations[1].name;
  const e = find(validate(d).errors, i => i.field === 'name');
  assert.equal(e.entity, 'regulations');
  assert.equal(e.index, 1);
  assert.equal(e.expected, 'a value (required)');
});

test('empty or whitespace-only strings count as missing for required fields', () => {
  for (const blank of ['', '   ']) {
    const d = fresh();
    d.regulations[1].name = blank;
    d.obligations[0].title = blank;
    d.mappings[0].documents[0].document_id = blank;
    const { errors } = validate(d);
    const missing = errors.filter(i => i.expected === 'a value (required)').map(i => `${i.entity}.${i.field}`);
    assert.deepEqual(missing.sort(), ['mappings.document_id', 'obligations.title', 'regulations.name'], JSON.stringify(blank));
  }
});

test('orphan references are errors with the referenced sheet named', () => {
  const d = fresh();
  d.obligations[0].regulation_id = 'ghost';
  d.controls[0].topic = 'ghost';
  const { errors } = validate(d);
  assert.equal(find(errors, i => i.entity === 'obligations' && i.field === 'regulation_id').expected, 'an ID in Regulations');
  assert.equal(find(errors, i => i.entity === 'controls' && i.field === 'topic').expected, 'an ID in Topics');
});

test('nested key_dates and mapping documents issues carry child and childIndex', () => {
  const d = fresh();
  const regIndex = d.regulations.findIndex(r => (r.key_dates || []).length >= 2);
  d.regulations[regIndex].key_dates[1].date = '2026-13-45';
  d.mappings[0].documents[1].layer = 'bogus';
  const { errors } = validate(d);
  const kd = find(errors, i => i.field === 'date');
  assert.deepEqual([kd.entity, kd.index, kd.child, kd.childIndex], ['regulations', regIndex, 'key_dates', 1]);
  const md = find(errors, i => i.field === 'layer' && i.child === 'documents');
  assert.deepEqual([md.entity, md.index, md.childIndex], ['mappings', 0, 1]);
});

test('facet values are checked against catalog.yaml', () => {
  const d = fresh();
  d.regulations[0].jurisdiction = 'mars';
  const e = find(validate(d).errors, i => i.field === 'jurisdiction');
  assert.equal(e.value, 'mars');
  assert.equal(e.expected, 'us | eu | international');
});

test('applies_if accepts "always" as a scalar but not as a list', () => {
  const d = fresh();
  d.regulations[0].applies_if = 'always';
  assert.equal(validate(d).errors.length, 0);
  d.regulations[0].applies_if = ['always'];
  assert.ok(find(validate(d).errors, i => i.field === 'applies_if'));
});

test('duplicate IDs and double mappings are errors', () => {
  const d = fresh();
  d.roles.push({ ...d.roles[0] });
  d.mappings.push({ ...d.mappings[0], documents: [] });
  const { errors } = validate(d);
  assert.ok(find(errors, i => i.entity === 'roles' && /duplicate id/.test(i.message)));
  assert.ok(find(errors, i => i.entity === 'mappings' && /mapped more than once/.test(i.message)));
});

test('a status that needs a rationale warns when it has none', () => {
  const d = fresh();
  const m = d.mappings.find(x => x.status === 'deviations_noted');
  delete m.rationale;
  const w = find(validate(d).warnings, i => i.field === 'rationale');
  assert.equal(w.message, 'deviations_noted without a rationale');
});

test('sequence must be a whole number', () => {
  const d = fresh();
  d.regulations[0].sequence = 3;
  d.obligations[0].sequence = 1.5;
  const errs = validate(d).errors.filter(i => i.field === 'sequence');
  assert.deepEqual(errs.map(i => [i.entity, i.index]), [['obligations', 0]]);
});

test('parent must be another item of the same kind, with no loops', () => {
  const d = fresh();
  const [a, b, c] = d.topics;
  b.parent = a.id;                      // fine
  d.documents[0].parent = 'ghost';      // unknown
  d.regulations[0].parent = d.regulations[0].id; // itself
  assert.deepEqual(validate(d).errors.map(formatIssue), [
    `documents.yaml "${d.documents[0].id}": parent "ghost" is not in documents.yaml`,
    `regulations.yaml "${d.regulations[0].id}": parent is the item itself`,
  ]);

  const loop = fresh();
  loop.topics[0].parent = loop.topics[1].id;
  loop.topics[1].parent = loop.topics[2].id;
  loop.topics[2].parent = loop.topics[0].id;
  const errs = validate(loop).errors;
  assert.equal(errs.length, 1, 'a loop is reported once');
  assert.equal(errs[0].message, `parent chain loops back to this item: ${a.id} → ${b.id} → ${c.id} → ${a.id}`);
});

test('relationships: endpoints resolve by ID or kind:ID, with clear errors otherwise', () => {
  const d = fresh();
  const reg = d.regulations[0].id;
  const doc = d.documents[0].id;
  d.relationships = [
    { from_item: reg, to_item: 'document:' + doc, type: 'references' }, // ok
    { from_item: 'topic:logging', to_item: 'control:logging', type: 'related' }, // ok: prefixes disambiguate
    { from_item: 'logging', to_item: reg, type: 'related' },             // ambiguous
    { from_item: 'ghost', to_item: reg, type: 'requires' },              // unknown
    { from_item: reg, to_item: 'regulation:' + reg, type: 'related' },   // same item
    { from_item: reg, to_item: doc, type: 'references' },                // repeats entry 1
    { from_item: reg, to_item: doc, type: 'parent_of' },                 // bad type
  ];
  assert.deepEqual(validate(d).errors.map(formatIssue), [
    'relationships.yaml entry 3: from_item "logging" matches more than one item (topic, control); write it as topic:logging or control:logging',
    'relationships.yaml entry 4: from_item "ghost" is not the ID of any item',
    'relationships.yaml entry 5: from_item and to_item are the same item',
    'relationships.yaml entry 6: repeats entry 1 (same items and type)',
    'relationships.yaml entry 7: type "parent_of" is not in catalog.yaml relationship_types',
  ]);
});

test('relationship types come from catalog.yaml and replace the defaults', () => {
  const d = fresh();
  d.catalog.relationship_types = [{ id: 'implements', label: 'Implements', inverse_label: 'Implemented by' }];
  d.relationships = [
    { from_item: d.documents[0].id, to_item: d.regulations[0].id, type: 'implements' },
    { from_item: d.documents[1].id, to_item: d.regulations[0].id, type: 'related' }, // a default, no longer listed
  ];
  const e = validate(d).errors;
  assert.deepEqual(e.map(i => [i.index, i.field, i.expected]), [[1, 'type', 'implements']]);

  d.catalog.relationship_types.push({ id: 'implements' });
  assert.match(validate(d).errors.map(formatIssue).join('\n'), /catalog\.yaml relationship_types: duplicate id "implements"/);
});

test('relationship attributes must be a map of single values', () => {
  const d = fresh();
  const base = { from_item: d.documents[0].id, to_item: d.regulations[0].id, type: 'references' };
  d.relationships = [
    { ...base, attributes: { strength: 'strong', weight: 3 } },               // ok
    { ...base, type: 'related', attributes: ['strong'] },                     // not a map
    { ...base, type: 'requires', attributes: { owners: ['ciso', 'cfo'] } },   // nested value
  ];
  assert.deepEqual(validate(d).errors.map(formatIssue), [
    'relationships.yaml entry 2: attributes must be a map of key: value',
    'relationships.yaml entry 3: attribute "owners" must be text or a number, not a list or map',
  ]);
});

test('item attributes need a name and a value, each name once per item', () => {
  const d = fresh();
  d.regulations[0].attributes = [
    { name: 'Observation period', value: 12, unit: 'months' }, // a number is fine; so is 0
    { name: 'Zero', value: 0 },
    { name: 'Observation period', value: '6' },                // repeated name
  ];
  d.obligations[0].attributes = [{ name: 'Owner' }];           // no value
  d.documents[0].attributes = [{ value: 'x' }, { name: 'Pages', value: { n: 3 } }];
  const e = validate(d).errors;
  assert.deepEqual(e.map(i => [i.entity, i.index, i.child, i.childIndex, i.field]), [
    ['documents', 0, 'attributes', 0, 'name'],
    ['documents', 0, 'attributes', 1, 'value'],
    ['regulations', 0, 'attributes', 2, 'name'],
    ['obligations', 0, 'attributes', 0, 'value'],
  ]);
});

test('valid_until and the timestamps must be dates; a past valid_until warns', () => {
  const d = fresh();
  d.documents[0].valid_until = '2026-08-31';
  d.documents[1].valid_until = 'soon';
  d.regulations[0].created_at = '2026-02-30';
  d.relationships = [{ from_item: d.documents[0].id, to_item: d.regulations[0].id, type: 'references', modified_at: 'yesterday' }];
  const { errors, warnings } = validate(d, TODAY);
  assert.deepEqual(errors.map(i => [i.entity, i.field]).sort(), [['documents', 'valid_until'], ['regulations', 'created_at'], ['relationships', 'modified_at']]);
  assert.deepEqual(warnings.map(formatIssue), [`documents.yaml "${d.documents[0].id}": valid_until 2026-08-31 has passed; the document shows as Expired`]);
});

test('fields starting with x- are never checked', () => {
  const d = fresh();
  d.regulations[0]['x-owner'] = { nested: ['anything'] };
  d.documents[0]['x-pages'] = 'not a number';
  d.catalog['x-note'] = 42;
  assert.deepEqual(validate(d, TODAY).errors, []);
});

test('build.js succeeds on the example data and fails on broken data', t => {
  const out = path.join(copyExample(t), 'out.html');
  assert.equal(run('build.js', ['--data', 'data-example', '--out', out]).status, 0);

  const bad = copyExample(t);
  editYaml(bad, 'roles.yaml', doc => { doc.roles.push({ ...doc.roles[0] }); });
  const res = run('build.js', ['--data', bad, '--out', path.join(bad, 'out.html')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /error {4}roles\.yaml: duplicate id "ciso"/);
});
