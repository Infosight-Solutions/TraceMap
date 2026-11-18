'use strict';

// The built page, rendered in jsdom: panels, category boxes, relationships, the evidence rollup,
// status tooltips, the Legend page, expiry, and attributes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { DETAIL_PANELS } = require('../lib/layouts');
const { run, copyExample, editYaml } = require('./helpers');

// Builds the example data (after edit(dir), if given) and returns the HTML.
function build(t, edit) {
  const dir = copyExample(t);
  if (edit) edit(dir);
  const out = path.join(dir, 'out.html');
  const res = run('build.js', ['--data', dir, '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  return fs.readFileSync(out, 'utf8');
}

// Opens a route; fails the test on any script error.
function open(t, html, route) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'file:///catalog.html#/' + route, virtualConsole,
    beforeParse(w) { w.scrollTo = () => {}; },
  });
  t.after(() => dom.window.close());
  assert.deepEqual(errors, [], 'script errors on #/' + route);
  return dom.window;
}

const panels = doc => [...doc.querySelectorAll('[data-panel]')].map(n => n.dataset.panel);
// Visible text, with a space between separate pieces (textContent runs them together).
function text(n) {
  const parts = [];
  const walk = x => { if (x.nodeType === 3) parts.push(x.nodeValue); else if (!x.hidden) x.childNodes.forEach(walk); };
  walk(n);
  return parts.join(' ').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
}
const setLayouts = (dir, layouts) => editYaml(dir, 'catalog.yaml', doc => { doc.layouts = layouts; });

let exampleHtml;
const example = t => (exampleHtml = exampleHtml || build(t));

test('every panel name in lib/layouts.js has a renderer in the page, and no others', t => {
  assert.deepEqual([...open(t, example(t), '').TRACEMAP_PANELS], DETAIL_PANELS);
});

test('regulation page: default panels in order, with applies_when and timeline side by side', t => {
  const doc = open(t, example(t), 'reg/soc2').document;
  assert.deepEqual(panels(doc), DETAIL_PANELS);
  const row = doc.querySelector('.grid-2');
  assert.deepEqual([...row.children].map(n => n.dataset.panel), ['applies_when', 'timeline']);
});

test('layouts.detail.panels reorders and leaves out panels', t => {
  const html = build(t, dir => setLayouts(dir, { detail: { panels: ['requirements', 'identity', 'timeline'] } }));
  const doc = open(t, html, 'reg/soc2').document;
  assert.deepEqual(panels(doc), ['requirements', 'identity', 'timeline']);
  assert.equal(doc.querySelector('.cat-box'), null);
  assert.equal(doc.querySelector('.grid-2'), null, 'a half panel with no neighbor takes the full row');
});

test('category boxes: every value listed, the applicable ones checked and first', t => {
  const doc = open(t, example(t), 'reg/soc2').document;
  const boxes = [...doc.querySelectorAll('.cat-box')];
  assert.deepEqual(boxes.map(b => text(b.querySelector('.cat-label'))), ['Type', 'Obligation', 'Category', 'Where it applies', 'What it covers']);
  const type = boxes[0];
  const items = [...type.querySelectorAll('li')];
  assert.deepEqual(items.map(text),
    ['Standard, applies', 'Mandate, does not apply', 'Guidance, does not apply', 'Market-based, does not apply']);
  assert.deepEqual(items.map(li => li.classList.contains('cat-on')), [true, false, false, false]);
});

test('category boxes: long lists collapse to max_values, never hiding a value that applies', t => {
  const html = build(t, dir => {
    setLayouts(dir, { detail: { panels: [{ panel: 'category_boxes', max_values: 2 }] } });
    editYaml(dir, 'regulations.yaml', doc => { doc.regulations[0].jurisdiction = ['us', 'eu', 'international']; });
  });
  const win = open(t, html, 'reg/soc2');
  const [, obligation, , where] = win.document.querySelectorAll('.cat-box');

  const shown = box => [...box.querySelectorAll('li')].filter(li => !li.hidden).length;
  assert.equal(shown(obligation), 2);
  const more = obligation.querySelector('.cat-more');
  assert.equal(text(more), '+ 3 more');
  more.click();
  assert.equal(shown(obligation), 5);
  assert.equal(obligation.querySelector('.cat-more'), null);

  assert.equal(shown(where), 3, 'all three applicable values stay visible');
  assert.equal(where.querySelector('.cat-more'), null);
});

test('a context-only regulation shows why it is listed instead of requirements and documents', t => {
  const html = build(t, dir => editYaml(dir, 'regulations.yaml', doc => {
    Object.assign(doc.regulations[2], { obligation_type: 'context', context_note: 'Background reading for the team.' });
  }));
  const doc = open(t, html, 'reg/nist-csf').document;
  assert.deepEqual(panels(doc), ['identity', 'category_boxes', 'applies_when', 'timeline', 'status', 'relationships']);
  assert.match(text(doc.querySelector('[data-panel="status"]')), /Why this is listed Background reading for the team\./);
});

