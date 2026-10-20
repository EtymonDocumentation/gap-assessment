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

---

## What it does

- **Scoping first.** Questions on modality, dosage form, presentation, drug substance state, containment, markets and transfer type decide which unit operations and questions apply.
- **Adaptive interview.** Choose between two entry orders:
  - **Paired:** source then target, question by question, with a live comparison on each target card.
  - **Sequential:** the whole source pass, then the target pass.

  Follow-up questions appear only when an earlier answer makes them relevant. For example, a changed filling pump principle brings up questions on fill accuracy, product impact and PPQ coverage.
- **"Why is this asked?"** on every question, a progress map with per-side counts, and section summaries that can be confirmed.
- **Side-by-side view** of source and target for every compared attribute, with a category marker that links to the register row.
- **Gap register.** Filter by category, severity, section, status or text. Sort the columns. Record an owner, a status, notes, or a severity change with a required justification. Export to CSV.
- **Document.** The gap assessment draft is available as a live preview, as Markdown, and as print-ready HTML (print or save as PDF from the browser).
- **Builder.** An editable view of every recorded value, source beside target, with status, sources, verification state and revision. Edit in place (Unknown, Not applicable with a reason, Same as source), filter by text, differences or open items, and add your own unit operations, parameters, equipment, materials and controls. They are stored in the project (`project.custom`, schema 1.1.0; older files migrate on load), asked and compared like built-in items, and marked Custom. Removing a custom definition keeps its values as inactive: listed in the Builder, excluded from comparison and the document.
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
| **Verification is withdrawn when a value changes** | Verification stores a fingerprint of the value. If the value changes, including a source value that a "same as source" target follows, the entry shows as unverified again. |
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
5. **Document.** Download Markdown or HTML, or print. Every entry in the document is shown as "Unverified" in this milestone.

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
  - an optional `verification` (who verified it, when, and the fingerprint of the value at that time)
- **Source.** The source register records each source's type, label, responder, date, file hash or document reference. Allowed types are interview answer, user entry, imported file, catalog rule and document reference; the AI types are reserved.
- **Project.**
  - schema version and the content versions used
  - settings
  - scope, and source and target process models
  - sources and the answer log
  - gap overlays and an append-only change log
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
  - It runs an axe scan with no serious or critical violations on every page in both themes, and checks that no page scrolls sideways.

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
- **Not yet:**
  - full validation-study depth and equipment qualification comparison (M3)
  - a source-register UI (M4; the cascade engine and its tests are already in place)
  - DOCX export (M5)
  - TRD seed export and packaging of the model (M6)
- **Responder identity is free text.** There is no login, so answers are not attributable in a GMP sense. The document says so.
- **Risk ranking is severity only** (rule severity plus justified overrides). There is no likelihood scoring.
- **Equivalence is exact** after unit conversion. There is no tolerance band yet.
- **Data stays in the browser.** Clearing site data deletes the project unless it was exported.

---

*Proof of concept. Not validated. Not for GMP use. Fictional data only.*
