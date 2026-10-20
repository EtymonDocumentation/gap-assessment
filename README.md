# Gap Assessment Generator

> **Proof of concept. Not validated. Not for GMP use.**
> All names, sites, part numbers and document IDs in this repository are fictional.

The Gap Assessment Generator is the first module of a technology-transfer document suite for biologics sterile fill/finish. It compares a **source** validated process with a **target** site or line. A guided, adaptive interview collects the information. The tool then classifies every difference into one of eight categories, builds a gap register and drafts a gap assessment document.

Live site: `https://<your-github-user>.github.io/gap-assessment/` (after the deployment steps below).

---

## Contents

1. [What it does](#what-it-does)
2. [Ground rules the tool enforces](#ground-rules-the-tool-enforces)
3. [Quick start](#quick-start)
4. [Using the app](#using-the-app)
5. [The eight categories](#the-eight-categories)
6. [Architecture](#architecture)
7. [Data model](#data-model)
8. [Editing content (questions, rules, templates)](#editing-content)
9. [Testing](#testing)
10. [Deployment to GitHub Pages](#deployment-to-github-pages)
11. [Scope of this milestone and known limitations](#scope-of-this-milestone-and-known-limitations)
12. [Word templates](#word-templates)

---

## What it does

- **Scoping first.** Questions on modality, dosage form, presentation, drug substance state, containment, markets and transfer type decide which unit operations and questions apply.
- **Adaptive interview.** Choose between two entry orders:
  - **Paired:** source then target, question by question, with a live comparison on each target card.
  - **Sequential:** the whole source pass, then the target pass.

  Follow-up questions appear only when an earlier answer makes them relevant. For example, a changed filling pump principle brings up questions on fill accuracy, product impact and PPQ coverage.
- **"Why is this asked?"** on every question, a progress map with per-side counts, and section summaries that can be confirmed.
- **Side-by-side view** of source and target for every compared attribute, with a category marker that links to the register row.
- **Validation.** A validation plan (one row per implied activity, with the gaps that imply it, linked study status on both sides and a derived readiness) and an equipment qualification comparison. Filter by readiness, severity or text. Export either table to CSV.
- **Gap register.** Filter by category, severity, section, status or text. Sort the columns. Record an owner, a status, notes, or a severity change with a required justification. Export to CSV.
- **Document.** The gap assessment draft is available as a live preview, as Markdown, and as print-ready HTML (print or save as PDF from the browser).
- **Builder.** An editable view of every recorded value, source beside target, with status, sources, verification state and revision. Edit in place (Unknown, Not applicable with a reason, Same as source), filter by text, differences or open items, and add your own unit operations, parameters, equipment, materials and controls. They are stored in the project (`project.custom`, added in schema 1.1.0; older files migrate on load), asked and compared like built-in items, and marked Custom. Removing a custom definition keeps its values as inactive: listed in the Builder, excluded from comparison and the document.
- **Sources.** A register of every source: interview answers, user notes and document references, with who gave them, when, and which entries cite each one. Add or edit a document reference, attach a source to a value, or detach one. **Removing a source shows its consequences first** (every entry it supports, and which of them would be left with no source), then, once confirmed, those entries revert to *Not established*, the old value is kept only in the change log, and the gaps recompute. A source that nothing cites is listed as unused.
- **Verification.** Every entry in the document is either *Unverified* or *Verified by* a named person, with role and date. Verify one value in the Builder, or every verifiable value in a section at once (the dialog lists what will be verified and what will be skipped, and why). Only established and not-applicable values can be verified; Unknown and Not established values cannot. Changing a value, its status, its justification or its "same as source" link withdraws the verification and the entry shows *Verification withdrawn* with the reason. A verification can also be withdrawn on purpose, with a required reason.
- **Change log.** A page with every change in the project, newest first: who, when, what, and the value before and after. Filter by actor, action, section or text, and export the (filtered) log to CSV. Cells that start with a formula character are neutralised in the export.
- **Word document (M5).** The Document page also makes a real `.docx` file, in the browser, with the same content as the preview. You can use the built-in layout, or a company Word or PDF template from a template library kept in this browser (see [Word templates](#word-templates)). Every download is written to an export history in the project, with the template, its version and a SHA-256 hash.
- **Revisions and reviewer comments (M5).** Issue a numbered revision (Draft or Issued for review) with a summary and the name and role of whoever issued it. The document shows a revision history and says when the content has changed since the last revision. Reviewers' comments are anchored to a section (and, for some sections, to one gap), can be answered, resolved with a response, or reopened with a reason, and are listed in the document. A revision is **not** an approval or a signature.
- **One-click demo.** ARX-217 is a fictional liquid mAb in 2R vials moving from Site North (Line 2) to Site South (Line 4). It produces every one of the eight categories.

M1 covers four unit operations:
- pooling, compounding and dilution
- bioburden reduction and sterile filtration
- aseptic filling and stoppering
- capping and crimping

## Ground rules the tool enforces

| Rule | How |
|---|---|
| **No fabricated or default values** | The engine never fills an answer. Catalog data supplies options (pick lists, units), never values. |
| **Unknowns stay visible** | Every question offers "Unknown — to be confirmed". Unknowns become open information items and "Information required" rows. |
| **Every value has a source** | Each value is an *entry* linked to at least one source: the interview answer (responder, role, date) plus any document cited. Removing a source strips it from every entry. Entries left without a source revert to "not established", and the gaps that relied on them are recomputed. |
| **Verification is withdrawn when a value changes** | Verification stores a fingerprint of the value. If the value changes, including a source value that a "same as source" target follows, the entry shows "Verification withdrawn" until someone verifies it again. |
| **No filing decisions** | Rows that may affect registered information say only *"Requires regulatory affairs assessment."* The tool never states a filing category. |
| **Traceability** | Every register row cites the rule ID and rule version that produced it, plus the exact model entries it used. |

## Quick start

You need Node.js 20 or later (22 is used in CI).

```bash
git clone https://github.com/<your-github-user>/gap-assessment.git
cd gap-assessment
npm ci
npm run dev          # opens the app at http://localhost:5173
```

Other commands (run from the repository root):

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript check of all packages, content loader, tests and UI |
| `npm test` | Unit tests, content validation and the demo golden test (Vitest) |
| `npm run validate:content` | Content tests only |
| `npm run build` | Production build into `apps/web/dist` |
| `npm run preview` | Serve the production build locally |
| `npm run e2e` | Browser smoke and accessibility tests (Playwright + axe). Run `npm run build` and `npx playwright install chromium` first |
| `npm run ci` | Typecheck, tests and build, as in CI |

## Using the app

1. **Project page.** Load the demo, start a new project (title plus responder name and role), or import a project JSON file exported earlier.
2. **Interview.** Answer each question or choose one of:
   - *Unknown — to be confirmed*
   - *Same as source* (target side only)
   - *Not applicable…* (a justification is required)

   You can cite a supporting document on any answer. Use the progress map to jump between sections and **Review** to see a section summary.
3. **Side by side.** Check the comparison row by row. Select a value to change it in the interview, or a marker to open the register row.
4. **Gap register.** Work the differences: assign owners and statuses, and adjust severity with a justification. Equivalent rows are hidden by default; tick *Show equivalent* to see them.
5. **Sources, verification and change log.**
   - *Sources:* review who said or wrote what, and remove a source if it turns out to be wrong. The impact dialog tells you which values would become *Not established* before you confirm.
   - *Builder:* verify a value (or a whole section) by entering the verifier's name and role. If the verifier is the person who recorded the value, the tool asks for an explicit confirmation ("I am verifying my own entry") and the document marks the entry "same person as recorder". Withdraw a verification with a reason, or edit the value, which withdraws it automatically.
   - *Change log:* check what changed, by whom, and from which value to which.
6. **Document.** Download Markdown, HTML or Word, or print. Each entry shows its source and its verification status (Unverified, Verified by name and date, or Verification withdrawn). The document ends with a *Verification status* section and appendices: the source register, a summary of the change log, the revision history and the reviewer comments.
   - *Word document:* choose one of four options (see [Word templates](#word-templates)), pick a template if the option needs one, and read the checks under *Before you download*. A problem there switches the button off. Warnings from the export are shown after the download.
   - *Revisions:* **Issue revision** asks for Draft or Issued for review, a summary, and your name and role. The page says which revision is current and whether the content has changed since.
   - *Reviewer comments:* filter by Open, Resolved or All. **Add comment** asks for the section (and, for the differences, gap table, risk and validation plan sections, optionally one gap). Reply, resolve (a response is required) or reopen (a reason is required) from each comment. Your name and role are remembered until you close the tab.
   - *Export history:* every Markdown, HTML and Word download, newest first, with the revision and whether the content had changed since it was issued.
7. **Templates.** Add, rename, export, import and delete Word and PDF templates, read what the tool found in each one, and build the heading mapping for the "Map to their headings" option. This page also opens without a project.

Your project is saved automatically in this browser only (IndexedDB). Use **Export project (JSON)** to keep a copy or move it to another browser. Nothing is sent to a server.

## The eight categories

| Category | Meaning (in this tool) | Severity |
|---|---|---|
| Equivalent | Same value after unit conversion (exact match) | None |
| Within validated range | Target range lies inside the source validated range, or the PAR if no validated range is recorded | Set by the rule outcome |
| Outside validated range | Target range extends beyond the source validated range or PAR | Parameters: by class (CPP high, KPP medium, non-critical low) |
| Different principle | A different equipment or operating principle, or a different design | Set per rule |
| Scale change | Batch size, capacity or area changes | By the size of the change (batch size: medium below ×2, high at ×2 or more) |
| New requirement | Something present at the target that the source does not have, or evidence still to be generated | Set per rule |
| Removed element | Something present at the source that the target drops (for example a pre-use integrity test) | Set per rule |
| Information required | Either side is unknown or not yet established | Set per rule |

Severities come from the rules (`content/rules/rules.yaml`). Users can override a severity in the register, but only with a written justification; the original rule severity stays visible.

## Architecture

```
content (YAML, versioned)  ->  engine (pure TypeScript, no UI)  ->  UI (React)
        \___________________ process-model (types + Zod) ___________/
```

A static single-page app with no backend, organized as npm workspaces:

| Path | Package | Role |
|---|---|---|
| `packages/process-model` | `@gap/process-model` | Types and Zod schemas for the project, entries, sources, verification, units and conversion, and schema migrations. **Shared with the later TRD and MBR modules.** |
| `packages/engine` | `@gap/engine` | Content loading and cross-checks, condition evaluator, sequencer (paired and sequential), answer application, comparators and gap derivation, overlays, document model, CSV, demo builder. No UI code. |
| `packages/renderers` | `@gap/renderers` | Document model to Markdown and print HTML (all text is escaped). |
| `packages/docx` | `@gap/docx` | Word export and template handling: reading `.docx`, `.dotx`, `.docm` and PDF templates, the analysis report, the four export options, placeholder tags and the heading mapping. The web app loads it only when needed (a separate chunk), so the first page load stays small. |
| `content` | `@gap/content` | Versioned YAML: catalog, question bank, rules, document template and demo project. |
| `apps/web` | `@gap/web` | React 19 UI (Vite, Zustand, Radix Dialog, hash router). Contains no business logic. |

Technology:
- TypeScript (strict), Vite, React 19, Zustand and idb-keyval.
- Zod 4 for validation.
- Vitest for unit tests, and Playwright with axe-core for browser checks.

Every page has light and dark themes. The layout works from phone width up. Accessibility targets WCAG 2.2 AA:
- skip link
- focus management on page and question changes
- labelled controls
- keyboard-reachable scroll regions
- colour never used alone

**Planned AI extension points, none of them built yet.** These need no model changes:
- `IngestionAdapter` (in `packages/engine/src/adapters.ts`) would return *proposed* entries from a document. A person must accept each one before it enters the model.
- The source types `ai_extraction` and `ai_suggestion` are reserved in the schema.

## Data model

- **Entry.** Every value is an entry with these fields:
  - a `path`, for example `target.uo.aseptic_filling.equip.filler.operatingPrinciple`
  - a `status`: `established`, `unknown`, `not_applicable` or `not_established`
  - an optional `value` and an optional `sameAsSource` flag
  - `sourceIds`
  - `recordedBy` / `recordedAt` and a `revision` number
  - an optional `verification` (who verified it, their role, when, the fingerprint of the value, status and sources at that time, and whether it was a self-verification). A verification stays on the entry when the value changes, but no longer matches its fingerprint, so it is reported as withdrawn rather than silently dropped.
- **Source.** The source register records each source's type, label, responder, date, file hash or document reference. Allowed types are interview answer, user entry, imported file, catalog rule and document reference; the AI types are reserved.
- **Project.**
  - schema version and the content versions used
  - settings
  - scope, and source and target process models
  - sources and the answer log
  - gap overlays and an append-only change log
  - `document`: the revisions, the reviewer comments (each with its replies, resolution and reopening) and the export history (schema 1.3.0; older files migrate on load)
- **Gaps are derived, never stored.** They are recomputed from the model on every change. Each gap has a stable key (`ruleId:path[#subKey]`). User decisions (owner, status, severity override, notes) are stored as *overlays* on that key, so they survive recomputation.
- **Closed branches.** If an answer change makes a question irrelevant, its earlier answers are kept but marked inactive. They are excluded from comparison and from the document, and listed on the Model page.

Unit conversion uses the units table in `packages/process-model/src/units.ts` (volume, mass, time, temperature, pressure, flow, speed, area and others). Values in different units, for example 1.2 mL and 1200 µL, compare as equal.

## Editing content

All domain content lives in `content/` as YAML. Each file carries a semantic version, which is recorded in every project and printed in the document. Content is validated against Zod schemas when it loads and in the test suite, so a bad edit fails `npm test` and CI before it can be deployed.

| File | Contents |
|---|---|
| `content/catalog/catalog.yaml` | Pick-list options, unit operations, activities, category labels and descriptions |
| `content/questions/*.yaml` | Sections, then questions per section (`00` scoping and site, `20` compounding, `30` sterile filtration, `40` aseptic filling, `60` capping) |
| `content/rules/rules.yaml` | Comparison rules, evaluated in order; the first rule whose pattern matches a path wins (`*` matches one path segment) |
| `content/templates/gap-assessment.yaml` | Document title pattern, banner, fixed text and approval roles |
| `content/demo/arx-217.yaml` | The demo, written as interview answers and replayed through the engine |

### Question fields

- `id`, `section`, `prompt`, `label`, `why` (required)
- optional: `help`, `parent`, `triggerNote`
- `sides`: `shared` (scoping), `paired`, `source` or `target`
- `binds`: the model path the answer writes to
- `input.type`: one of `choice`, `multi_choice`, `yes_no`, `text`, `quantity`, `range` or `parameter` (classification, set point, NOR, PAR, validated range and range basis)
- `showWhen`: a condition (see below)

"Unknown — to be confirmed" is added to every question by the engine. Content cannot remove it.

### Conditions (`showWhen`)

A small, typed expression language. It is safe to edit because nothing is evaluated as code.

`all`, `any`, `not`, `eq`, `in`, `includes`, `answered`, `isUnknown`, `isTrue`, `uoPresent`, `changed` (source and target differ), `increased`, `decreased`, `ratioAbove`, `gt`, `gte`, `lt`, `lte` (comparisons are unit-aware).

```yaml
showWhen: { changed: uo.aseptic_filling.equip.filler.operatingPrinciple }
showWhen: { all: [ { uoPresent: compounding }, { increased: uo.compounding.param.batch_size } ] }
```

### Rules

Each rule has:
- `id`, `version` and `title`
- `match` (a path pattern)
- a `comparator`: one of `range`, `scale`, `upper_limit`, `lower_limit`, `enum`, `text`, `presence`, `set`, `coverage`, `evidence` or `informational`
- `severity` (optionally `severityBy` parameter class), and optional `config`
- `outcomes` per category: the rationale text, the implied activities, and `regulatory: true` where the row should carry "Requires regulatory affairs assessment."

The comparator decides the category. The rule content supplies the wording, activities and severity.

**YAML tip:** in `{ ... }` flow mappings, put any text that contains a comma in quotes. Otherwise YAML splits it into extra keys. A test checks for this.

## Testing

- **Unit tests** (`npm test`) cover:
  - every comparator and category, unit conversion, one-sided ranges and unknown handling
  - the condition evaluator
  - the sequencer: paired and sequential order, hidden branches, inactive answers
  - the source cascade and verification withdrawal
  - content schema validity
  - a golden test that rebuilds the demo and checks its register and document
- **Browser smoke tests** (`npm run e2e`):
  - The suite runs against the production build at desktop (1366 px), tablet (820 px) and phone (390 px) widths.
  - It loads the demo and checks all eight categories, then exercises register filtering, sorting, search, details and CSV export.
  - In the interview it checks the progress-map jump, "Why is this asked?", paired versus sequential order, section summaries and branch closing.
  - It runs a new project through scoping, Unknown and Not applicable validation.
  - It follows side-by-side markers and checks the document downloads.
  - It lists the sources, removes one after reading its impact, and checks that the value becomes Not established and the register changes.
  - It verifies a value in the Builder, checks the document, changes the value so the verification is withdrawn, and checks the change log and its CSV.
  - It runs an axe scan with no serious or critical violations on every page in both themes, and checks that no page scrolls sideways.
  - The M5 tests (`apps/web/e2e/m5.spec.ts`) add the sample templates and check each analysis (removed macros, the old `.doc` advice, a PDF listed for mapping only). They rename, export, delete and re-import a template file (a changed file is refused). They build and save a heading mapping and check it is still there after a reload. They download a Word file in all four options, and with a PDF template, and check that it is a zip of a sensible size. They check the export history, issue a revision and see the "content has changed" notice, and add, reply to, resolve and reopen a comment. They also run axe, with dialogs open, on the Templates page, the mapping editor and the Document page in both themes and at 1280, 768 and 390 px.

## Deployment to GitHub Pages

The workflow `.github/workflows/deploy.yml` runs on every push and pull request:
1. typecheck
2. unit tests and content validation
3. build
4. Playwright smoke and accessibility tests

It deploys to GitHub Pages **only from `main` and only if every step passes**.

One-time setup from a clean clone:

1. Create an empty public repository named `gap-assessment` on GitHub. Do not add a README or licence.
2. Push the code:
   ```bash
   git remote add origin https://github.com/<your-github-user>/gap-assessment.git
   git push -u origin main
   ```
3. On GitHub, go to the repository's **Settings → Pages → Build and deployment**. Set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. Re-run the "Check and deploy" workflow if the first run started before Pages was enabled.
5. When it finishes, the site is at `https://<your-github-user>.github.io/gap-assessment/`.

The build uses relative asset paths (`base: "./"`) and a hash router, so it works under any sub-path without server rewrites. Netlify or any other static host also works: publish the `apps/web/dist` folder.

## Scope of this milestone and known limitations

- **In M1:**
  - scoping, site, and four unit operations
  - all eight categories, the register, side-by-side view and document (Markdown and HTML)
  - the demo, unit tests, smoke tests and CI/CD
- **In M2:**
  - six more unit operations: drug substance receipt and thaw (frozen DS only), stoppering and lyophilization (lyophilized products only), visual inspection, labeling and packaging, storage and shipping
  - custom unit operations and custom parameters, equipment, materials and controls
  - the editable Builder
- **In M3:**
  - validation study inputs (PPQ, APS, filter validation, hold times, cleaning, CCI, extractables and leachables, shipping)
  - a validation plan that links each gap to the validation activity it implies, with a readiness derived from the study statuses
  - equipment qualification comparison (source and target status, target qualified range against the required process value)
  - the Validation page, and the matching document sections
- **In M4:**
  - the Sources page, with source removal that shows its impact and cascades (entries left without a source revert to Not established, the value is kept only in the change log, the gaps recompute)
  - attaching and detaching sources, and editing document references
  - verification: single and per-section, withdrawal with a reason, automatic withdrawal when a value changes, four-eyes confirmation for self-verification
  - the Change log page with filters and CSV export
  - verification status for every entry in the document, a *Verification status* section, appendix A (source register) and appendix B (change log summary), and verification columns in the gap register CSV
  - project schema 1.2.0 (older files migrate on load)
- **In M5:**
  - project schema 1.3.0 with `project.document`: revisions, reviewer comments and the export history (older files migrate on load)
  - Word (`.docx`) export with four options, and a template library kept in this browser (Word and PDF templates, analysis report, export and import of template files)
  - the heading mapping editor and placeholder tags, with a downloadable starter template and tag reference
  - the Templates page, and the Word document, revisions, comments and export history panels on the Document page
  - revision history and reviewer comments in the document, and new change log actions for them
- **Not yet:**
  - TRD seed export and packaging of the model (M6)
- **Responder and verifier identity is free text.** There is no login and no electronic signature, so answers and verifications are not attributable in a GMP sense. The document says so.
- **Four-eyes is a prompt, not a lock.** If the verifier's name matches the person who recorded the value (compared without regard to case or spacing), the tool asks for explicit confirmation and flags the verification as a self-verification. Because names are free text, a different spelling of the same person, or another person's name, is not detected.
- **Risk ranking is severity only** (rule severity plus justified overrides). There is no likelihood scoring.
- **Equivalence is exact** after unit conversion. There is no tolerance band yet.
- **Data stays in the browser.** Clearing site data deletes the project unless it was exported. The same is true of the template library, which is stored separately from projects.
- **Word layout is generated without Word.** The `.docx` file is built by this tool, not by Microsoft Word. Check the layout, page breaks, headers and tables in Word before you use the document.
- **PDF templates give only headings.** From a PDF the tool can read the outline of headings, not the styles, fonts or page layout. A PDF template can only be used with "Map to their headings".
- **Placeholder tags are simple.** A tag is replaced by a value or a block of content. Tags do not support expressions, calculations or conditions.
- **A revision is not an approval or a signature.** It numbers a state of the document and records who issued it. Approval stays outside the tool.
- **Comment names are free text.** There is no login, so the author of a comment and the person who resolved it are not attributable in a GMP sense.


## Word templates

The Document page can make a Word file in four ways. Pick the one that fits:

| Option | What you get | Needs a template |
|---|---|---|
| **Built-in default** | This tool's own layout. | No |
| **Their look** | The content in the built-in order, with the fonts, colours, margins, headers and footers of a company Word template. | A Word template |
| **Map to their headings** | The content placed under the headings of a company template (Word or PDF), following a mapping you set up on the Templates page. | A Word or PDF template, plus a saved mapping |
| **Placeholder tags** | A template that contains tags such as `{program}`. The tool fills them in. | A Word template with tags |

**Add a template.** Open **Templates**, choose a file (`.docx`, `.dotx`, `.docm` or `.pdf`), then give it a name and a version. The version is recorded with every export. The tool recognises `.doc`, `.rtf` and `.odt` files, but does not read them: it tells you how to save them as `.docx` first. Each template shows a report of what the tool found (headings, styles, tags, layout), what it removed, and which of the four options it can be used for.

**Macros are removed.** A `.docm` template is accepted, but its macros are stripped and listed in the report. The copy kept in the library, and every Word file the tool makes, has none.

**The library lives only in this browser.** Templates are not part of the project file and are not sent anywhere. Clearing site data deletes them. Use **Export template file** (a `.gap-template.json` file) to keep a copy or move it to another browser, and **Import a template file** to bring it back. The tool checks the file's checksum on import and refuses a file that has been changed.

**Placeholder tags.** Use **Download starter tag template** for a ready-made Word file. Use **Download tag reference (Markdown)**, or the table on the Templates page, for the list of tags.

**Heading mapping.** To use "Map to their headings", open the template's mapping from the Templates page. This needs an open project, because the mapping lists that project's content. Assign the tool's content to the template's headings with the Add, Up, Down and Remove buttons, or use **Suggest a mapping** and adjust it. For each heading choose whether the template's own text is kept or replaced. Content you do not map is added at the end, or left out if you tick "I understand this content will be left out of the Word document". The report beside the editor updates as you work, and the mapping is saved with the template.

**Fictional samples.** **Add the fictional sample templates** adds four Brightwater Biologics (fictional) templates: a Word template, a tag template, a macro-enabled template and a PDF outline. They are there for trying the feature. Samples already in the library are skipped.

---

*Proof of concept. Not validated. Not for GMP use. Fictional data only.*