test('relationships panel: empty state, then both ends of a link with the right wording', t => {
  assert.equal(text(open(t, example(t), 'reg/soc2').document.querySelector('[data-panel="relationships"] p')),
    'No related items are recorded for this regulation.');

  const html = build(t, dir => editYaml(dir, 'relationships.yaml', doc => {
    doc.relationships = [{ from_item: 'soc2', to_item: 'regulation:iso27001', type: 'requires', description: 'Shared audit evidence' }];
  }));
  const from = open(t, html, 'reg/soc2').document.querySelector('[data-panel="relationships"]');
  assert.equal(text(from.querySelector('.kicker')), 'Requires');
  assert.equal(text(from.querySelector('li')), 'Regulation ISO/IEC 27001:2022 Shared audit evidence');
  assert.equal(from.querySelector('li a').getAttribute('href'), '#/reg/iso27001');

  const to = open(t, html, 'reg/iso27001').document.querySelector('[data-panel="relationships"]');
  assert.equal(text(to.querySelector('.kicker')), 'Required by');
  assert.equal(to.querySelector('li a').getAttribute('href'), '#/reg/soc2');
});

test('evidence panel: documents by layer with how many requirements each supports', t => {
  const ev = open(t, example(t), 'reg/soc2').document.querySelector('[data-panel="evidence"]');
  const layers = [...ev.querySelectorAll('.layer')];
  assert.deepEqual(layers.map(l => text(l.querySelector('.layer-name'))), ['Policy', 'Standard', 'Procedure', 'Evidence']);
  const pol002 = [...layers[0].querySelectorAll('.stack-sm')].find(n => /POL-002/.test(text(n)));
  assert.match(text(pol002), /Supports 3 requirements$/);
});

test('status colors explain themselves on hover, and status_descriptions can reword them', t => {
  const doc = open(t, example(t), 'reg/soc2').document;
  assert.equal(doc.querySelector('.pill.st-verified').title, 'The requirement is fully addressed in company documentation.');
  assert.match(doc.querySelector('.stat.k-not_assessed').title, /Nobody has compared/);

  const html = build(t, dir => editYaml(dir, 'catalog.yaml', c => { c.status_descriptions = { verified: 'Checked and documented.' }; }));
  assert.equal(open(t, html, 'reg/soc2').document.querySelector('.pill.st-verified').title, 'Checked and documented.');
});

test('Legend page: linked from the footer; statuses, boxes, tags, relationships, layers, terms', t => {
  const html = example(t);
  assert.ok(open(t, html, '').document.querySelector('footer a[href="#/legend"]'));
  const doc = open(t, html, 'legend').document;
  const sections = [...doc.querySelectorAll('main section.panel h2')].map(text);
  assert.deepEqual(sections, ['Documentation status', 'Category boxes', 'Tags', 'Relationships', 'Document layers', 'Terms']);
  assert.equal(doc.querySelectorAll('.legend-row .pill').length, 5);
  assert.ok(doc.querySelector('.cat-box .cat-on'));
  assert.deepEqual([...doc.querySelectorAll('.glossary dt')].map(text), ['Regulation', 'Requirement', 'Evidence', 'Facet']);
  assert.match(text(doc.querySelector('main')), /1\. Policy What the company commits to/);
  assert.match(text(doc.querySelector('main')), /Requires \/ Required by The first item cannot be met without the second\./);
});

test('documents past valid_until show Expired; attributes show as a short details list', t => {
  const html = build(t, dir => editYaml(dir, 'documents.yaml', doc => {
    doc.documents.find(d => d.id === 'POL-002').valid_until = '2020-01-01';
  }));
  const pol = open(t, html, 'doc/POL-002').document;
  const header = d => d.querySelector('main > section'); // tags, title, dates
  assert.equal(text(header(pol).querySelector('.tag-expired')), 'Expired');
  assert.match(text(pol.querySelector('main .muted')), /expired Jan 1, 2020/);
  assert.ok(open(t, html, 'documents').document.querySelector('.tag-expired'), 'also tagged in the document list');

  const evd = open(t, html, 'doc/EVD-001').document;
  assert.equal(header(evd).querySelector('.tag-expired'), null, 'valid until 2030 is not expired');
  assert.match(text(header(evd)), /valid until Dec 31, 2030/);
  assert.equal(text(evd.querySelector('.attrs')), 'Accounts reviewed 214');

  const attr = open(t, html, 'reg/soc2').document.querySelector('[data-panel="identity"] .attr');
  assert.equal(text(attr), 'Observation period 12 months');
  assert.equal(attr.title, 'Source: AICPA SOC 2 guide');
});
