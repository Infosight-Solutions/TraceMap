'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { validate, formatIssue } = require('../lib/validate');
const { EXAMPLE_DIR, loadData, run, copyExample, editYaml } = require('./helpers');

const fresh = () => loadData(EXAMPLE_DIR);
const find = (issues, pred) => issues.find(pred);

test('example data validates with no errors or warnings', () => {
  const { errors, warnings } = validate(fresh());
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

test('build.js succeeds on the example data and fails on broken data', t => {
  const out = path.join(copyExample(t), 'out.html');
  assert.equal(run('build.js', ['--data', 'data-example', '--out', out]).status, 0);

  const bad = copyExample(t);
  editYaml(bad, 'roles.yaml', doc => { doc.roles.push({ ...doc.roles[0] }); });
  const res = run('build.js', ['--data', bad, '--out', path.join(bad, 'out.html')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /error {4}roles\.yaml: duplicate id "ciso"/);
});
