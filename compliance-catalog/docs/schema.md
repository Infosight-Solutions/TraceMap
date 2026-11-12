# TraceMap Data Schema

Extracted from `build.js` (validation) and `src/app.js` (rendering). This is the authoritative
reference for anyone authoring YAML data files.

---

## Overview

Nine YAML files, six required and three optional, all in one data directory
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
| `applicability_prompt` | string | "Check everything that applies to you" | Label above the applicability checkboxes. |
| `applicability` | list | *(none)* | Defines the filter checkboxes on the home page. If empty, the applicability panel is hidden. |
| `group_field` | string | `"category"` | Which facet field to use for default grouping in the regulation library. Should match a `field` in `facets`. |
| `facets` | list | *(none)* | Custom filter chips shown in the regulation library. `source_type`, timing, and documentation status filters are always present and do not need to be listed here. |

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
| `reg_document` | document ID | Link to a reference document (e.g., full regulation text). Must exist in `documents.yaml`. Enables the "Open [reg_doc_label]" button. |
| `source_url` | URL string | Link to the external official source. Shown as "Official source" button (opens in new tab). |
| `accountable_role` | role ID | Must exist in `roles.yaml`. Shown as "Not sure? Ask the [role]." |
| `applies_when` | list of strings | Checklist in "Does this apply to my work?" Rendered through glossary substitution. |
| `does_not_apply` | list of strings | Exclusions panel alongside `applies_when`. |
| `context_note` | string | Shown instead of coverage stats when `obligation_type: context`. |
| `version_tracked` | string | Shown in amber callout alongside `version_note`. |
| `version_note` | string | Triggers an amber callout warning that the version assessed may differ from the current version. |
| `wording_note` | string | Fallback disclaimer for obligations under this regulation that have `text` but `official_wording: false`. Cascade: obligation → regulation → `catalog.summary_note` → hardcoded fallback. |
| `last_reviewed` | ISO date | Used in overdue calculation. Format validated. |
| `total_obligations` | non-negative integer | If set and greater than the number of obligations cataloged, the UI shows "N more requirements in scope but not yet added." They count as `not_assessed` in coverage stats. |
| `date_display` | string | Fallback text shown in the regulation library table when no future key date exists. |

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
| `documents` | list | Document evidence items. |

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
| `related` | no | list of topic IDs | Validated for referential integrity but not currently rendered in the UI. |

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

Display labels are overridable via `catalog.status_labels`. Color coding: verified = navy,
deviations noted = amber, verification pending = red, not assessed = gray dashed.

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
| `catalog.layers` IDs must be unique |
| `catalog.applicability` IDs must be unique |
| `catalog.facets[].field` must be present |

---

## Build warnings (non-fatal)

| Condition |
|---|
| Regulation has no `applies_if` |
| Document has no `url` and no `status_note` |
| Mapping has `status: deviations_noted` or `verification_pending` without `rationale` |
| Obligation has neither `common_control` nor `topics` |

---

## Implicit assumptions

**Identifiers**
- IDs are freeform strings, case-sensitive, opaque to the engine. No format is validated.
- IDs are used in URL routing via `encodeURIComponent`. IDs containing `/` or `#` will break routing.
- IDs must be unique within their own file; cross-file collisions (same string as both a regulation ID and document ID) are permitted.

**Ordering**
- Data is rendered in YAML file order in most views. The engine does not sort except in the timeline (by date) and reviews (by overdue status).
- Obligation `family` groups appear in first-encountered order within the obligations list for that regulation.
- Facet chip order and regulation group order follow the order of keys in `facets[].values`.

**Dates**
- All date fields must be `YYYY-MM-DD` strings. YAML auto-parses bare dates as `Date` objects; the build normalizes them back to strings. Quoting dates in YAML (`"2026-01-15"`) is safer.
- `date_text` on a key date overrides the formatted date for display but the raw `date` is still used for sorting and countdown math.
- `pending: true` on a key date with no `date` marks it as upcoming with no countdown.

**Types**
- Boolean fields (`restricted`, `official_wording`, `pending`, `in_table`) accept YAML's native `true`/`false`. Quoted strings (`"true"`) are truthy but not recommended.
- `review_interval_days` must be a YAML integer (unquoted). Quoted strings will be treated as falsy in the interval calculation.
- Empty strings on required fields (e.g., `title: ""`) pass validation — the check is `!value`, which is truthy for empty strings in JS.

**Text rendering**
- `summary`, `context_note`, `plain_summary`, `applies_when` items, `does_not_apply` items, `topic.summary`, and `topic.applies_to_you` items are rendered through the glossary substitution engine.
- `title`, `name`, `control_id`, and `text` are plain text — glossary terms in those fields are never hyperlinked.
- `text` renders verbatim. No Markdown. YAML multi-line scalars using `|` preserve line breaks in the YAML source, but HTML collapses them to spaces unless the renderer adds `white-space: pre-wrap`.

**Other**
- `topic.related` is validated but not rendered anywhere in the current UI.
- `total_obligations` on a regulation is the only mechanism for signaling that the catalog does not yet list all in-scope requirements. Setting it lower than the actual obligation count has no effect.
- The `group_field` default (`"category"`) means that if no facet with `field: category` is defined, the regulation library groups by raw `category` values on each regulation, labeled without a header.
- `review_interval_days` on individual documents and mappings silently overrides the catalog default. This field is not mentioned in comments or error messages.
