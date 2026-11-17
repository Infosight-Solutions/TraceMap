'use strict';

// Version parsing and the data schema_version check, shared by build.js,
// scripts/generate-template.js (--populate), and scripts/import-xlsx.js.

const { SCHEMA_VERSION } = require('./schema');

// "1.0" / "1" / 1 -> { major, minor, text }; anything else -> null.
// An unquoted YAML 1.0 arrives as the number 1, which reads as 1.0.
function parseVersion(v) {
  if (v == null) return null;
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(String(v));
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2] || 0);
  return { major, minor, text: `${major}.${minor}` };
}

// found: [[label, rawVersion], ...], one per file (or workbook cell). A missing version is
// treated as 1.0 (files written before schema_version existed) and listed in one warning.
// Returns { errors: [string], warnings: [string] }.
function checkDataVersions(found) {
  const expected = parseVersion(SCHEMA_VERSION);
  const errors = [];
  const warnings = [];
  const missing = [];
  for (const [label, raw] of found) {
    if (raw == null || raw === '') missing.push(label);
    const p = parseVersion(raw == null || raw === '' ? '1.0' : raw);
    if (!p) {
      errors.push(`${label}: schema_version "${raw}" is not a version number like "${SCHEMA_VERSION}"`);
    } else if (p.major < expected.major) {
      errors.push(`${label} is schema ${p.text}; this TraceMap reads ${expected.major}.x. ` +
        'See docs/schema.md#upgrading for what changed and how to update the file.');
    } else if (p.major > expected.major) {
      errors.push(`${label} is schema ${p.text}, newer than this TraceMap (${SCHEMA_VERSION}). Update TraceMap to use it.`);
    } else if (p.minor !== expected.minor && !missing.includes(label)) {
      warnings.push(`${label} is schema ${p.text}; this TraceMap reads ${SCHEMA_VERSION}. ` +
        'It should still work; see docs/schema.md#upgrading.');
    }
  }
  if (missing.length) {
    warnings.push(`no schema_version in ${missing.join(', ')}; treated as 1.0. ` +
      `Add schema_version: "${SCHEMA_VERSION}" as the first line of each file.`);
  }
  return { errors, warnings };
}

module.exports = { parseVersion, checkDataVersions };
