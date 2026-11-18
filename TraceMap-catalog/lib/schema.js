'use strict';

// Shared constants used by build.js, generate-template.js, import-xlsx.js, and export-xlsx.js.
//
// What lives here:
//   - Closed enum values for fields whose valid set is fixed in the schema
//   - Column definitions for each XLSX sheet (key, header, required, type)
//   - Sheet order
//   - Template version
//
// What does NOT live here and why:
//   - Layer IDs: defined in catalog.yaml at runtime; generate-template.js reads them to build
//     the Layer column dropdown and validate layer overrides.
//   - Dynamic facet columns (e.g. category, jurisdiction, scope): defined as facets[] in
//     catalog.yaml; generate-template.js appends one column per facet to COLUMNS.Regulations
//     at generation time — they are not in the static definition below.
//   - Instructions sheet content (version cell, prose, field notes): authored in
//     generate-template.js, which writes the sheet from the TEMPLATE_VERSION constant and
//     the column definitions here.

const SOURCE_TYPES     = ['mandate', 'guidance', 'standard', 'market'];
const OBLIGATION_TYPES = ['compliant_with', 'certified_to', 'aligned_with', 'implements', 'context'];
const STATUSES         = ['verified', 'deviations_noted', 'verification_pending', 'not_assessed'];

// Relationship types used when catalog.yaml has no relationship_types section. Listing that
// section replaces these entirely. label reads from from_item; inverse_label from to_item.
const DEFAULT_RELATIONSHIP_TYPES = [
  { id: 'upstream',   label: 'Upstream of',   inverse_label: 'Downstream of', description: 'The first item comes before the second and shapes it, such as a policy upstream of the procedures that carry it out.' },
  { id: 'downstream', label: 'Downstream of', inverse_label: 'Upstream of',   description: 'The first item follows from the second, such as a procedure downstream of its policy.' },
  { id: 'requires',   label: 'Requires',      inverse_label: 'Required by',   description: 'The first item cannot be met without the second.' },
  { id: 'references', label: 'References',    inverse_label: 'Referenced by', description: 'The first item points to the second for detail.' },
  { id: 'related',    label: 'Related to',    inverse_label: 'Related to',    description: 'The two items cover the same subject.' },
];

// The relationship types a catalog uses, with label and inverse_label filled in.
function relationshipTypes(catalog) {
  const list = catalog && Array.isArray(catalog.relationship_types) ? catalog.relationship_types : DEFAULT_RELATIONSHIP_TYPES;
  return list.filter(t => t && t.id).map(t => {
    const label = t.label || t.id;
    return Object.assign({}, t, { label, inverse_label: t.inverse_label || label });
  });
}

// Kinds of item that can carry attributes[], as Item Kind value -> sheet.
const ATTRIBUTE_PARENTS = { regulation: 'Regulations', obligation: 'Obligations', document: 'Documents' };

// Fields whose name starts with "x-" belong to the author: never validated, never rendered unless
// a panel asks for them, and carried through YAML, workbook (scalar values), and HTML unchanged.
const isExtension = key => typeof key === 'string' && key.startsWith('x-');

// Kinds of item a relationship can point at, as prefix -> key in the data object.
// A relationship endpoint is a bare ID when it is unique across these, or "<prefix>:<id>".
const ITEM_KINDS = {
  regulation: 'regulations',
  obligation: 'obligations',
  document:   'documents',
  topic:      'topics',
  control:    'controls',
};

// Legacy relationship fields. They keep working; a later release moves them to relationships.yaml.
const LEGACY_NOTE = 'Legacy field: still supported; a later release moves this to the Relationships sheet.';

// doc_type is free-text. Only the value 'reference' has special behavior (layer may be omitted).
// No closed enum — do not add a 'values' property to the doc_type column definition.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- column definitions ----------
// key:      field name in the YAML entity
// header:   column label in the workbook
// required: true = empty string on this field is a validation error
// type:     'string' | 'enum' | 'date' | 'integer' | 'boolean' | 'pipe_list' | 'kv_map'
//           kv_map: a YAML map of key: value, written in one cell as "a: 1 | b: 2"
// values:   closed list of allowed values (enum only)
// note:     hint surfaced on the Instructions sheet

