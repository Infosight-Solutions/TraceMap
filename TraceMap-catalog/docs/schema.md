# TraceMap Data Schema

Extracted from `build.js` (validation) and `src/app.js` (rendering). This is the authoritative
reference for anyone authoring YAML data files.

---

## Overview

Ten YAML files, six required and four optional, all in one data directory
(default `data/`, public example `data-example/`).

| File | Required | Top-level key |
|---|---|---|
| `catalog.yaml` | yes | *(none — the whole document is the catalog object)* |
| `regulations.yaml` | yes | `regulations` |
| `obligations.yaml` | yes | `obligations` |
| `documents.yaml` | yes | `documents` |
| `mappings.yaml` | yes | `mappings` |
| `topics.yaml` | yes | `topics` |
| `controls.yaml` | no | `controls` |
| `roles.yaml` | no | `roles` |
| `glossary.yaml` | no | `glossary` |
| `relationships.yaml` | no | `relationships` |

### `schema_version`

Every file starts with the version of this data format it was written for:

```yaml
schema_version: "1.0"
```

Quote it: unquoted, YAML reads `1.0` as the number 1 (still accepted, read as 1.0). `build.js`,
`npm run export-xlsx`, and the importer check it:

| Found | Result |
|---|---|
| Same major, different minor (e.g. 1.1 data, 1.0 TraceMap) | Warning; the build continues |
| Different major | Refused, nothing written. Older data points to [Upgrading](#upgrading); newer data asks you to update TraceMap |
| No `schema_version` | Treated as 1.0, with one warning listing the files that need the line |

The workbook carries the same version in Instructions cell C3, and the importer writes it at the
top of every YAML file. (C2 is the separate *template* version, which tracks the workbook layout.)

### Extension fields (`x-`)

Any field whose name starts with `x-` belongs to you, on any record or in `catalog.yaml`:
`x-owner: grc-team`. TraceMap never validates these fields and never shows them, but keeps them:

- The build embeds them in the HTML data like every other field.
- Export gives each `x-` field with a single value (text, number, true/false) its own column;
  the importer reads any column whose header starts with `x-` back into the YAML.
- An `x-` field holding a list or map cannot fit in a cell; export reports it and leaves it out
  of the workbook (the YAML is not changed).

A field that is neither in this schema nor `x-` is also ignored by the build, but export drops it
with a warning. Renaming it to `x-<name>` keeps it.

---

## 1. `catalog.yaml`

The whole document is a single object — no wrapping key.

### Required

| Field | Type | Notes |
|---|---|---|
| `title` | string | Shown in top-left brand header and browser tab. |
| `layers` | list of layer objects | At least one required. Defines the document traceability layers (e.g., Policy → Procedure). Layer `id` must be unique within the list. |

**Layer object fields**

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Referenced by documents and mapping overrides. |
| `name` | no | Shown as column heading in the traceability grid. |
| `description` | no | Not currently rendered in UI. |
| `empty_text` | no | Shown inside an empty layer cell in the detail panel. |

> **Limit:** The traceability grid CSS is capped at 4 columns. More than 4 layers is not an error
> but layers beyond the fourth will overflow the layout. No build warning.

### Optional — UI copy

| Field | Default | Notes |
|---|---|---|
| `organization` | *(none)* | Shown beneath brand title. Combined with `title` and "TraceMap" in browser tab: `{org} · {title} · TraceMap`. |
| `version` | *(none)* | Shown in footer. |
| `as_of` | *(none)* | ISO date. Shown in header as "Status as of [date]". |
| `sample_notice` | *(none)* | Renders an amber badge in the header. Use for demo builds. |
| `scope_notice` | hardcoded fallback | Shown in header notice band. |
| `home_heading` | "Find the requirements that apply to your work" | H1 on the home page. |
| `home_intro` | hardcoded fallback | Lede paragraph on the home page. |
| `search_placeholder` | hardcoded fallback | Placeholder text in the search box. |
| `reg_doc_label` | "reference file" | Appears in "Open [doc id] [reg_doc_label]" button on regulation detail pages. |
| `footer_note` | hardcoded fallback | Left column of the footer. |
| `summary_note` | "Summary, not the official wording." | Global fallback disclaimer shown beneath obligation `text` when `official_wording: false` and no more specific note exists. |

### Optional — behavior

| Field | Type | Default | Notes |
|---|---|---|---|
| `review_interval_days` | integer | 365 | Global review cadence in days. Can be overridden per document or per mapping with the same field name. |
| `status_labels` | object | *(see Enumerations)* | Map of status key → display string. Overrides the four default labels in the UI and CSV exports. |
| `status_descriptions` | object | built-in text | Map of status key → one-sentence meaning. Shown when hovering a status label, coverage bar, or shared-controls dot, and on the Legend page. |
| `applicability_prompt` | string | "Check everything that applies to you" | Label above the applicability checkboxes. |
| `applicability` | list | *(none)* | Defines the filter checkboxes on the home page. If empty, the applicability panel is hidden. |
| `group_field` | string | `"category"` | Which facet field to use for default grouping in the regulation library. Should match a `field` in `facets`. |
| `facets` | list | *(none)* | Custom filter chips shown in the regulation library. `source_type`, timing, and documentation status filters are always present and do not need to be listed here. |
| `relationship_types` | list | five defaults | Types allowed in `relationships.yaml`. See [relationships.yaml](#10-relationshipsyaml-optional). |
| `layouts` | map | current layout | Page layout settings. See [Layouts](#layouts) below. |

**Applicability object fields**

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Referenced in `regulations.applies_if`. |
| `label` | no | Full checkbox label. |
| `short` | no | Compact label for the active-filter note bar. Falls back to `label`. |
| `help` | no | Sub-text shown beneath the checkbox label. |

**Facet object fields**

| Field | Required | Notes |
|---|---|---|
| `field` | yes | Must match a field name on regulation objects. The engine reads `regulation[field]` directly; value may be a scalar or a list. |
| `label` | no | Shown above the chip group. |
| `values` | yes | Map of `value_key: "Display label"`. Values not in this map are still displayed using the raw key. |
| `in_table` | no | Boolean. If `true`, adds a column to the regulation library table. |

### Layouts

Every setting is optional. Leaving out `layouts` (or any part of it) keeps the layout as it was
before these settings existed. Mistakes (an unknown setting, panel, or value) are build errors
that name the setting.

```yaml
layouts:
  index:                              # the home page
    tiles: [topics]                   # [] hides the topic tiles
    show_applicability_filters: true  # the "Check everything that applies" panel
  browse:                             # the regulation library and document list
    default_group_by: category        # a facet field, date, or id
    default_sort: sequence            # sequence | name | id
    show_columns: [name, type, jurisdiction, scope, key_date, coverage]
    display_mode: list                # list is the only mode so far
  detail:                             # the regulation page, top to bottom
    panels: [identity, category_boxes, applies_when, timeline, status, requirements, relationships, evidence]
  dashboard:                          # reserved; there is no dashboard page yet
    enabled: false
    aggregate_by: [status, source_type]
```

| Setting | Default | Notes |
|---|---|---|
| `index.tiles` | `[topics]` | Which tile sections the home page shows. `topics` is the only one so far. |
| `index.show_applicability_filters` | `true` | |
| `browse.default_group_by` | `group_field`, else `category` | How the library is grouped when it opens. A facet field becomes the first "Group by" button. |
| `browse.default_sort` | `sequence` | Order within groups and in the document list. `sequence`: items with a `sequence` first, lowest first, the rest in file order (with no sequences, this is file order). `name`: alphabetical by name or title. `id`: alphabetical by ID. Grouping by key date still sorts by date. Requirements on a regulation page always follow `sequence`. |
| `browse.show_columns` | `name`, `type`, facets with `in_table: true`, `key_date`, `coverage` | Library table columns, in order. A facet field adds that facet's column. |
| `browse.display_mode` | `list` | |
| `detail.panels` | all eight, in the order above | Sections of the regulation page, top to bottom: `identity` (ID, name, summary, details, buttons), `category_boxes` (one box per facet, applicable values shaded), `applies_when`, `timeline` (key dates), `status` (coverage counts, or why a context-only regulation is listed), `requirements`, `relationships` (from `relationships.yaml`), `evidence` (every document its requirements rely on, by layer). Leave one out to hide it. An entry can carry options: `- { panel: category_boxes, max_values: 6 }`. Two panels that sit side by side (`applies_when`, `timeline`) share a row when they are next to each other. |
| `dashboard.enabled` | `false` | Accepted and checked, but has no effect until a dashboard page exists. |
| `dashboard.aggregate_by` | `[status, source_type]` | `status`, `source_type`, or a facet field. |

`group_field` and `in_table` keep working; they set the defaults above.

---

## 2. `regulations.yaml`

Top-level key: `regulations` (list).

### Required

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within file. Used in URL routing — avoid `/` and `#` characters. |
| `name` | string | Display name used everywhere. |
| `source_type` | enum | `mandate \| guidance \| standard \| market` |
| `obligation_type` | enum | `compliant_with \| certified_to \| aligned_with \| implements \| context` |

### Optional — with build warnings

| Field | Warning condition | Notes |
|---|---|---|
| `applies_if` | Warning if absent | Either the string `"always"` or a list of applicability IDs from `catalog.applicability`. If absent, the regulation is hidden whenever any applicability box is checked. |

### Optional — content

| Field | Type | Notes |
|---|---|---|
| `full_title` | string | Shown as subtitle on the regulation detail page. |
| `summary` | string | Lede text on the regulation detail page. Glossary terms hyperlinked. |
| `reg_document` | document ID | **Legacy** (see [Legacy relationship fields](#legacy-relationship-fields)). Link to a reference document (e.g., full regulation text). Must exist in `documents.yaml`. Enables the "Open [reg_doc_label]" button. |
| `source_url` | URL string | Link to the external official source. Shown as "Official source" button (opens in new tab). |
| `accountable_role` | role ID | Must exist in `roles.yaml`. Shown as "Not sure? Ask the [role]." |
| `condition` | string | Short phrase shown as a tag badge on the regulation row in the crosswalk table (e.g. "EU personal data"). Useful for signaling applicability at a glance. |
| `applies_when` | list of strings | Checklist in "Does this apply to my work?" Rendered through glossary substitution. |
| `does_not_apply` | list of strings | Exclusions panel alongside `applies_when`. |
| `context_note` | string | Shown instead of coverage stats when `obligation_type: context`. |
| `version_tracked` | string | Shown in amber callout alongside `version_note`. |
| `version_note` | string | Triggers an amber callout warning that the version assessed may differ from the current version. |
| `wording_note` | string | Fallback disclaimer for obligations under this regulation that have `text` but `official_wording: false`. Cascade: obligation → regulation → `catalog.summary_note` → hardcoded fallback. |
| `last_reviewed` | ISO date | Used in overdue calculation. Format validated. |
| `total_obligations` | non-negative integer | If set and greater than the number of obligations cataloged, the UI shows "N more requirements in scope but not yet added." They count as `not_assessed` in coverage stats. |
| `date_display` | string | Fallback text shown in the regulation library table when no future key date exists. |
| `sequence` | non-negative integer | Sort position in lists; lower first. Items without one follow, in file order. |
| `parent` | regulation ID | Another regulation in this file. Must not be the regulation itself or form a loop. |
| `attributes` | list | Extra facts; see [Attributes](#attributes). |
| `created_at`, `modified_at` | ISO date | When the record was added and last changed. Format validated; not set automatically and not shown. |

**Key dates object** (items in `key_dates` list)

| Field | Required | Notes |
|---|---|---|
| `label` | yes | Short name for the date (e.g., "Effective date"). |
| `date` | no | ISO date. Validated format. If absent, renders as "Date not set" but `label` is still shown. |
| `date_text` | no | Overrides the formatted `date` for display only (e.g., `"Q3 2027"`). The raw `date` is still used for sorting and countdown calculations. |
| `detail` | no | Supplementary text shown beneath the label in the timeline. |
| `kind` | no | String. Special value `"internal"` causes "internal milestone" to appear in the timeline. |
| `pending` | no | Boolean. Marks a future date without a specific calendar date — treated as upcoming. |

**Facet fields:** Any field matching a `facets[].field` defined in `catalog.yaml`. Value may be a scalar string or a list of strings. Unknown values are displayed using the raw key.

---

## 3. `obligations.yaml`

Top-level key: `obligations` (list).

### Required

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within file. |
| `regulation_id` | regulation ID | Must exist in `regulations.yaml`. |
| `control_id` | string | Official identifier (e.g., "AC-2", "A.9.1.1"). Shown in monospace throughout the UI. |
| `title` | string | Short description of the requirement. |

### Optional — with build warnings

| Field | Warning condition | Notes |
|---|---|---|
| `common_control` | Warning if neither `common_control` nor `topics` is set | Control ID, must exist in `controls.yaml`. Causes the obligation to appear in the crosswalk. |
| `topics` | Warning if neither `common_control` nor `topics` is set | List of topic IDs, each validated against `topics.yaml`. Direct topic assignment. |

### Optional — content

| Field | Type | Notes |
|---|---|---|
| `text` | string | Official or summary wording. Shown indented in the detail panel. |
| `official_wording` | boolean | Default `true`. Set to `false` to show a disclaimer note beneath `text`. |
| `wording_note` | string | Per-obligation disclaimer note (see cascade under `regulations.wording_note`). |
| `plain_title` | string | Used as card heading on topic pages. Falls back to `title`. Also included in search. |
| `plain_summary` | string | "In plain terms:" shown in detail panel. Included in search. |
| `version` | string | "Assessed against [version]" shown in detail panel unless the mapping provides `mapped_against_version`. |
| `accountable_role` | role ID | Must exist in `roles.yaml`. Shown as "Accountable: [role name]." |
| `family` | string | Groups requirements under a subheading in the regulation detail view. Default: `"Requirements"`. Groups appear in first-encountered order. |
| `sequence` | non-negative integer | Sort position in lists; lower first. Items without one follow, in file order. |
| `attributes` | list | Extra facts; see [Attributes](#attributes). |
| `created_at`, `modified_at` | ISO date | When the record was added and last changed. Format validated; not set automatically and not shown. |

---

## 4. `mappings.yaml`

Top-level key: `mappings` (list). Each obligation may appear at most once — a duplicate
`obligation_id` is a build error.

### Required per entry

| Field | Type | Notes |
|---|---|---|
| `obligation_id` | obligation ID | Must exist in `obligations.yaml`. |
| `status` | enum | `verified \| deviations_noted \| verification_pending \| not_assessed` |

### Optional — with build warnings

| Field | Warning condition | Notes |
|---|---|---|
| `rationale` | Warning if `status` is `deviations_noted` or `verification_pending` | Free text explaining the status. Shown as "Why this status." |

### Optional

| Field | Type | Notes |
|---|---|---|
| `notes` | string | Additional notes. Shown beneath rationale in the detail panel (muted). |
| `last_reviewed` | ISO date | Used in overdue calculation. Format validated. |
| `review_interval_days` | integer | Per-mapping override of `catalog.review_interval_days`. |
| `mapped_against_version` | string | "Assessed against [version]" in detail panel. Overrides `obligation.version` if both are set. |
| `documents` | list | **Legacy** (see [Legacy relationship fields](#legacy-relationship-fields)). Document evidence items. |

**Document evidence object** (items in `documents` list)

| Field | Required | Notes |
|---|---|---|
| `document_id` | yes | Must exist in `documents.yaml`. |
| `layer` | no | Layer ID. If set, overrides the document's own `layer` for this mapping only. Must exist in `catalog.layers`. |

---

## 5. `documents.yaml`

Top-level key: `documents` (list).

### Required

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within file. |
| `title` | string | |
| `layer` | layer ID | Must exist in `catalog.layers`. May be omitted only if `doc_type: reference`. |

### Optional — with build warnings

| Field | Warning condition | Notes |
|---|---|---|
| `url` | Warning if absent without `status_note` | URL to open the document. Any URL scheme is accepted by the build. Shown as "Open document" button. |
| `status_note` | Warning if absent without `url` | Explanation of why no link exists. Shown as text in the document link. |

### Optional

| Field | Type | Notes |
|---|---|---|
| `doc_type` | string | Special value `"reference"` allows omitting `layer`. Any value is shown as a tag on the document page. |
| `revision` | string | Revision label shown in document list and document links. |
| `date_filed` | ISO date | Format validated. Shown in document list. |
| `last_reviewed` | ISO date | Format validated. Used in overdue calculation. |
| `review_interval_days` | integer | Per-document override of `catalog.review_interval_days`. |
| `restricted` | boolean | Shows a "Restricted access" tag in red. Does not restrict access — the HTML is a static file. |
| `sequence` | non-negative integer | Sort position in lists; lower first. Items without one follow, in file order. |
| `parent` | document ID | Another document in this file. Must not be the document itself or form a loop. |
| `valid_until` | ISO date | After this date the document shows an "Expired" tag (checked against the date the page is viewed), and the build warns. Mapping statuses are not changed. |
| `attributes` | list | Extra facts; see [Attributes](#attributes). |
| `created_at`, `modified_at` | ISO date | When the record was added and last changed. Format validated; not set automatically and not shown. |

### Attributes

Regulations, obligations, and documents can carry a list of extra facts:

```yaml
attributes:
  - name: Observation period
    value: "12"
    unit: months
    source: AICPA SOC 2 guide
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Each name once per item. |
| `value` | yes | Text. A YAML number is accepted; the importer writes it back as text. |
| `unit` | no | e.g. `days`, `months`, `%`. |
| `source` | no | Where the value comes from. |

Shown as a short "Details" list on the regulation and document pages. In the workbook they live
on the **Attributes** sheet, one row per fact, with **Item Kind** (`regulation`, `obligation`,
or `document`) and **Item ID** naming the record they belong to.

---

## 6. `topics.yaml`

Top-level key: `topics` (list).

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique. |
| `name` | yes | string | |
| `blurb` | no | string | Subtitle on topic tile cards. |
| `summary` | no | string | Lede on the topic detail page. Glossary terms hyperlinked. |
| `applies_to_you` | no | list of strings | Rendered as a checklist: "This applies to you if you are…" |
| `related` | no | list of topic IDs | **Legacy** (see [Legacy relationship fields](#legacy-relationship-fields)). Shown as "Related topics" on the topic page. |
| `parent` | no | topic ID | Another topic in this file. Must not be the topic itself or form a loop. |

---

## 7. `controls.yaml` *(optional)*

Top-level key: `controls` (list). Controls represent shared requirements that appear in more
than one regulation. The crosswalk page is built from them.

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique. Referenced by `obligations.common_control`. |
| `name` | yes | string | Shown as the row heading in the crosswalk. |
| `topic` | yes | topic ID | Must exist in `topics.yaml`. Determines which topic page this control appears on. |
| `summary` | no | string | Shown beneath the control name in the crosswalk. |

---

## 8. `roles.yaml` *(optional)*

Top-level key: `roles` (list).

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique. Referenced by `regulations.accountable_role`, `obligations.accountable_role`. |
| `name` | no | Shown in "ask the [name]" and "Accountable: [name]" UI text. A role without a name renders as nothing. |

---

## 9. `glossary.yaml` *(optional)*

Top-level key: `glossary` (list). Sorted alphabetically at render time.

| Field | Required | Notes |
|---|---|---|
| `term` | yes | The word or phrase to match in body text. |
| `definition` | yes | Shown as a tooltip when the term appears in prose text. |
| `aliases` | no | Alternate forms that also trigger the tooltip. All aliases resolve to the same definition. |

**Matching behavior:** Longest-match-first, word-boundary (`\b`) anchored, case-sensitive.
Only the first occurrence of each term per rendered text block is linked. Applies to: regulation
`summary`, `context_note`, `applies_when`, `does_not_apply`; obligation `plain_summary`;
topic `summary`, `applies_to_you`. Does **not** apply to `title`, `name`, `control_id`, or `text`.

---

## 10. `relationships.yaml` *(optional)*

Top-level key: `relationships` (list). Each entry links two items and reads
"`from_item` *type* `to_item`". The item at the other end shows the reverse wording.

| Field | Required | Type | Notes |
|---|---|---|---|
| `from_item` | yes | item reference | See below. |
| `to_item` | yes | item reference | See below. Must be a different item than `from_item`. |
| `type` | yes | relationship type ID | One of `catalog.relationship_types` (see below). |
| `description` | no | string | Shown next to the link. |
| `attributes` | no | map | `key: value` pairs, values text or numbers (no lists or maps). In the workbook: one cell, `strength: strong \| reviewed_by: ciso`. A key or value containing `\|` cannot be exported. |
| `created_at`, `modified_at` | no | ISO date | Format validated; not set automatically. |

**Item references.** An endpoint can be a regulation, obligation, document, topic, or control.
Write a bare ID (`soc2`) when only one item has it. IDs only have to be unique within their own
file, so when two kinds of item share an ID, prefix it with the kind: `regulation:`,
`obligation:`, `document:`, `topic:`, or `control:` (for example `topic:logging`). A bare ID that
matches more than one item is a build error that names the prefixes to use.

The same pair of items with the same type may be listed only once.

**Relationship types** are declared in `catalog.yaml`. Without a `relationship_types` section,
the five defaults below apply (each with a short description for the Legend page); listing the
section replaces them entirely.

```yaml
relationship_types:
  - id: requires
    label: Requires              # how from_item reads
    inverse_label: Required by   # how to_item reads (defaults to label)
    description: The first item cannot be met without the second   # optional; on the Legend page
```

### Legacy relationship fields

These older fields still work and are still validated. A later release moves them into
`relationships.yaml`; until then, keep using them where they are.

| Field | Meaning |
|---|---|
| `regulation.reg_document` | The regulation's reference document |
| `mapping.documents[]` | Documents that address a requirement, by layer |
| `topic.related[]` | Related topics |

---

## Enumerations

### `source_type` (regulations)

| Value | Display |
|---|---|
| `mandate` | Mandate |
| `guidance` | Guidance |
| `standard` | Standard |
| `market` | Market-based |

### `obligation_type` (regulations)

| Value | Display | Notes |
|---|---|---|
| `compliant_with` | Must comply with | |
| `certified_to` | Certified or attested to | |
| `aligned_with` | Aligned with | |
| `implements` | Implements | |
| `context` | Listed for context only | No coverage tracking. The regulation detail page shows `context_note` instead of a requirements table. |

### `status` (mappings)

| Value | Display | Notes |
|---|---|---|
| `verified` | Verified | Requirement is fully addressed by documentation. |
| `deviations_noted` | Deviations noted | Coverage exists but a known gap remains. `rationale` is expected. |
| `verification_pending` | Verification pending | Not yet addressed in documentation. `rationale` is expected. |
| `not_assessed` | Not yet assessed | Has not been evaluated. No rationale expected. |

Display labels are overridable via `catalog.status_labels`, and the hover descriptions via
`catalog.status_descriptions`. Color coding: verified = navy, deviations noted = amber,
verification pending = red outline, not assessed = gray dashed. The Legend page (footer link)
shows each color with its meaning.

### Default relationship types

| `id` | `label` (from `from_item`) | `inverse_label` (from `to_item`) |
|---|---|---|
| `upstream` | Upstream of | Downstream of |
| `downstream` | Downstream of | Upstream of |
| `requires` | Requires | Required by |
| `references` | References | Referenced by |
| `related` | Related to | Related to |

---

## Cross-reference rules (build errors if violated)

| Rule |
|---|
| `regulation.reg_document` must exist in documents |
| `regulation.accountable_role` must exist in roles |
| `regulation.applies_if` IDs must exist in `catalog.applicability` |
| `regulation.[facet_field]` values must exist in that facet's `values` map |
| `obligation.regulation_id` must exist in regulations |
| `obligation.common_control` must exist in controls |
| `obligation.topics[]` must exist in topics |
| `obligation.accountable_role` must exist in roles |
| `mapping.obligation_id` must exist in obligations |
| `mapping.obligation_id` must be unique within the mappings list |
| `mapping.documents[].document_id` must exist in documents |
| `mapping.documents[].layer` must exist in catalog layers |
| `document.layer` must exist in catalog layers (unless `doc_type: reference`) |
| `control.topic` must exist in topics |
| `topic.related[]` must exist in topics |
| `regulation.parent`, `topic.parent`, `document.parent` must exist in the same file, must not be the item itself, and must not form a loop |
| `sequence` must be a non-negative integer |
| `relationships[].from_item` and `to_item` must each resolve to exactly one item, and to different items |
| `relationships[].type` must be one of the relationship types |
| A relationship (same items, same type) must not be listed twice |
| `catalog.layers` IDs must be unique |
| `catalog.applicability` IDs must be unique |
| `catalog.facets[].field` must be present |
| `catalog.relationship_types` IDs must be unique, and the list must not be empty if present |
| `relationships[].type` must be a relationship type ID |
| `relationships[].attributes` must be a map of text or number values |
| `attributes[]` entries need `name` and `value`; each `name` once per item |
| `valid_until`, `created_at`, `modified_at` must be real `YYYY-MM-DD` dates |
| `schema_version` must have the same major version as this TraceMap |

---

## Build warnings (non-fatal)

| Condition |
|---|
| Regulation has no `applies_if` |
| Document has no `url` and no `status_note` |
| Mapping has `status: deviations_noted` or `verification_pending` without `rationale` |
| Obligation has neither `common_control` nor `topics` |
| Document's `valid_until` has passed |
| A file has no `schema_version`, or a different minor version |

---

## Implicit assumptions

**Identifiers**
- IDs are freeform strings, case-sensitive, opaque to the engine. No format is validated.
- IDs are used in URL routing via `encodeURIComponent`. IDs containing `/` or `#` will break routing.
- IDs must be unique within their own file; cross-file collisions (same string as both a regulation ID and document ID) are permitted. In `relationships.yaml`, a shared ID needs a kind prefix (`topic:logging`).

**Ordering**
- Data is rendered in YAML file order in most views, unless `sequence` or `layouts.browse.default_sort` says otherwise. The timeline sorts by date and reviews by overdue status.
- Obligation `family` groups appear in first-encountered order within the obligations list for that regulation.
- Facet chip order and regulation group order follow the order of keys in `facets[].values`.

**Dates**
- All date fields must be `YYYY-MM-DD` strings. YAML auto-parses bare dates as `Date` objects; the build normalizes them back to strings. Quoting dates in YAML (`"2026-01-15"`) is safer.
- `date_text` on a key date overrides the formatted date for display but the raw `date` is still used for sorting and countdown math.
- `pending: true` on a key date with no `date` marks it as upcoming with no countdown.

**Types**
- Boolean fields (`restricted`, `official_wording`, `pending`, `in_table`) accept YAML's native `true`/`false`. Quoted strings (`"true"`) are truthy but not recommended.
- `review_interval_days` must be a YAML integer (unquoted). Quoted strings will be treated as falsy in the interval calculation.
- Whitespace-only strings on required fields (e.g., `title: "   "`) are treated as missing and produce a build error. Plain empty strings (`title: ""`) are also caught.

**Text rendering**
- `summary`, `context_note`, `plain_summary`, `applies_when` items, `does_not_apply` items, `topic.summary`, and `topic.applies_to_you` items are rendered through the glossary substitution engine.
- `title`, `name`, `control_id`, and `text` are plain text — glossary terms in those fields are never hyperlinked.
- `text` renders verbatim. No Markdown. YAML multi-line scalars using `|` preserve line breaks in the YAML source, but HTML collapses them to spaces unless the renderer adds `white-space: pre-wrap`.

**Other**
- `total_obligations` on a regulation is the only mechanism for signaling that the catalog does not yet list all in-scope requirements. Setting it lower than the actual obligation count has no effect.
- The `group_field` default (`"category"`) means that if no facet with `field: category` is defined, the regulation library groups by raw `category` values on each regulation, labeled without a header.
- `review_interval_days` on individual documents and mappings silently overrides the catalog default. This field is not mentioned in comments or error messages.

---

## Upgrading

When a release changes the data format, it raises `schema_version` and lists here what changed
and how to update your files. A different minor version still builds (with a warning); a
different major version is refused until the files are updated.

| Schema | Changes |
|---|---|
| 1.0 | First versioned format. Files without `schema_version` are read as 1.0; add `schema_version: "1.0"` to silence the warning. |
