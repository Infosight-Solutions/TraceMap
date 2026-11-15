# TraceMap

A static HTML compliance catalog generator for regulated environments.

Takes structured YAML data describing regulations, obligations, documents, and their mappings, and produces a single self-contained HTML file. The HTML runs entirely in the reader's browser from local disk with no network dependency, and links out to a document management system (ProjectWise, SharePoint, or any URL-addressable system) for authoritative source documents.

## Purpose

Compliance evidence is easier to consume when it is navigable rather than paginated. Auditors, executives, and cross-functional stakeholders need to answer questions like "which document satisfies this obligation" and "what is the current verification status" without reading through dozens of governance and design documents. This catalog surfaces that information as a browsable coverage view with drill-down traceability from regulation to implementation across a four-layer compliance model (requirement, design, specification, verification).

## How it works

1. You maintain five YAML files describing your compliance landscape: regulations, obligations, documents, mappings, and roles.
2. You run `npm run build`, which bundles the data with an HTML template and produces a single self-contained HTML file in `dist/`.
3. You distribute the HTML file however you distribute other documents (file share, document management system, email attachment).
4. Readers open the HTML file in any modern browser. The catalog runs entirely from local disk. Clicking a document link opens the authoritative source in whatever system your URLs point to.

## Getting started

```bash
git clone https://github.com/<your-username>/tracemap.git
cd tracemap
npm install
npm run build:example
```

Open `dist/tracemap-example.html` in any browser to see a working example built from NIST SP 800-171 Rev 3 controls.

To build against your own data, copy the example files to `data/` and edit them:

```bash
cp data-example/*.yaml data/
npm run build
```

The generated file lands in `dist/tracemap.html`. The `data/` directory is gitignored by default so private compliance data never enters the repository.

## Data schema

Five YAML files describe your compliance landscape. See `data-example/` for a working example of all five.

- **regulations.yaml**: catalog of regulations, standards, or frameworks
- **obligations.yaml**: specific controls or requirements, each linked to a regulation
- **documents.yaml**: registry of documents, each with an ID, title, layer, and URL
- **mappings.yaml**: obligation-to-documents mappings with verification status
- **roles.yaml**: accountable roles under your governance model

Each document declares which of the four compliance layers it belongs to (requirement, design, specification, verification), and each obligation-to-document mapping can override that if needed. Mapping status uses four values: `verified`, `deviations_noted`, `verification_pending`, `not_assessed`.

## URL formats

Any URL scheme is supported. Common examples:

- ProjectWise Explorer (native): `pw://server-name/Documents/path/filename.docx`
- ProjectWise Web (browser): `https://projectwise.example.com/pwwebparts/DocumentView.aspx?docId=...`
- SharePoint: `https://tenant.sharepoint.com/sites/site/Documents/file.docx`
- Any HTTPS URL to a document management system, wiki, or web resource

The tool never opens these URLs. It renders them as clickable links; the browser routes each URL to whatever handler is registered for that protocol. Authentication is between the reader's existing session and the destination system.

## Extending beyond compliance

The tool is a generic navigable catalog. Any set of documents with metadata, categorization, and links can be represented in the same five-table structure. Use cases beyond compliance include:

- Engineering deliverables for a specific project
- Regulatory reference libraries
- Standard operating procedure catalogs
- Any collection of documents where readers need coverage views and cross-references

## License

MIT. See LICENSE.