const COLUMNS = {

  // Dynamic facet columns (e.g. category, jurisdiction, scope) are appended here at
  // generation time by generate-template.js after reading catalog.yaml facets[].
  Regulations: [
    { key: 'id',                header: 'ID',                required: true,  type: 'string' },
    { key: 'name',              header: 'Short Name',        required: true,  type: 'string' },
    { key: 'full_title',        header: 'Full Title',        required: false, type: 'string' },
    { key: 'source_type',       header: 'Source Type',       required: true,  type: 'enum',      values: SOURCE_TYPES },
    { key: 'obligation_type',   header: 'Obligation Type',   required: true,  type: 'enum',      values: OBLIGATION_TYPES },
    { key: 'applies_if',        header: 'Applies If',        required: false, type: 'pipe_list', note: '"always" or pipe-separated applicability IDs from catalog.yaml' },
    { key: 'accountable_role',  header: 'Accountable Role',  required: false, type: 'string' },
    { key: 'condition',         header: 'Condition',         required: false, type: 'string' },
    { key: 'summary',           header: 'Summary',           required: false, type: 'string' },
    { key: 'applies_when',      header: 'Applies When',      required: false, type: 'pipe_list', note: 'Pipe-separated checklist items for "Does this apply to my work?"' },
    { key: 'does_not_apply',    header: 'Does Not Apply',    required: false, type: 'pipe_list', note: 'Pipe-separated exclusion statements' },
    { key: 'context_note',      header: 'Context Note',      required: false, type: 'string',    note: 'Shown instead of coverage stats when obligation_type is context' },
    { key: 'reg_document',      header: 'Reg Document',      required: false, type: 'string',    note: 'Document ID from Documents sheet. ' + LEGACY_NOTE },
    { key: 'source_url',        header: 'Source URL',        required: false, type: 'string' },
    { key: 'version_tracked',   header: 'Version Tracked',   required: false, type: 'string' },
    { key: 'version_note',      header: 'Version Note',      required: false, type: 'string',    note: 'Triggers amber callout warning that assessed version may differ from current' },
    { key: 'wording_note',      header: 'Wording Note',      required: false, type: 'string',    note: 'Fallback disclaimer for obligations with official_wording: false' },
    { key: 'total_obligations', header: 'Total Obligations', required: false, type: 'integer' },
    { key: 'date_display',      header: 'Date Display',      required: false, type: 'string',    note: 'Fallback text when no future key date exists' },
    { key: 'last_reviewed',     header: 'Last Reviewed',     required: false, type: 'date' },
    { key: 'sequence',          header: 'Sequence',          required: false, type: 'integer',   note: 'Sort position in lists; lower first. Rows without one keep file order after those with one.' },
    { key: 'parent',            header: 'Parent',            required: false, type: 'string',    note: 'ID of a parent regulation on this sheet' },
    { key: 'created_at',        header: 'Created At',        required: false, type: 'date',      note: 'When this record was added. Not set automatically.' },
    { key: 'modified_at',       header: 'Modified At',       required: false, type: 'date',      note: 'When this record last changed. Not set automatically.' },
  ],

  Reg_Key_Dates: [
    { key: 'regulation_id', header: 'Regulation ID', required: true,  type: 'string',  note: 'Must match an ID in Regulations' },
    { key: 'date',          header: 'Date',          required: false, type: 'date' },
    { key: 'date_text',     header: 'Date Text',     required: false, type: 'string',  note: 'Display override (e.g. "Q3 2027"); raw date still used for sorting' },
    { key: 'label',         header: 'Label',         required: true,  type: 'string' },
    { key: 'detail',        header: 'Detail',        required: false, type: 'string' },
    { key: 'kind',          header: 'Kind',          required: false, type: 'string',  note: 'Special value "internal" shows "internal milestone" in timeline; blank = external' },
    { key: 'pending',       header: 'Pending',       required: false, type: 'boolean', note: 'TRUE for upcoming events with no specific calendar date' },
  ],

  Obligations: [
    { key: 'id',               header: 'ID',               required: true,  type: 'string' },
    { key: 'regulation_id',    header: 'Regulation ID',    required: true,  type: 'string' },
    { key: 'control_id',       header: 'Control ID',       required: true,  type: 'string',    note: 'Official identifier from the regulation (e.g. CC6.1, AC-2)' },
    { key: 'title',            header: 'Title',            required: true,  type: 'string' },
    { key: 'text',             header: 'Text',             required: false, type: 'string',    note: 'Official or summary wording; shown indented in detail panel' },
    { key: 'official_wording', header: 'Official Wording', required: false, type: 'boolean',   note: 'Default TRUE. Set FALSE to show disclaimer beneath text.' },
    { key: 'wording_note',     header: 'Wording Note',     required: false, type: 'string',    note: 'Per-obligation disclaimer (overrides regulation and catalog fallbacks)' },
    { key: 'common_control',   header: 'Common Control',   required: false, type: 'string',    note: 'Control ID from Controls sheet' },
    { key: 'topics',           header: 'Topics',           required: false, type: 'pipe_list', note: 'Pipe-separated topic IDs' },
    { key: 'accountable_role', header: 'Accountable Role', required: false, type: 'string' },
    { key: 'family',           header: 'Family',           required: false, type: 'string',    note: 'Groups obligations under a subheading; default "Requirements"' },
    { key: 'version',          header: 'Version',          required: false, type: 'string',    note: '"Assessed against [version]"; overridden by mapped_against_version on the mapping' },
    { key: 'plain_title',      header: 'Plain Title',      required: false, type: 'string',    note: 'Card heading on topic pages; falls back to title' },
    { key: 'plain_summary',    header: 'Plain Summary',    required: false, type: 'string',    note: '"In plain terms:" in detail panel; included in search' },
    { key: 'sequence',         header: 'Sequence',         required: false, type: 'integer',   note: 'Sort position in lists; lower first. Rows without one keep file order after those with one.' },
    { key: 'created_at',       header: 'Created At',       required: false, type: 'date',      note: 'When this record was added. Not set automatically.' },
    { key: 'modified_at',      header: 'Modified At',      required: false, type: 'date',      note: 'When this record last changed. Not set automatically.' },
  ],

  Mappings: [
    { key: 'obligation_id',          header: 'Obligation ID',          required: true,  type: 'string' },
    { key: 'status',                 header: 'Status',                 required: true,  type: 'enum',    values: STATUSES },
    { key: 'rationale',              header: 'Rationale',              required: false, type: 'string',  note: 'Expected when status is deviations_noted or verification_pending' },
    { key: 'notes',                  header: 'Notes',                  required: false, type: 'string',  note: 'Additional notes shown beneath rationale (muted)' },
    { key: 'mapped_against_version', header: 'Mapped Against Version', required: false, type: 'string',  note: 'Overrides obligation.version in detail panel' },
    { key: 'review_interval_days',   header: 'Review Interval Days',   required: false, type: 'integer', note: 'Per-mapping override of catalog default' },
    { key: 'last_reviewed',          header: 'Last Reviewed',          required: false, type: 'date' },
  ],

  // Legacy: mapping.documents. Still supported; a later release moves it to Relationships.
  Mapping_Docs: [
    { key: 'obligation_id', header: 'Obligation ID',  required: true,  type: 'string', note: 'Must match an Obligation ID in Mappings' },
    { key: 'document_id',   header: 'Document ID',    required: true,  type: 'string', note: 'Must match an ID in Documents' },
    { key: 'layer',         header: 'Layer Override', required: false, type: 'string', note: "Overrides the document's own layer for this mapping only" },
  ],

  Documents: [
    { key: 'id',                   header: 'ID',                   required: true,  type: 'string' },
    { key: 'title',                header: 'Title',                required: true,  type: 'string' },
    { key: 'layer',                header: 'Layer',                required: false, type: 'string',  note: 'Required unless doc_type is reference' },
    { key: 'doc_type',             header: 'Doc Type',             required: false, type: 'string',  note: 'Free text. Special value "reference" allows omitting layer.' },
    { key: 'url',                  header: 'URL',                  required: false, type: 'string' },
    { key: 'status_note',          header: 'Status Note',          required: false, type: 'string',  note: 'Shown instead of URL link when set' },
    { key: 'revision',             header: 'Revision',             required: false, type: 'string' },
    { key: 'date_filed',           header: 'Date Filed',           required: false, type: 'date' },
    { key: 'last_reviewed',        header: 'Last Reviewed',        required: false, type: 'date' },
    { key: 'review_interval_days', header: 'Review Interval Days', required: false, type: 'integer', note: 'Per-document override of catalog default' },
    { key: 'restricted',           header: 'Restricted',           required: false, type: 'boolean', note: 'Shows "Restricted access" tag; does not enforce access control' },
    { key: 'sequence',             header: 'Sequence',             required: false, type: 'integer', note: 'Sort position in lists; lower first. Rows without one keep file order after those with one.' },
    { key: 'parent',               header: 'Parent',               required: false, type: 'string',  note: 'ID of a parent document on this sheet' },
    { key: 'valid_until',          header: 'Valid Until',          required: false, type: 'date',    note: 'After this date the document shows as Expired' },
    { key: 'created_at',           header: 'Created At',           required: false, type: 'date',    note: 'When this record was added. Not set automatically.' },
    { key: 'modified_at',          header: 'Modified At',          required: false, type: 'date',    note: 'When this record last changed. Not set automatically.' },
  ],

  Topics: [
    { key: 'id',            header: 'ID',             required: true,  type: 'string' },
    { key: 'name',          header: 'Name',           required: true,  type: 'string' },
    { key: 'blurb',         header: 'Blurb',          required: false, type: 'string',    note: 'Subtitle on topic tile cards' },
    { key: 'summary',       header: 'Summary',        required: false, type: 'string',    note: 'Lede on topic detail page; glossary terms hyperlinked' },
    { key: 'applies_to_you',header: 'Applies To You', required: false, type: 'pipe_list', note: 'Pipe-separated checklist items for "This applies to you if…"' },
    { key: 'related',       header: 'Related',        required: false, type: 'pipe_list', note: 'Pipe-separated topic IDs, shown as "Related topics" on the topic page. ' + LEGACY_NOTE },
    { key: 'parent',        header: 'Parent',         required: false, type: 'string',    note: 'ID of a parent topic on this sheet' },
  ],

  Controls: [
    { key: 'id',      header: 'ID',      required: true,  type: 'string' },
    { key: 'name',    header: 'Name',    required: true,  type: 'string' },
    { key: 'topic',   header: 'Topic',   required: true,  type: 'string' },
    { key: 'summary', header: 'Summary', required: false, type: 'string' },
  ],

  Roles: [
    { key: 'id',   header: 'ID',   required: true,  type: 'string' },
    { key: 'name', header: 'Name', required: false, type: 'string', note: 'A role without a name renders as nothing in the UI' },
  ],

  Glossary: [
    { key: 'term',       header: 'Term',       required: true,  type: 'string' },
    { key: 'definition', header: 'Definition', required: true,  type: 'string' },
    { key: 'aliases',    header: 'Aliases',    required: false, type: 'pipe_list', note: 'Alternate forms that also trigger the tooltip' },
  ],

  // Folded into the parent's attributes[] list; Item Kind + Item ID name the parent.
  Attributes: [
    { key: 'item_kind', header: 'Item Kind', required: true,  type: 'enum',   values: Object.keys(ATTRIBUTE_PARENTS), note: 'Which sheet the item is on' },
    { key: 'item_id',   header: 'Item ID',   required: true,  type: 'string', note: 'ID of the item on that sheet' },
    { key: 'name',      header: 'Name',      required: true,  type: 'string', note: 'Each name once per item' },
    { key: 'value',     header: 'Value',     required: true,  type: 'string', note: 'Stored as text, even when it is a number' },
    { key: 'unit',      header: 'Unit',      required: false, type: 'string', note: 'e.g. days, months, %' },
    { key: 'source',    header: 'Source',    required: false, type: 'string', note: 'Where the value comes from' },
  ],

  // The Type dropdown lists catalog.yaml relationship_types (or the defaults); generate-template.js
  // fills it in, and validate() checks it, so it is a plain string here.
  Relationships: [
    { key: 'from_item',   header: 'From Item',   required: true,  type: 'string', note: 'ID of a regulation, obligation, document, topic, or control. If the same ID is used by two kinds of item, prefix it: topic:logging' },
    { key: 'to_item',     header: 'To Item',     required: true,  type: 'string', note: 'Same format as From Item' },
    { key: 'type',        header: 'Type',        required: true,  type: 'string', note: 'A relationship type ID from catalog.yaml. Read as "From Item <type> To Item"; the other item shows the reverse.' },
    { key: 'description', header: 'Description', required: false, type: 'string' },
    { key: 'attributes',  header: 'Attributes',  required: false, type: 'kv_map' },
    { key: 'created_at',  header: 'Created At',  required: false, type: 'date',   note: 'When this relationship was added. Not set automatically.' },
    { key: 'modified_at', header: 'Modified At', required: false, type: 'date',   note: 'When this relationship last changed. Not set automatically.' },
  ],

};

