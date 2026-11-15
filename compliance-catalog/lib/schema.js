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

// doc_type is free-text. Only the value 'reference' has special behavior (layer may be omitted).
// No closed enum — do not add a 'values' property to the doc_type column definition.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- column definitions ----------
// key:      field name in the YAML entity
// header:   column label in the workbook
// required: true = empty string on this field is a validation error
// type:     'string' | 'enum' | 'date' | 'integer' | 'boolean' | 'pipe_list'
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
    { key: 'reg_document',      header: 'Reg Document',      required: false, type: 'string',    note: 'Document ID from Documents sheet' },
    { key: 'source_url',        header: 'Source URL',        required: false, type: 'string' },
    { key: 'version_tracked',   header: 'Version Tracked',   required: false, type: 'string' },
    { key: 'version_note',      header: 'Version Note',      required: false, type: 'string',    note: 'Triggers amber callout warning that assessed version may differ from current' },
    { key: 'wording_note',      header: 'Wording Note',      required: false, type: 'string',    note: 'Fallback disclaimer for obligations with official_wording: false' },
    { key: 'total_obligations', header: 'Total Obligations', required: false, type: 'integer' },
    { key: 'date_display',      header: 'Date Display',      required: false, type: 'string',    note: 'Fallback text when no future key date exists' },
    { key: 'last_reviewed',     header: 'Last Reviewed',     required: false, type: 'date' },
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
  ],

  Topics: [
    { key: 'id',            header: 'ID',             required: true,  type: 'string' },
    { key: 'name',          header: 'Name',           required: true,  type: 'string' },
    { key: 'blurb',         header: 'Blurb',          required: false, type: 'string',    note: 'Subtitle on topic tile cards' },
    { key: 'summary',       header: 'Summary',        required: false, type: 'string',    note: 'Lede on topic detail page; glossary terms hyperlinked' },
    { key: 'applies_to_you',header: 'Applies To You', required: false, type: 'pipe_list', note: 'Pipe-separated checklist items for "This applies to you if…"' },
    { key: 'related',       header: 'Related',        required: false, type: 'pipe_list', note: 'Pipe-separated topic IDs; validated but not currently rendered' },
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
];

// Template version. Major digit mismatch = importer refuses. Minor digit mismatch = warn.
const TEMPLATE_VERSION = '1.0';

module.exports = {
  SOURCE_TYPES,
  OBLIGATION_TYPES,
  STATUSES,
  ISO_DATE,
  COLUMNS,
  SHEET_ORDER,
  TEMPLATE_VERSION,
};
