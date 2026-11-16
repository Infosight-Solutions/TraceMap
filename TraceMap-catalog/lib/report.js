'use strict';

// Markdown helpers for the validation reports written by import-xlsx.js and
// generate-template.js --populate. Both write REPORT_NAME next to the YAML data.

const REPORT_NAME = 'import-report.md';

// Table cells: escape pipes, collapse newlines.
const mdCell = s => String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
// Values shown as code; blank shown as (blank).
const mdCode = s => (s === '' || s == null ? '(blank)' : '`' + mdCell(s).replace(/`/g, "'") + '`');

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// columns: [[header, row => cell markdown], ...]
function table(columns, rows) {
  if (!rows.length) return ['None.'];
  return [
    '| ' + columns.map(c => c[0]).join(' | ') + ' |',
    '|' + columns.map(() => '---|').join(''),
    ...rows.map(r => '| ' + columns.map(c => c[1](r)).join(' | ') + ' |'),
  ];
}

// Renders a full report. meta: [[label, value], ...] shown under the title.
// action: 'import' or 'export'; outcome: what was not written when errors abort it.
function renderReport({ title, meta, errors, warnings, errorColumns, warningColumns, action = 'import', outcome = 'no files written' }) {
  const lines = [`# ${title}`, ''];
  for (const [label, value] of meta) lines.push(`**${label}:** ${value}`);
  lines.push(
    '',
    '## Summary',
    '',
    `${plural(errors.length, 'error')} — ${errors.length ? `${action} aborted, ${outcome}` : 'none'}`,
    `${plural(warnings.length, 'warning')} — ${errors.length ? `${action} would succeed once errors are fixed; review before distributing` : 'review before distributing'}`,
    '',
    '## Errors',
    '',
    ...table(errorColumns, errors),
    '',
    '## Warnings',
    '',
    ...table(warningColumns, warnings),
  );
  return lines.join('\n') + '\n';
}

module.exports = { REPORT_NAME, mdCell, mdCode, stamp, renderReport };