const SHEET_ORDER = [
  'Instructions',
  'Regulations', 'Reg_Key_Dates',
  'Obligations',
  'Mappings', 'Mapping_Docs',
  'Documents',
  'Topics', 'Controls',
  'Roles',
  'Glossary',
  'Attributes',
  'Relationships',
];

// Template version: the workbook layout. Read from Instructions!C2.
// Major digit mismatch = importer refuses. Minor digit mismatch = warn.
// 1.1: Attributes and Relationships sheets; data schema version in C3; new columns.
const TEMPLATE_VERSION = '1.1';

// Data schema version: the YAML format. Written as schema_version in every YAML file and in
// Instructions!C3. Same rules: major mismatch refused, minor mismatch warned, missing = 1.0.
const SCHEMA_VERSION = '1.0';

// Sheets added after 1.0, with the minor version that added them. An older workbook without
// one of these imports with a warning (the sheet is treated as empty) instead of being refused.
const SHEETS_ADDED_IN = { Attributes: 1, Relationships: 1 };

module.exports = {
  SOURCE_TYPES,
  OBLIGATION_TYPES,
  STATUSES,
  DEFAULT_RELATIONSHIP_TYPES,
  relationshipTypes,
  ATTRIBUTE_PARENTS,
  isExtension,
  ITEM_KINDS,
  ISO_DATE,
  COLUMNS,
  SHEET_ORDER,
  TEMPLATE_VERSION,
  SCHEMA_VERSION,
  SHEETS_ADDED_IN,
};
