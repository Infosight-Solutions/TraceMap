'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { checkDataVersions, parseVersion } = require('../lib/versions');
const { SCHEMA_VERSION } = require('../lib/schema');
const { run, copyExample, editYaml } = require('./helpers');

const cur = parseVersion(SCHEMA_VERSION);

test('schema_version: same version passes; an unquoted YAML 1.0 reads as 1.0', () => {
  assert.deepEqual(checkDataVersions([['a.yaml', SCHEMA_VERSION], ['b.yaml', cur.major]]), { errors: [], warnings: [] });
});

test('schema_version: a different minor warns, a different major is refused both ways', () => {
  const minor = checkDataVersions([['a.yaml', `${cur.major}.${cur.minor + 1}`]]);
  assert.equal(minor.errors.length, 0);
  assert.match(minor.warnings[0], /^a\.yaml is schema \d+\.\d+; this TraceMap reads/);

  const newer = checkDataVersions([['a.yaml', `${cur.major + 1}.0`]]);
  assert.match(newer.errors[0], /newer than this TraceMap.*Update TraceMap/);

  const older = checkDataVersions([['a.yaml', '0.9']]);
  assert.match(older.errors[0], /this TraceMap reads \d+\.x\. See docs\/schema\.md#upgrading/);

  assert.match(checkDataVersions([['a.yaml', 'one']]).errors[0], /is not a version number/);
});

test('schema_version: missing files are named in one warning and treated as 1.0', () => {
  const r = checkDataVersions([['a.yaml', undefined], ['b.yaml', SCHEMA_VERSION], ['c.yaml', null]]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^no schema_version in a\.yaml, c\.yaml; treated as 1\.0/);
});

test('build.js refuses a file with a different major schema version', t => {
  const dir = copyExample(t);
  editYaml(dir, 'topics.yaml', doc => { doc.schema_version = `${cur.major + 1}.0`; });
  const res = run('build.js', ['--data', dir, '--out', path.join(dir, 'out.html')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /topics\.yaml is schema \d+\.0, newer than this TraceMap/);
});
