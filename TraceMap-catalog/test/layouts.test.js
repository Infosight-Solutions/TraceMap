'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveLayouts, DETAIL_PANELS } = require('../lib/layouts');
const { validate, formatIssue } = require('../lib/validate');
const { EXAMPLE_DIR, loadData, run, tempDir } = require('./helpers');

const catalog = () => loadData(EXAMPLE_DIR).catalog;

test('no layouts section: defaults reproduce the catalog as it was before layouts', () => {
  assert.deepEqual(resolveLayouts(catalog()), {
    index: { tiles: ['topics'], show_applicability_filters: true },
    browse: {
      default_group_by: 'category',
      default_sort: 'sequence',
      show_columns: ['name', 'type', 'jurisdiction', 'scope', 'key_date', 'coverage'], // in_table facets
      display_mode: 'list',
    },
    detail: { panels: DETAIL_PANELS.map(panel => ({ panel })) },
    dashboard: { enabled: false, aggregate_by: ['status', 'source_type'] },
  });
});

test('settings override defaults one section at a time; panels accept options', () => {
  const c = catalog();
  c.layouts = {
    browse: { default_sort: 'name' },
    detail: { panels: ['identity', { panel: 'category_boxes', max_values: 4 }, 'requirements'] },
  };
  const L = resolveLayouts(c);
  assert.equal(L.browse.default_sort, 'name');
  assert.equal(L.browse.default_group_by, 'category', 'other browse settings keep their defaults');
  assert.deepEqual(L.detail.panels, [{ panel: 'identity' }, { panel: 'category_boxes', max_values: 4 }, { panel: 'requirements' }]);
  assert.equal(L.index.show_applicability_filters, true);
  assert.deepEqual(validate(Object.assign(loadData(EXAMPLE_DIR), { catalog: c })).errors, []);
});

test('layout mistakes are build errors that name the setting', () => {
  const d = loadData(EXAMPLE_DIR);
  d.catalog.layouts = {
    browse: { default_sort: 'date', show_columns: ['name', 'owner'], display_mode: 'grid', sort: 'name' },
    detail: { panels: ['identity', 'timeline', 'timeline'] },
    index: { show_applicability_filters: 'yes', 'x-note': 'ignored' },
    dashboard: { aggregate_by: ['jurisdiction'] }, // facet fields are fine
    sidebar: {},
  };
  assert.deepEqual(validate(d).errors.map(formatIssue), [
    'catalog.yaml layouts.browse.default_sort: "date" is not allowed',
    'catalog.yaml layouts.browse.show_columns: unknown value "owner"',
    'catalog.yaml layouts.browse.display_mode: "grid" is not allowed (list is the only display mode so far)',
    'catalog.yaml layouts.browse.sort: unknown setting',
    'catalog.yaml layouts.detail.panels: panel "timeline" is listed twice',
    'catalog.yaml layouts.index.show_applicability_filters: must be true or false',
    'catalog.yaml layouts.sidebar: unknown section',
  ]);

  d.catalog.layouts = { detail: { panels: ['identity', 'map', { panel: 'category_boxes', max_values: 0 }] } };
  assert.deepEqual(validate(d).errors.map(formatIssue), ['catalog.yaml layouts.detail.panels: unknown panel "map"']);
  d.catalog.layouts = { detail: { panels: [{ panel: 'category_boxes', max_values: 0 }, { panel: 'status', size: 2 }] } };
  assert.deepEqual(validate(d).errors.map(formatIssue), ['catalog.yaml layouts.detail.panels: category_boxes max_values must be a positive whole number']);
});

test('build.js embeds the resolved layouts and relationship types in the page data', t => {
  const out = path.join(tempDir(t), 'out.html');
  assert.equal(run('build.js', ['--data', 'data-example', '--out', out]).status, 0);
  const html = fs.readFileSync(out, 'utf8');
  const json = html.split('window.TRACEMAP_DATA = ')[1].split(';\n</script>')[0];
  const embedded = JSON.parse(json).catalog;
  assert.deepEqual(embedded.layouts, resolveLayouts(catalog()));
  assert.deepEqual(embedded.relationship_types.map(x => x.id), ['upstream', 'downstream', 'requires', 'references', 'related']);
});
