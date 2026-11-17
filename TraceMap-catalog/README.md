# TraceMap

A static HTML compliance catalog generator.

TraceMap takes YAML files describing regulations, their requirements, your documents, and how the documents address each requirement, and produces one self-contained HTML file. The file runs in any browser from local disk, with no server, login, or network access. Document links open your authoritative sources in whatever system holds them (SharePoint, ProjectWise, a wiki, or any other URL).

## Purpose

Compliance evidence is easier to use when it can be browsed. Engineers, managers, auditors, and executives need answers to questions like "does this regulation apply to us", "what does it require in plain terms", and "which document covers this requirement, and is it verified" without reading dozens of policies. TraceMap presents that as a navigable catalog, written for people who are not compliance specialists.

## What readers get

- **Home page** with applicability checkboxes ("We collect personal data about people in the EU", …). Checking them narrows every view to the regulations that apply.
- **Topics**: plain-language areas such as access, encryption, or incident response, each listing the requirements from every regulation that touch it.
- **Regulation library** with filters for type, timing, documentation status, and your own facets (for example category or jurisdiction), plus a page per regulation with its requirements, coverage, and key dates.
- **Traceability** from each requirement to the documents that address it, grouped by your document layers (for example policy, standard, procedure, evidence), with a documentation status and rationale.
- **Crosswalk** of shared controls that satisfy requirements in several regulations at once.
- **Timeline** of effective dates, deadlines, and internal milestones, with countdowns to upcoming ones.
- **Documents** register, a **Reviews** page listing overdue reviews, a **Glossary** whose terms get hover definitions throughout, full-text **Search**, and CSV downloads.

## How it works

