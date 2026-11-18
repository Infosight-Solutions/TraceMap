'use strict';

// layouts: in catalog.yaml controls how pages are laid out. Every setting is optional; the defaults
// reproduce the catalog as it looked before layouts existed. build.js embeds the resolved result
// (resolveLayouts), so the page always receives a complete layouts object.
//
//   layouts:
//     index:     { tiles: [topics], show_applicability_filters: true }
//     browse:    { default_group_by: category, default_sort: sequence,
//                  show_columns: [name, type, <facet fields with in_table>, key_date, coverage],
//                  display_mode: list }
//     detail:    { panels: [identity, category_boxes, applies_when, timeline, status,
//                           requirements, relationships, evidence] }
//     dashboard: { enabled: false, aggregate_by: [status, source_type] }   # no dashboard page yet

const { isExtension } = require('./schema');

// Panels the regulation page can show. src/app.js has one renderer per name (a test checks).
const DETAIL_PANELS = ['identity', 'category_boxes', 'applies_when', 'timeline', 'status', 'requirements', 'relationships', 'evidence'];

// Per-panel options allowed in the object form: - { panel: category_boxes, max_values: 6 }
const PANEL_OPTIONS = { category_boxes: { max_values: 'positive whole number' } };

const INDEX_TILES = ['topics'];
const GROUP_MODES = ['date', 'id'];          // plus any facet field
const SORTS = ['sequence', 'name', 'id'];
const BASE_COLUMNS = ['name', 'type', 'key_date', 'coverage']; // plus any facet field
const DISPLAY_MODES = ['list'];
const AGGREGATES = ['status', 'source_type'];  // plus any facet field

function defaults(catalog) {
  const facets = (catalog.facets || []).filter(f => f && f.field);
  return {
    index: { tiles: INDEX_TILES.slice(), show_applicability_filters: true },
    browse: {
      default_group_by: catalog.group_field || 'category',
      default_sort: 'sequence',
      show_columns: ['name', 'type'].concat(facets.filter(f => f.in_table).map(f => f.field), ['key_date', 'coverage']),
      display_mode: 'list',
    },
    detail: { panels: DETAIL_PANELS.slice() },
    dashboard: { enabled: false, aggregate_by: ['status', 'source_type'] },
  };
}

// Defaults with the catalog's settings laid over them, one level deep per section.
// Panel entries become { panel, ...options }.
function resolveLayouts(catalog) {
  const out = defaults(catalog);
  const given = catalog.layouts && typeof catalog.layouts === 'object' ? catalog.layouts : {};
  for (const section of Object.keys(out)) {
    const g = given[section];
    if (g && typeof g === 'object' && !Array.isArray(g)) Object.assign(out[section], g);
  }
  out.detail.panels = (out.detail.panels || []).map(p => (typeof p === 'string' ? { panel: p } : Object.assign({}, p)));
  return out;
}

// Problems with catalog.yaml layouts, as [{ path, message, value?, expected? }].
// path is like 'layouts.browse.default_sort'. Fields starting with x- are skipped.
function layoutIssues(catalog) {
  const issues = [];
  const L = catalog.layouts;
  if (L == null) return issues;
  const add = (path, message, extra) => issues.push(Object.assign({ path, message }, extra));
  if (typeof L !== 'object' || Array.isArray(L)) {
    add('layouts', 'must be a map with index, browse, detail, or dashboard settings');
    return issues;
  }
  const facetFields = (catalog.facets || []).filter(f => f && f.field).map(f => f.field);
  const groupFields = facetFields.concat(catalog.group_field || 'category');
  const oneOf = (list, extra) => list.concat(extra || []).join(' | ');

  const checks = {
    index: {
      tiles: v => listOf(v, INDEX_TILES),
      show_applicability_filters: bool,
    },
    browse: {
      default_group_by: v => member(v, GROUP_MODES.concat(groupFields)),
      default_sort: v => member(v, SORTS),
      show_columns: v => listOf(v, BASE_COLUMNS.concat(facetFields), true),
      display_mode: v => member(v, DISPLAY_MODES, 'list is the only display mode so far'),
    },
    detail: { panels: panelList },
    dashboard: {
      enabled: bool,
      aggregate_by: v => listOf(v, AGGREGATES.concat(facetFields)),
    },
  };

  for (const section of Object.keys(L)) {
    if (isExtension(section)) continue;
    const path = 'layouts.' + section;
    if (!checks[section]) { add(path, 'unknown section', { expected: oneOf(Object.keys(checks)) }); continue; }
    const s = L[section];
    if (s == null) continue;
    if (typeof s !== 'object' || Array.isArray(s)) { add(path, 'must be a map of settings', { expected: oneOf(Object.keys(checks[section])) }); continue; }
    for (const key of Object.keys(s)) {
      if (isExtension(key)) continue;
      const check = checks[section][key];
      if (!check) { add(path + '.' + key, 'unknown setting', { expected: oneOf(Object.keys(checks[section])) }); continue; }
      const problem = check(s[key]);
      if (problem) add(path + '.' + key, problem.message, { value: s[key], expected: problem.expected });
    }
  }
  return issues;

  function bool(v) { return typeof v === 'boolean' ? null : { message: 'must be true or false', expected: 'true | false' }; }
  function member(v, allowed, note) {
    return allowed.includes(v) ? null : { message: `"${v}" is not allowed${note ? ' (' + note + ')' : ''}`, expected: oneOf(allowed) };
  }
  function listOf(v, allowed, nonEmpty) {
    if (!Array.isArray(v)) return { message: 'must be a list', expected: 'a list of ' + oneOf(allowed) };
    if (nonEmpty && !v.length) return { message: 'must list at least one entry', expected: oneOf(allowed) };
    const bad = v.filter(x => !allowed.includes(x));
    if (bad.length) return { message: 'unknown value' + (bad.length > 1 ? 's ' : ' ') + bad.map(x => `"${x}"`).join(', '), expected: oneOf(allowed) };
    const dup = v.find((x, i) => v.indexOf(x) !== i);
    if (dup !== undefined) return { message: `"${dup}" is listed twice`, expected: 'each value once' };
    return null;
  }
  function panelList(v) {
    if (!Array.isArray(v)) return { message: 'must be a list of panel names', expected: oneOf(DETAIL_PANELS) };
    const seen = new Set();
    for (const entry of v) {
      const name = typeof entry === 'string' ? entry : entry && entry.panel;
      if (!DETAIL_PANELS.includes(name)) return { message: `unknown panel "${name}"`, expected: oneOf(DETAIL_PANELS) };
      if (seen.has(name)) return { message: `panel "${name}" is listed twice`, expected: 'each panel once' };
      seen.add(name);
      if (typeof entry === 'object') {
        for (const opt of Object.keys(entry)) {
          if (opt === 'panel' || isExtension(opt)) continue;
          const allowed = PANEL_OPTIONS[name] || {};
          if (!allowed[opt]) return { message: `panel "${name}" has no option "${opt}"`, expected: Object.keys(allowed).join(' | ') || 'no options' };
          if (!(Number.isInteger(entry[opt]) && entry[opt] > 0)) return { message: `${name} ${opt} must be a ${allowed[opt]}`, expected: allowed[opt] };
        }
      }
    }
    return null;
  }
}

module.exports = { DETAIL_PANELS, PANEL_OPTIONS, defaults, resolveLayouts, layoutIssues };