1. You keep your compliance data in YAML files in `data/` (or edit it in a spreadsheet, see [Working in a spreadsheet](#working-in-a-spreadsheet)).
2. `npm run build` checks every field and cross-reference, then bundles the data with the app into one HTML file in `dist/`.
3. You distribute that file however you distribute other documents: a file share, your document management system, or an email attachment.
4. Readers open it in any modern browser. Everything runs locally.

## Getting started

Requires Node.js 22 or later.

```bash
git clone https://github.com/kubiksa/TraceMap.git
cd TraceMap/TraceMap-catalog
npm install
npm run build:example
```

Open `dist/tracemap-example.html` to see the example catalog for Northfield Systems, a fictional US public company with EU customers. It covers SOC 2, ISO/IEC 27001:2022, the NIST Cybersecurity Framework 2.0, GDPR, and the SEC cybersecurity disclosure rule. See `data-example/README.md` for what the example demonstrates.

To build your own catalog, copy the example files to `data/` and edit them:

```bash
cp data-example/*.yaml data/
npm run build
```

The result is `dist/tracemap.html`. The YAML files in `data/` are gitignored so private compliance data never enters the repository.

If the build finds a problem, it lists each error (for example a mapping that points to a document that doesn't exist) and writes nothing. Warnings, such as a document with no link, are printed but don't stop the build.

## Data files

Ten YAML files, six required and four optional. `docs/schema.md` is the full field-by-field reference, and `data-example/` has a working example of every file.

| File | Required | What it holds |
|---|---|---|
| `catalog.yaml` | yes | Catalog-wide settings: titles and wording, your document layers, applicability questions, filter facets, status labels, default review interval |
| `regulations.yaml` | yes | Regulations, standards, and frameworks, with their key dates |
| `obligations.yaml` | yes | Individual requirements, each belonging to one regulation |
| `mappings.yaml` | yes | For each requirement: documentation status, rationale, and the documents that address it |
| `documents.yaml` | yes | Your documents: ID, title, layer, link, revision, review dates |
| `topics.yaml` | yes | Plain-language topics shown on the home page |
| `controls.yaml` | no | Shared controls that satisfy requirements across regulations |
| `roles.yaml` | no | Accountable roles (use roles, not people's names) |
| `glossary.yaml` | no | Terms that get hover definitions in summaries |
| `relationships.yaml` | no | Links between any two items (upstream, downstream, requires, references, related) |

**Layers** are defined in `catalog.yaml`, so you can name them to match how your organization organizes documents. The example uses policy, standard, procedure, and evidence. Each document belongs to one layer, and a mapping can override it for a single requirement.

**Documentation status** has four values: `verified`, `deviations_noted`, `verification_pending`, and `not_assessed`. You can rename how they appear in `catalog.yaml`. Requirements with no mapping count as `not_assessed`.

## Working in a spreadsheet

If you'd rather edit in Excel or Google Sheets than in YAML, TraceMap can write your data to an XLSX workbook and read it back. The workbook has one tab per kind of record, dropdowns for fixed values, and a hover note on every column header explaining the field. The columns for your catalog's facets and layers come from your `catalog.yaml`.

**Start from a blank template** (new users):

```bash
npm run generate-template                # uses data/catalog.yaml, writes dist/tracemap-template.xlsx
```

Row 2 of each tab is a gray example row. Fill in your records from row 3.

**See a filled-in example** (demo):

```bash
npm run generate-template:fixture        # writes data-example/tracemap-example.xlsx
```

**Export your existing YAML** (round-trip editing, or sharing with someone who doesn't edit YAML):

```bash
npm run export-xlsx                                   # data/ -> dist/tracemap-export.xlsx
npm run export-xlsx -- --populate <data-dir>          # another folder; its catalog.yaml is used
```

The YAML is checked first with the same validation `npm run build` uses. If there are errors, no workbook is written and `import-report.md` in the data folder lists them.

**Import the workbook back to YAML:**

```bash
npm run import -- --file <workbook.xlsx>              # writes YAML into data/
npm run import -- --file <workbook.xlsx> --out <dir> --catalog <dir>/catalog.yaml
```

The import is checked the same way. If anything is wrong, no YAML is written and `import-report.md` lists each problem by tab, row, and column as you see them in Excel. `catalog.yaml` is never part of the workbook; edit it directly.

Comments in your YAML files are not kept through a round trip, since the workbook has nowhere to store them.

## URL formats

Any URL scheme is supported. Common examples:

- ProjectWise Explorer (native): `pw://server-name/Documents/path/filename.docx`
- ProjectWise Web (browser): `https://projectwise.example.com/pwwebparts/DocumentView.aspx?docId=...`
- SharePoint: `https://tenant.sharepoint.com/sites/site/Documents/file.docx`
- Any HTTPS URL to a document management system, wiki, or web resource

TraceMap never opens these URLs. It renders them as links, and the browser hands each one to whatever handler is registered for that protocol. Authentication is between the reader's existing session and the destination system. Mark a document `restricted: true` to show readers that most of them won't be able to open it (this is a label, not access control).

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Build `dist/tracemap.html` from `data/` |
| `npm run build:example` | Build `dist/tracemap-example.html` from `data-example/` |
| `npm run generate-template` | Blank XLSX template from `data/catalog.yaml` |
| `npm run generate-template:example` | Blank XLSX template from the example catalog |
| `npm run generate-template:fixture` | Rebuild `data-example/tracemap-example.xlsx` from the example YAML |
| `npm run export-xlsx` | Export `data/` (or `-- --populate <dir>`) to a filled-in workbook |
| `npm run import -- --file <xlsx>` | Import a workbook into `data/` (or `--out <dir>`) |
| `npm test` | Run the test suite |

## Project layout

```
build.js                     YAML -> HTML build
lib/schema.js                Column definitions, enums, sheet order, template version
lib/validate.js              Validation shared by the build, the exporter, and the importer
lib/report.js                import-report.md formatting
scripts/generate-template.js Blank template and YAML -> XLSX export (--populate)
scripts/import-xlsx.js       XLSX -> YAML import
src/                         The app: HTML template, styles, and code embedded in the build
data-example/                Public example data and the example workbook
data/                        Your private data (gitignored)
docs/schema.md               Field-by-field data reference
test/                        Tests (node --test)
```

## Extending beyond compliance

The tool is a generic navigable catalog: sources, the requirements in them, the documents that answer each requirement, and how well. Other uses include:

- Engineering deliverables for a specific project
- Regulatory reference libraries
- Standard operating procedure catalogs
- Any collection of documents where readers need coverage views and cross-references

## License

MIT. See LICENSE.
