# Gap Assessment Generator

> **Proof of concept. Not validated. Not for GMP use.**
> All names, sites, part numbers and document IDs in this repository are fictional.

The Gap Assessment Generator is the first module of a technology-transfer document suite for biologics sterile fill/finish. It compares a process at the **sending unit (SU)** with the same process at the **receiving unit (RU)**: a site or line. (In stored data and in the file format the two sides keep the names `source` and `target`; only the words people read changed.) Each side has a program stage (commercial, clinical or development), which sets the wording and the validation expectations. A guided, adaptive interview collects the information. The tool then classifies every difference into one of eight categories, builds a gap register and drafts a gap assessment document.

Live site: `https://<your-github-user>.github.io/gap-assessment/` (after the deployment steps below).

---

## Contents

1. [What it does](#what-it-does)
2. [Ground rules the tool enforces](#ground-rules-the-tool-enforces)
3. [Quick start](#quick-start)
4. [Using the app](#using-the-app)
5. [The eight categories](#the-eight-categories)
   - [Program stage and wording](#program-stage-and-wording)
6. [Architecture](#architecture)
7. [Data model](#data-model)
8. [Editing content (questions, rules, templates)](#editing-content)
9. [Testing](#testing)
10. [Deployment to GitHub Pages](#deployment-to-github-pages)
11. [Scope of this milestone and known limitations](#scope-of-this-milestone-and-known-limitations)
12. [Word templates](#word-templates)
13. [Guidance library](#guidance-library)
14. [Pictures and credits](#pictures-and-credits)
15. [Running on your own machine (server mode)](#running-on-your-own-machine-server-mode)

---

## What it does

- **Scoping first.** Questions on modality, dosage form, presentation, drug substance state, containment, markets and transfer type decide which unit operations and questions apply.
- **Adaptive interview.** Choose between two entry orders:
  - **Paired:** SU, then RU, question by question.
  - **Sequential (SU-first):** the whole SU pass, then the RU pass.

  Either way, a question that is asked for both units is **one card with two panels**: the sending unit (SU) and the receiving unit (RU), each a labelled group (a `fieldset` with a `legend` such as "Receiving unit (RU) — Site South (fictional), Line 4 · planned state", using the site and line from scoping and the stage-aware state wording). The panels sit side by side on wide screens and stack, SU first, on narrow ones. Each panel has its own answer, TBD, Not applicable and document citations, and the RU panel has Same as SU and shows the SU answer. One button saves what was entered ("Save SU and RU", or "Save SU" / "Save RU" when only one side has input); a refused answer is reported next to its own panel. In the SU-first order the RU panel is still there and can be answered early. A question that really has one side (RU-only, SU-only, scoping) shows a banner, "You are answering for: Receiving unit (RU) — …", with an SU / RU marker, and its heading starts "SU:" or "RU:". A live comparison appears on the card once RU is shown.

  Follow-up questions appear only when an earlier answer makes them relevant. For example, a changed filling pump principle brings up questions on fill accuracy, product impact and PPQ coverage.
- **"Why is this asked?"** on every question, a progress map with per-side counts, and section summaries that can be confirmed.
- **Side-by-side view** of SU and RU for every compared attribute, with a category marker that links to the register row.
- **Validation.** A validation plan (one row per implied activity, with the gaps that imply it, linked study status on both sides and a derived readiness) and an equipment qualification comparison. Filter by readiness, severity or text. Export either table to CSV.
- **Gap register.** Filter by category, severity, section, status or text. Sort the columns. Record an owner, a status, notes, or a severity change with a required justification. Export to CSV.
- **Gap notes.** Each difference can carry a free-text note. Add or edit it in the Notes column of the side-by-side view (or in the register). It is stored on the gap overlay (schema 1.5.0), written to the change log, included in the document's Notes column and in the CSV, and it counts as a change to the document content.
- **Document.** The gap assessment draft is available as a live preview, as Markdown, as print-ready HTML (print or save as PDF from the browser) and as Word. The main gap table is kept lean (ID, Attribute, SU, RU, Gap, Severity, Actions, Notes). The rule, owner, status, regulatory wording and verification of each gap are in the **Gap details** appendix. Where a document backs a value, the document is shown as its source ("ID (title)") and the interview is named only when no document backs the value; the Source register appendix keeps every source.
- **Scope: choose what the assessment covers (M5.7).** A **Scope** step comes right after Project setup (and is in the navigation, so you can come back to it). It asks "What does this assessment cover?" and shows two blocks. *Process steps* lists the unit operations in stage groups (Drug substance in, Formulation, Filtration, Filling and closing, Inspection and packaging, Shipping out); each group expands and has a tick that shows "some" when only part of it is in scope. Untick a step the process does not have and it leaves the interview, the progress map, the side-by-side view, the gap register, the validation plan and the document, on both sides. Values already entered are kept as inactive entries and come back when the step is ticked again; the tool tells you how many answers will be kept before you confirm. A step the answers already rule out (for example lyophilization for a liquid product) is greyed and cannot be ticked: it says "Not applicable: <answer>" and links to the question. The reason for leaving a step out is optional (the document then says "No reason recorded"); who and when are always recorded, and every change is written to the change log. *Document sections* lists the optional sections to leave out of the preview and of every download (Summary of differences by unit operation, Validation plan, Equipment qualification comparison, Risk ranking, Verification status, References, Approval, and the appendices Gap details, Source register, Change log summary). Purpose, Scope, the SU and RU summaries, the Detailed gap table and Open information items are shown ticked and disabled ("Always included"). The same two blocks sit in a compact panel at the top of the Document page (folded to a one-line summary with **Change**); both views edit one stored choice (`project.stepScope`, `project.document.omittedSections`), so they never disagree. The ticks change the preview and every download (Markdown, HTML, Word, print); numbering and appendix letters close up, and the Scope section lists what was left out, with who and when. Nothing is ticked off by default: everything is included until someone decides otherwise.
- **Builder.** An editable view of every recorded value, SU beside RU, with status, sources, verification state and revision. Edit in place (TBD, Not applicable with a reason, Same as SU), filter by text, differences or open items, and add your own unit operations, parameters, equipment, materials and controls. They are stored in the project (`project.custom`, added in schema 1.1.0; older files migrate on load), asked and compared like built-in items, and marked Custom. Removing a custom definition keeps its values as inactive: listed in the Builder, excluded from comparison and the document.
- **Sources.** A register of every source: interview answers, user notes and document references, with who gave them, when, and which entries cite each one. Add or edit a document reference, attach a source to a value, or detach one. **Removing a source shows its consequences first** (every entry it supports, and which of them would be left with no source), then, once confirmed, those entries revert to *Not established*, the old value is kept only in the change log, and the gaps recompute. A source that nothing cites is listed as unused.
- **Verification.** Every entry in the document is either *Unverified* or *Verified by* a named person, with role and date. Verify one value in the Builder, or every verifiable value in a section at once (the dialog lists what will be verified and what will be skipped, and why). Only established and not-applicable values can be verified; TBD and Not established values cannot. Changing a value, its status, its justification or its "Same as SU" link withdraws the verification and the entry shows *Verification withdrawn* with the reason. A verification can also be withdrawn on purpose, with a required reason.
- **Change log.** A page with every change in the project, newest first: who, when, what, and the value before and after. Filter by actor, action, section or text, and export the (filtered) log to CSV. Cells that start with a formula character are neutralised in the export.
- **Word document (M5).** The Document page also makes a real `.docx` file, in the browser, with the same content as the preview. You can use the built-in layout, or a company Word or PDF template from a template library kept in this browser (see [Word templates](#word-templates)). Every download is written to an export history in the project, with the template, its version and a SHA-256 hash.
- **Review workflow removed (M5.7).** The tool no longer has revisions, Draft / Issued for review, reviewer comments, the Revision history section or the Reviewer comments appendix: formal review, versioning and approval belong in the company's document system. Approval stays as an optional section, and the export history, the change log and the verification status stay. A project saved by an earlier version still opens: its revisions and comments are moved, untouched, into `project.document.archivedReview` (one change-log record says so), are not shown anywhere, and are written back unchanged.
- **One-click demo.** ARX-217 is a fictional liquid mAb in 2R vials moving from Site North (Line 2) to Site South (Line 4). It produces every one of the eight categories.

M1 covers these unit operations (the list has grown since M1, see the later milestones):
- pooling, compounding and dilution
- bioburden reduction (BBR) filtration
- sterile filtration
- aseptic filling and stoppering
- capping and crimping

### Dilution, buffer preparation, BBR filtration and PUPSIT (schema 1.6.0)

- **Dilution switch.** A shared yes/no scoping question, "Does the program involve dilution or formulation with a buffer or diluent?" (`scope.dilution`). It works like the drug substance state question. **No** hides the whole Buffer preparation section and the dilution-only questions in the compounding section (diluent, diluent volume, target concentration). They do not count in progress. **Unanswered** behaves the same as No for visibility, and the question stays an open item. Nothing is assumed. If it is switched to No later, earlier answers are kept but marked inactive.
- **Buffer preparation** (`content/questions/15-buffer-prep.yaml`, unit `buffer_prep`, order 15, shown only when dilution = yes). Presence at each site, then the supply route per site: prepared on site, received frozen and thawed on site, or received ready to use (RTU). Each route has its own questions. Route-specific questions are asked only on the side that uses that route, so a route difference is one high gap (R-BUFFER-ROUTE) and the route-specific questions are not compared across routes. Every route also asks whether the buffer is BBR filtered; the BBR detail questions show only when the answer is yes. Hold time and hold study, cleaning, equipment qualification and RU procedures are asked as well.
- **BBR filtration** (`content/questions/25-bbr-filtration.yaml`, unit `bbr_filtration`, order 25) is separate from **Sterile filtration** (order 30). The old "BBR filter used" question (`uo.sterile_filtration.mat.prefilter`) is now the presence question of the BBR unit. The bioburden limit before the sterilizing filter stays in sterile filtration, because it is tied to the bacterial retention challenge. The BBR unit has its own inlet limit.
- **PUPSIT** has its own block in sterile filtration (`filt.pupsit` and follow-ups). PUPSIT is no longer an option of the integrity tests question. A new `transition` comparator (see Rules) lets the outcome depend on the SU and RU answer pair.
- **Plunger stopper position** (prefilled syringes and cartridges only). Questions `fill.stopper_*` and `fill.headspace` are in `content/questions/40-aseptic-filling.yaml`, in the Aseptic filling section: placement method, stopper position range (mm, set point with NOR and PAR), headspace or air bubble limit (mm), in-process position checks (including 100% in-line camera against sampling), the acceptance criterion, and an RU follow-up on position capability and device fit. They show only when the presentation is a prefilled syringe or a cartridge. While the presentation is unanswered they stay hidden and the presentation question remains an open item.

### Drafting: Answering from, Link values, locations and TBD (schema 1.7.0)

- **Answering from bar.** A sticky bar at the top of the Interview page. Choose a register document (or add one inline: document ID, title, version), say whether it covers SU, RU or Both, and optionally give a section and page. While it is on, every answer you save **with a value** is cited to that document on the matching side. A paired card cites each side by the bar's choice; "Both" also covers shared scoping answers. TBD without a best guess and "Same as SU" are never cited (a citation says the document supports a value). After each save the bar says "Cited to <doc> §x p.y" with an **Undo**: undo removes exactly the citations that save added and restores the previous document list, is change-logged, and does nothing for an entry that was answered again since. The choice is saved in the project, survives a reload, and one click on **Clear** turns it off.
- **Link values.** On the Sources page, **Link values...** on a document opens a dialog that lists only entries that hold a value. Filter by side, section, text, or "Not yet cited to any document"; tick entries, optionally enter a section and page, then **Cite selected**. Each entry gets its own change-log record, the counts are shown, entries without a value are never cited, and citing again is harmless (already cited entries are left as they were).
- **Citation location.** A citation can carry an optional section and page. It is shown in the Interview, the Sources page and Register, the Markdown/HTML document, the Word source-register appendix, the Word in-table source text ("DOC-ID §4.2 p.12") and the CSV. The CSV column that lists the documents is named "Documents cited".
- **TBD (to be determined).** Every question has one not-known answer, **TBD (to be determined)**. One click or tap saves it with no details; **Add details** opens an optional best guess, owner, due date and note. A TBD **without** a best guess is an open information item (information required). A TBD **with** a best guess is compared as if the guess were established, and the gap is labelled **"Provisional - based on a TBD value"** on Compare, the gap table, the validation plan activities, the document (Markdown, HTML, Word) and in a "Provisional" CSV column. A TBD cannot be verified. The separate "Unknown (to be confirmed)" answer was retired in schema 1.9.0 (see the section below) and no question offers a not-known choice of its own. Every TBD change is change-logged. On a parameter question, TBD is chosen per field.
- **Tracking TBDs.** The Home page shows "N TBD (M overdue)" and links to a list (side, question, best guess, owner, due date, note). The Interview has a "Show only TBD" filter. The document lists the TBD values among the open items and has a "TBD values: N" line in Document control (Word too). "Overdue" is computed on screen from today's date and is deliberately left out of the generated document so that it does not change from day to day.
- **Downloading with TBD values.** Any download (Markdown, HTML, Word or print) while TBD values are open first shows a warning that names the count. You can go back or download anyway; the export history records the count (`tbdCount`).
- **Migration.** Files from 1.6.0 and older load unchanged: all new fields are optional, no old answer is rewritten.

### One not-known answer: TBD (schema 1.9.0)

- **Why.** "Unknown (to be confirmed)" and "TBD" meant the same thing to a reader: a value that is still to be found out. A TBD with no details already behaved exactly like Unknown (an open information item, no gap invented, cannot be verified), so keeping both only gave two lists for one state. TBD is the single not-known answer, and nothing is lost: the note field covers why a value is not known.
- **As fast as before.** The **TBD (to be determined)** button on a question (each side, each field of a parameter, scoping questions, the Builder and the drafting bar) saves a TBD with no details in one click or tap. **Add details** (a disclosure that works with keyboard and screen readers) opens the optional best guess, owner, due date and note.
- **Questions.** No question offers a not-known option of its own (the retired "not decided" PPQ strategy option is gone). A content test scans every question, option and option set and fails on such wording.
- **Migration.** Every entry that was Unknown becomes a TBD with empty details. Same-as-SU, sources and history are kept and nothing is invented (no owner, no due date, no guess). Each conversion gets a change-log record by "System (file update)": "Unknown converted to TBD (schema 1.9.0, no change in meaning)". Older change-log records are history and still read "Unknown". It applies to every load path: browser storage, imported files and the laptop server (the app converts a stored project when it opens it and saves the converted copy back; the server also converts any file it is sent). New writes of the retired status are rejected. Content is 1.6.0, templates 1.4.0.
- **One difference.** A "Same as SU" answer on a source that is TBD is now listed once, on the SU entry, in the open items; it used to be listed again for the RU entry.

### Process coverage and tailoring (schema 1.8.0)

- **Two new always-present unit operations.** *Drug substance shipping to the fill site* (`ds_shipping_inbound`, frozen and liquid drug substance; receipt and thaw stay frozen-only) sits before receipt and thaw. *Bulk packaging* (`bulk_packaging`) sits between visual inspection and labeling and packaging. Neither has a scoping switch: the presence question is asked on every project. Both have catalog items, paired SU/RU questions, rules and validation activities (`content/questions/05-ds-shipping-inbound.yaml`, `75-bulk-packaging.yaml`).
- **Shipping away from the fill site** stays in *Storage and shipping from the fill site*. Shipper, lane, qualification, monitoring and transit time exist once there (bulk packaging asks none of them). New questions there ask what is shipped (unlabelled bulk or labelled product) and where to (labelling site or distribution).
- **Where labelling is done.** A site question per side: at this site, at another site, or TBD. No default. "Another site" hides the labeling and packaging questions for that side, asks which site, and the document scope states that it is out of scope and where it happens. TBD or unanswered keeps the questions visible and stays an open item, so nothing is dropped silently.
- **Tailor this section.** Each unit-operation section groups its questions into topics (declared per unit operation in the catalog with `topics`, and `topic` on each question; otherwise derived from parameters, equipment, materials, controls, studies and documents). **Tailor this section** (on the card and the section review) switches topics off with an optional reason (without one the document says "No reason recorded"). Every topic is included until you switch it off. A switched-off topic is hidden and leaves compare, the gap register, open items and the validation plan. Values already recorded are kept as inactive entries and come back when the topic is switched on again. Both changes are change-logged and every excluded topic is listed with its reason in the document scope (Markdown, HTML and Word). The presence question and follow-up questions have no topic of their own.
- **Migration.** Files from 1.7.0 load with nothing switched off and the labelling location unanswered. Catalog, questions and rules are 1.5.0.

## Ground rules the tool enforces

| Rule | How |
|---|---|
| **No fabricated or default values** | The engine never fills an answer. Catalog data supplies options (pick lists, units), never values. |
| **Not-known answers stay visible** | Every question offers one not-known answer, "TBD (to be determined)", saved in one click. A TBD becomes an open information item and "Information required" rows. |
| **Every value has a source** | Each value is an *entry* linked to at least one source: the interview answer (responder, role, date) plus any document cited. Removing a source strips it from every entry. Entries left without a source revert to "not established", and the gaps that relied on them are recomputed. |
| **Verification is withdrawn when a value changes** | Verification stores a fingerprint of the value. If the value changes, including an SU value that a "Same as SU" RU value follows, the entry shows "Verification withdrawn" until someone verifies it again. |
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
| `npm run build:server` | Server-mode web build (`apps/web/dist-server`) plus the server and admin tool (`apps/server/dist`). See [server mode](#running-on-your-own-machine-server-mode) |
| `npm run serve -- --data <dir>` | Start the server (after `build:server` and `admin init`) |
| `npm run e2e` | Browser smoke and accessibility tests (Playwright + axe). Run `npm run build` and `npx playwright install chromium` first |
| `npm run e2e:server` | Server-mode browser tests against the real server (Playwright + axe). Runs `npm run build:server` first; needs `npx playwright install chromium` |
| `npm run ci` | Typecheck, tests and build, as in CI |

## Using the app

1. **Project page.** Load the demo, start a new project (title plus responder name and role), or import a project JSON file exported earlier.
2. **Interview.** For each question, answer the SU and the RU panel together (or one of them: **Save SU and RU**, **Save SU**, **Save RU**), or choose one of these on a panel:
   - *TBD (to be determined)* (one click; optional details behind **Add details**)
   - *Same as SU* (RU panel only)
   - *Not applicable…* (a justification is required)

   TBD, Same as SU and Not applicable record that side straight away; the card stays open when the other side still needs an answer. A link to either side of a question (progress map, Compare, Register, a section summary) opens the same card with focus in that side's panel.

   You can cite supporting documents on any answer that has a value (open **Cite supporting documents**): tick documents already in the register and/or add a new reference ID with a title and document type. A cited document then appears as the source of the value instead of the interview. Use the progress map to jump between sections and **Review** to see a section summary.

   **Moving on.** **Save and continue** (and the save buttons on a paired card) always go to the next question in order, answered or not, so you can click through a section and re-check its answers. The section summary appears after the last question of a section, or whenever you choose **Review** in the progress map. *Skip for now* and links such as `#/interview?q=...` work as before.

   **Clearing answers.** A side that holds an answer (a value, TBD, Not applicable or Same as SU) has a **Clear SU answer** or **Clear RU answer** button (**Clear answer** on a one-sided question), and a paired card with both sides answered also has **Clear both**. The section summary has **Clear section answers**. Every clear asks for confirmation first and names the question or section, the side and how many entries it clears. Cleared entries go back to *Not established*, one change-log entry each keeps the old value (the only place it is kept), the source link of each entry is removed the same way a source removal does it (the source records stay in the register), and any verification is withdrawn because the value no longer matches. Gaps, Side by side and the register recompute. Clearing a scoping answer does not delete the values of the sections it then hides; they are kept as inactive values, like any other hidden question.
3. **Side by side.** Check the comparison row by row. Select a value to change it in the interview, or a marker to open the register row.
4. **Gap register.** Work the differences: assign owners and statuses, and adjust severity with a justification. Equivalent rows are hidden by default; tick *Show equivalent* to see them.
5. **Sources, verification and change log.**
   - *Sources:* review who said or wrote what, and remove a source if it turns out to be wrong. The impact dialog tells you which values would become *Not established* before you confirm.
   - *Builder:* verify a value (or a whole section) by entering the verifier's name and role. If the verifier is the person who recorded the value, the tool asks for an explicit confirmation ("I am verifying my own entry") and the document marks the entry "same person as recorder". Withdraw a verification with a reason, or edit the value, which withdraws it automatically.
   - *Change log:* check what changed, by whom, and from which value to which.
6. **Document.** Download Markdown, HTML or Word, or print. Each entry shows its source (documents first) and its verification status (Unverified, Verified by name and date, or Verification withdrawn). The document ends with a *Verification status* section and appendices: the gap details (A), the source register (B) and a summary of the change log (C). Appendix letters close up when you leave sections out in the Scope step or in the panel at the top of this page.
   - *Word document:* choose one of four options (see [Word templates](#word-templates)), pick a template if the option needs one, and read the checks under *Before you download*. A problem there switches the button off. Warnings from the export are shown after the download.
   - *Export history:* every Markdown, HTML and Word download, newest first, with the template, a fingerprint, the TBD count, the sections left out and whether the answers changed since the previous download.
7. **Templates.** Add, rename, export, import and delete Word and PDF templates, read what the tool found in each one, and build the heading mapping for the "Map to their headings" option. This page also opens without a project.

Your project is saved automatically in this browser only (IndexedDB). Use **Export project (JSON)** to keep a copy or move it to another browser. Nothing is sent to a server.

## The eight categories

| Category | Meaning (in this tool) | Severity |
|---|---|---|
| Equivalent | Same value after unit conversion (exact match) | None |
| Within validated range (shown as "Within SU range" when the SU is not validated) | RU range lies inside the SU validated range, or the PAR if no validated range is recorded | Set by the rule outcome |
| Outside validated range (shown as "Outside SU range" when the SU is not validated) | RU range extends beyond the SU validated range or PAR | Parameters: by class (CPP high, KPP medium, non-critical low) |
| Different principle | A different equipment or operating principle, or a different design | Set per rule |
| Scale change | Batch size, capacity or area changes | By the size of the change (batch size: medium below ×2, high at ×2 or more) |
| New requirement | Something present at the RU that the SU does not have, or evidence still to be generated | Set per rule |
| Removed element | Something present at the SU that the RU drops (for example a pre-use integrity test) | Set per rule |
| Information required | Either side is TBD or not yet established | Set per rule |

### Program stage and wording

Each side answers one paired site question, **Program stage at this site** (`site.stage`, stored as `site.programStage`). There is no default: an unanswered stage reads `[not established]` everywhere and is listed as an open information item.

| Stage | Label |
|---|---|
| `commercial` | Commercial (process validated) |
| `clinical` | Clinical (GMP, not process validated) |
| `development` | Development / engineering runs |

The SU and the RU stages are independent, so all nine SU-to-RU pairs work (commercial to clinical included).

- **Wording rule.** "Validated" wording is used only when the SU stage is established as commercial. A clinical SU, a development SU and an unanswered SU stage all use the non-validated wording: "Within SU range" and "Outside SU range", "SU program summary (current state)", "Demonstrated range (actually run)". The category keys (`within_validated_range`, `outside_validated_range`) never change, so stored data, the CSV keys and the rules stay the same. Only labels and texts change.
- **How content adapts.** Content texts hold a variant as `{{validated wording|other wording}}`. The first variant is used for a commercial SU, the second otherwise (it may be empty). All stage logic is in `packages/engine/src/stage.ts`. Keep markers out of question prompts and labels.
- **The stage is not compared as a gap.** A difference in stage has no meaning in the eight categories, so rule R-SITE-INFO treats it as informational. Its effect is on the wording, on the cover and the document control lines, and on the **Stage basis** at the top of the validation plan.
- **Validation plan.** An SU that is not commercial has no SU PPQ or process validation evidence to leverage. A commercial RU is expected to need PPQ (typically a full PPQ when the SU is not commercial). A clinical RU is held to phase-appropriate expectations; a development RU covers engineering runs that are not for GMP supply. Everything is phrased as an expectation to confirm with QA. The tool never decides a filing category.

Severities come from the rules (`content/rules/rules.yaml`). Users can override a severity in the register, but only with a written justification; the original rule severity stays visible.

## Architecture

```
content (YAML, versioned)  ->  engine (pure TypeScript, no UI)  ->  UI (React)
        \___________________ process-model (types + Zod) ___________/
```

A static single-page app with no backend, organized as npm workspaces:

| Path | Package | Role |
|---|---|---|
| `packages/process-model` | `@gap/process-model` | Types and Zod schemas for the project, entries, sources, verification, units and conversion, and schema migrations, plus the unit-operation catalog and the TRD seed format. Version 1.0.0, see its README. **Shared with the later TRD and MBR modules.** |
| `packages/engine` | `@gap/engine` | Content loading and cross-checks, condition evaluator, sequencer (paired and sequential), answer application, comparators and gap derivation, overlays, document model, CSV, demo builder. No UI code. |
| `packages/renderers` | `@gap/renderers` | Document model to Markdown and print HTML (all text is escaped). |
| `packages/docx` | `@gap/docx` | Word export and template handling: reading `.docx`, `.dotx`, `.docm` and PDF templates, the analysis report, the four export options, placeholder tags and the heading mapping. The web app loads it only when needed (a separate chunk), so the first page load stays small. |
| `content` | `@gap/content` | Versioned YAML: catalog, question bank, rules, document template and demo project. |
| `apps/web` | `@gap/web` | React 19 UI (Vite, Zustand, Radix Dialog, hash router). Contains no business logic. |
| `apps/server` | `@gap/server` | Optional small HTTP server for [server mode](#running-on-your-own-machine-server-mode): accounts by invite, projects, template library and uploaded files stored on your own machine. Node built-ins and Zod only. The public Pages build never includes or calls it. |

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

**Planned, not built yet.** Product-owner decisions recorded for later:
- Final assembly and packaging into the final pack or medical device.
- Final labelling at another site (beyond stating where it happens).

**Planned AI extension points, none of them built yet.** These need no model changes:
- `IngestionAdapter` (in `packages/engine/src/adapters.ts`) would return *proposed* entries from a document. A person must accept each one before it enters the model.
- The source types `ai_extraction` and `ai_suggestion` are reserved in the schema.

## Data model

- **Entry.** Every value is an entry with these fields:
  - a `path`, for example `target.uo.aseptic_filling.equip.filler.operatingPrinciple`
  - a `status`: `established`, `tbd`, `not_applicable` or `not_established`
  - an optional `value` and an optional `sameAsSource` flag
  - `sourceIds`
  - `recordedBy` / `recordedAt` and a `revision` number
  - an optional `verification` (who verified it, their role, when, the fingerprint of the value, status and sources at that time, and whether it was a self-verification). A verification stays on the entry when the value changes, but no longer matches its fingerprint, so it is reported as withdrawn rather than silently dropped.
- **Source.** The source register records each source's type, label, responder, date, file hash or document reference. Allowed types are interview answer, user entry, imported file, catalog rule and document reference; the AI types are reserved.
- **Project.**
  - schema version and the content versions used
  - settings
  - scope, and the SU and RU process models (stored as `source` and `target`)
  - sources and the answer log
  - gap overlays and an append-only change log
  - `document`: the export history, the optional sections the document leaves out (`omittedSections`, schema 1.5.0) and `archivedReview` (old revisions and comments, kept untouched, schema 1.10.0); older files migrate on load
  - `stepScope`: the process steps left out of the assessment, each with `uo`, an optional `reason`, `by` and `at` (schema 1.10.0; older files start with nothing left out)
  - `sampling`: PPQ sampling plans (`plans`), each with batches, points, a change log that keeps old values and company-table snapshots (schema 1.11.0, process model 1.1.0; older files start with no plans)
- **Gaps are derived, never stored.** They are recomputed from the model on every change. Each gap has a stable key (`ruleId:path[#subKey]`). User decisions (owner, status, severity override, notes) are stored as *overlays* on that key, so they survive recomputation.
- **Closed branches.** If an answer change makes a question irrelevant, its earlier answers are kept but marked inactive. They are excluded from comparison and from the document, and listed on the Model page.

Unit conversion uses the units table in `packages/process-model/src/units.ts` (volume, mass, time, temperature, pressure, flow, speed, area and others). Values in different units, for example 1.2 mL and 1200 µL, compare as equal.

## The TRD module (milestone 9)

The **TRD** page (module `trd`, after TRD seed in the menu) turns the seed into a technology transfer document that belongs to the team. Like the sampling and risk modules it is checked on the server: an account without the module has no menu entry, sees "This account does not include the TRD module" on the page, and a project that holds a TRD is refused with `403 module-not-included`.

- **Three ways to start:** from this project, from a TRD seed file (JSON, with the reader's own error when the file is not a seed or is another major version), or blank. Nothing is chosen for you. The seed page also offers "Start a TRD from this project".
- **Overrides.** Every value can be overridden. The project value stays beside the entered one (`Overridden (project: X)`), the reason is optional (without one the TRD reads "No reason recorded"), and every override and every removal is a change-log event with the old and new value.
- **Update from the project, or from a newer seed file.** A project that changed since the last update gives a notice, never a block. The review lists the differences; rows are accepted one by one or with "Accept all not overridden". A value you overrode is never replaced unless you choose "Take the project value" for that row; "Keep my value" leaves it.
- **Set point, NOR and PAR** are entered by the team for parameters and in-process controls, each with sources chosen from the source register (a document can be added on the spot), section and page, and a free-text basis. They are not taken from the sampling plan. The check only reports: NOR outside PAR, set point outside a range, minimum above maximum, "cannot compare: units differ (x vs y)", a missing citation as an open item, provisional values labelled. It never blocks saving and never decides anything.
- **One source picker, folded steps, clear wording.** Every place that cites sources (set point, NOR, PAR) uses one picker: cited sources are a list with Remove and section/page; "Add a source from the register" opens a search box over the register with documents first and interview records in a closed group, and a new document can be added on the spot. Each process step is a folded disclosure with a count line (parameters, overridden, PAR/NOR problems, not established, TBD); a filter opens the steps with matches, an edited step stays open, and the open state is kept for the session. A parameter card shows "From the project" values apart from "TRD limits (set point / NOR / PAR with sources)", with an optional "Copy project value" button; the change notice appears only when a row actually differs.
- **Process sections only**, in process order, with a description written by the team. Source document types (PPQ summary report, Process development report, Characterization study report, Internal technical report) and basis wordings are suggestions, not lists to choose from.
- **Output.** Word and HTML through the same pipeline and Templates library as the other documents; downloads are recorded in the export history (`trd-docx`, `trd-html`) with the versions behind them, and a download with open items asks first. The banner is in every output and the only regulatory wording is "Requires regulatory affairs assessment".
- Versions: project schema 1.15.0, process model 1.5.0, TRD format 1.0.0. The demo project carries a fictional TRD.

## Suite foundation: the process model and the TRD seed

The gap assessment is the first tool of a planned suite (gap assessment, technology transfer document, master batch record). Milestone 6 prepares the shared part.

- **`@gap/process-model` 1.0.0** holds the catalog of unit operations, the schemas and the TRD seed format. Its only runtime dependency is `zod`, a test checks that, and another test snapshots the public API so a change to it needs a version decision. See `packages/process-model/README.md` and `CHANGELOG.md`. It is still `private`; nothing is published.
- **TRD seed.** The page "TRD seed" (after Document in the menu) exports the planned process of the receiving unit (RU) as JSON in the format `gap-assessment.trd-seed` 1.0.0. It carries only RU values as values. SU values appear only as a reference, for traceability. Nothing is filled in by default: a value nobody recorded is "not established", and a TBD best guess is marked provisional. Process steps and topics left out in the Scope step are not exported. The tool never names a filing category.
- **Draft outline.** The same page offers a draft outline of a technology transfer document, in Word and HTML, built from the seed alone. It uses the built-in style only. It is not an approved TRD. The Traceability section is on by default and can be switched off.
- **Export history.** All three downloads are recorded with the process model, catalog and seed format versions and a fingerprint of the seed.
- The seed builder (`buildTrdSeed`) and the outline builder (`buildTrdOutline`) are in `@gap/engine`; the schema and the reader (`parseTrdSeed`) are in `@gap/process-model`.

## Editing content

All domain content lives in `content/` as YAML. Each file carries a semantic version, which is recorded in every project and printed in the document. Content is validated against Zod schemas when it loads and in the test suite, so a bad edit fails `npm test` and CI before it can be deployed.

| File | Contents |
|---|---|
| `packages/process-model/catalog/catalog.yaml` | Pick-list options, stage groups, unit operations with their items and topics, field labels (the shared process model catalog) |
| `content/catalog/gap-overlay.yaml` | Validation activities and comparison category labels and descriptions (only the gap assessment needs them) |
| `content/questions/*.yaml` | Sections, then questions per section (`00` scoping and site, `15` buffer preparation, `20` compounding, `25` BBR filtration, `30` sterile filtration including the PUPSIT block, `40` aseptic filling including the plunger stopper position questions, `60` capping) |
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

The TBD answer is added to every question by the engine. Content cannot remove it, and a content test fails if any question offers a not-known choice of its own (an option such as "unknown", "not yet known" or "to be confirmed"): TBD is the only path.

### Conditions (`showWhen`)

A small, typed expression language. It is safe to edit because nothing is evaluated as code.

`all`, `any`, `not`, `eq`, `in`, `includes`, `answered`, `isTbd`, `isTrue`, `uoPresent`, `changed` (SU and RU differ), `increased`, `decreased`, `ratioAbove`, `gt`, `gte`, `lt`, `lte` (comparisons are unit-aware).

A reference that starts with `uo.` or `site.` (no `source.` or `target.` in front) means the **same side as the question being shown**. One paired question can then depend on its own side's answer: `eq: [uo.buffer_prep.mat.buffer.supplyRoute, prepared_on_site]` is the SU route on the SU card and the RU route on the RU card. On a shared question it cannot be determined, so it is false. Write `source.` or `target.` to name a side explicitly.

```yaml
showWhen: { changed: uo.aseptic_filling.equip.filler.operatingPrinciple }
showWhen: { all: [ { uoPresent: compounding }, { increased: uo.compounding.param.batch_size } ] }
```

### Rules

Each rule has:
- `id`, `version` and `title`
- `match` (a path pattern)
- a `comparator`: one of `range`, `scale`, `upper_limit`, `lower_limit`, `enum`, `text`, `presence`, `set`, `coverage`, `evidence`, `transition` or `informational`
- `severity` (optionally `severityBy` parameter class), and optional `config`
- `outcomes` per category: the rationale text, the implied activities, and `regulatory: true` where the row should carry "Requires regulatory affairs assessment."

The comparator decides the category. The rule content supplies the wording, activities and severity.

The `transition` comparator (used by the PUPSIT rule) reads an ordered list in `config.transitions`. Each entry has optional `from` and `to` lists of answers, a `category`, a `detail`, and optional `why`, `activities`, `severity` and `regulatory`. The first entry that matches the SU and RU answers wins. If none matches, equal answers are equivalent and different answers use `config.differentAs` (default: different operating principle). Every answer named in a transition must be an option of each question the rule is first-match for; a test and the content check enforce this.

**YAML tip:** in `{ ... }` flow mappings, put any text that contains a comma in quotes. Otherwise YAML splits it into extra keys. A test checks for this.

## Testing

- **Unit tests** (`npm test`) cover:
  - every comparator and category, unit conversion, one-sided ranges and TBD handling
  - the condition evaluator
  - the sequencer: paired and sequential order, hidden branches, inactive answers
  - the source cascade and verification withdrawal
  - content schema validity
  - a golden test that rebuilds the demo and checks its register and document
- **Browser smoke tests** (`npm run e2e`):
  - The suite runs against the production build at desktop (1366 px), tablet (820 px) and phone (390 px) widths.
  - It loads the demo and checks all eight categories, then exercises register filtering, sorting, search, details and CSV export.
  - In the interview it checks the progress-map jump, "Why is this asked?", SU and RU on one card in both entry orders (`sides.spec.ts` covers the panels, saving one or both sides, deep links, banners, phone layout and accessibility), section summaries and branch closing. `clear-nav.spec.ts` covers clearing (one side, both sides, a section, cancel, the change log) and the Save and continue order.
  - It runs a new project through scoping, TBD and Not applicable validation.
  - It follows side-by-side markers and checks the document downloads.
  - It lists the sources, removes one after reading its impact, and checks that the value becomes Not established and the register changes.
  - It verifies a value in the Builder, checks the document, changes the value so the verification is withdrawn, and checks the change log and its CSV.
  - It runs an axe scan with no serious or critical violations on every page in both themes, and checks that no page scrolls sideways.
  - The M5 tests (`apps/web/e2e/m5.spec.ts`) add the sample templates and check each analysis (removed macros, the old `.doc` advice, a PDF listed for mapping only). They rename, export, delete and re-import a template file (a changed file is refused). They build and save a heading mapping and check it is still there after a reload. They download a Word file in all four options, and with a PDF template, and check that it is a zip of a sensible size. They check the export history and that no revision or comment controls exist. They also run axe, with dialogs open, on the Templates page, the mapping editor and the Document page in both themes and at 1280, 768 and 390 px.

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
  - scoping, site, and the first unit operations (since split and extended, see the section on dilution, buffer preparation, BBR filtration and PUPSIT)
  - all eight categories, the register, side-by-side view and document (Markdown and HTML)
  - the demo, unit tests, smoke tests and CI/CD
- **In M2:**
  - six more unit operations: drug substance receipt and thaw (frozen DS only), stoppering and lyophilization (lyophilized products only), visual inspection, labeling and packaging, storage and shipping
  - custom unit operations and custom parameters, equipment, materials and controls
  - the editable Builder
- **In M3:**
  - validation study inputs (PPQ, APS, filter validation, hold times, cleaning, CCI, extractables and leachables, shipping)
  - a validation plan that links each gap to the validation activity it implies, with a readiness derived from the study statuses
  - equipment qualification comparison (SU and RU status, RU qualified range against the required process value)
  - the Validation page, and the matching document sections
- **In M4:**
  - the Sources page, with source removal that shows its impact and cascades (entries left without a source revert to Not established, the value is kept only in the change log, the gaps recompute)
  - attaching and detaching sources, and editing document references
  - verification: single and per-section, withdrawal with a reason, automatic withdrawal when a value changes, four-eyes confirmation for self-verification
  - the Change log page with filters and CSV export
  - verification status for every entry in the document, a *Verification status* section, the source register and change log summary appendices (lettered A and B at the time; now B and C after the Gap details appendix), and verification columns in the gap register CSV
  - project schema 1.2.0 (older files migrate on load)
- **Project schema 1.9.0** (one not-known answer, TBD; see the section above). Schema 1.8.0 (process coverage and tailoring, see the section above). Schema 1.7.0 (TBD, citation locations, the Answering from bar; older files migrate on load, see the drafting section above). Schema 1.6.0 (dilution, buffer preparation, BBR filtration, PUPSIT, plunger stopper position):
  - older files migrate on load. The old BBR filter answer (`uo.sterile_filtration.mat.prefilter.*`) moves to `uo.bbr_filtration.*` with its sources, verification, recorder and revision; gap overlays, reviewer comment anchors, change log paths and the stored answer ids follow
  - an old integrity answer that included PUPSIT becomes PUPSIT = performed (same sources, recorder and date) and PUPSIT leaves the tests; an old answer without PUPSIT leaves the PUPSIT question unanswered, so it shows as an open item. No justification is ever invented
  - `scope.dilution` starts unanswered; the Buffer preparation unit and the plunger stopper position questions start empty
  - catalog, question bank and rule set are 1.4.0
- **In M5.7:**
  - the Scope step and the Document-top scope panel (stage groups in the catalog, process steps left out on both sides, optional document sections in one place), project schema 1.10.0 with a migration, catalog 1.7.0
  - the review workflow (revisions, comments, Revision history, Reviewer comments) removed; old data archived untouched
  - TBD warning on every download; optional reason when tailoring a topic
  - a step whose scoping question is still unanswered is never called "not applicable": it stays in scope and says "Depends on an unanswered question: ..." with a link
  - old Word templates that still contain `{revision}`, `{#revisions}` or `{#comments}` keep working: those tags are accepted and print nothing
  - Scoping summary (and other shared answers) shown once for both SU and RU, with no RU or Comparison column
  - a plainer Progress map ("SU: 1 of 1 answered") that wraps instead of clipping at 390 px and at large text; page text now follows the reader's text-size setting
- **In M5.2:**
  - SU / RU wording everywhere people read it (web pages, interview prompts, content, the document, Word, CSV headers and this README). Stored data is unchanged: `source` / `target` paths, the `Side` type, rule ids, category keys and schema field names stay
  - a lean gap table plus a Gap details appendix; notes per gap (schema 1.5.0, change-logged, in the fingerprint and the CSV)
  - documents first: a value backed by a document shows the document ("ID (title)"), the interview only when no document backs it; the Interview cites documents per answer
  - optional document sections ("Sections to include") and a slightly more compact layout
- **In M5.1:**
  - the program stage per side (project schema 1.4.0; older projects get no stage value and show `[not established]` until it is answered), and stage-aware wording and validation expectations
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


## Word templates

The Document page can make a Word file in four ways. Pick the one that fits:

| Option | What you get | Needs a template |
|---|---|---|
| **Built-in default** | This tool's own layout: a cover page, a table of contents, a document-control page, deep-blue headings and tables with shaded header rows. | No |
| **Their look** | The content in the built-in order, with the fonts, colours, margins, headers and footers of a company Word template. | A Word template |
| **Map to their headings** | The content placed under the headings of a company template (Word or PDF), following a mapping you set up on the Templates page. | A Word or PDF template, plus a saved mapping |
| **Placeholder tags** | A template that contains tags such as `{program}`. The tool fills them in. | A Word template with tags |

**Built-in layout details.** The cover page carries the "Proof of concept. Not validated. Not for GMP use." banner, the title and the facts of the transfer (program, product, sites, program stages, date). The table of contents is a real Word field. Word asks "This document contains fields that may refer to other files. Do you want to update the fields in this document?" when you open the file. Choose **Yes** to fill in the contents and page numbers. The document-control page has blank placeholders for author, reviewer and approver. The tool does not capture approvals or electronic signatures.

**Add a template.** Open **Templates**, choose a file (`.docx`, `.dotx`, `.docm` or `.pdf`), then give it a name and a version. The version is recorded with every export. The tool recognises `.doc`, `.rtf` and `.odt` files, but does not read them: it tells you how to save them as `.docx` first. Each template shows a report of what the tool found (headings, styles, tags, layout), what it removed, and which of the four options it can be used for.

**Macros are removed.** A `.docm` template is accepted, but its macros are stripped and listed in the report. The copy kept in the library, and every Word file the tool makes, has none.

**The library lives only in this browser.** Templates are not part of the project file and are not sent anywhere. Clearing site data deletes them. Use **Export template file** (a `.gap-template.json` file) to keep a copy or move it to another browser, and **Import a template file** to bring it back. The tool checks the file's checksum on import and refuses a file that has been changed.

**Placeholder tags.** Use **Download starter tag template** for a ready-made Word file. Use **Download tag reference (Markdown)**, or the table on the Templates page, for the list of tags.

**Heading mapping.** To use "Map to their headings", open the template's mapping from the Templates page. This needs an open project, because the mapping lists that project's content. Assign the tool's content to the template's headings with the Add, Up, Down and Remove buttons, or use **Suggest a mapping** and adjust it. For each heading choose whether the template's own text is kept or replaced. Content you do not map is added at the end, or left out if you tick "I understand this content will be left out of the Word document". The report beside the editor updates as you work, and the mapping is saved with the template.

**Fictional samples.** **Add the fictional sample templates** adds four Brightwater Biologics (fictional) templates: a Word template, a tag template, a macro-enabled template and a PDF outline. They are there for trying the feature. Samples already in the library are skipped.

## Guidance library

The **Guidance** page (`#/guidance`) is a list of links to the official text of regulations and guidance for sterile injectable fill-finish, technology transfer and post-approval changes: FDA, ICH, the EU (including Annex 1), MHRA, PIC/S, WHO, Japan, Canada, other markets and the pharmacopoeias. It opens without a project, in the static build and in server mode, and makes no network calls of its own: every title is a plain link that opens the agency's own site in a new tab. You can search (title, reference, agency, notes) and filter by jurisdiction, agency, topic, type and status. Items the research could not fully pin down carry a "Details to confirm" badge, and subscription-only texts say "Subscription needed". The page always tells the reader to confirm they are reading the current version on the agency site, and shows the date the list was last reviewed.

The value of the page is keeping it current. To do that:

1. Run `npm run check:guidance-links`. It requests every link (20 second timeout, six at a time) and lists failures, redirects and warnings. It exits with an error only when a link marked `verified: ok` fails. Links marked `blocked-but-official` (EUR-Lex, EDQM, USP-NF, NMPA and others refuse scripts) are warnings, so open those in a browser. It never edits the file. It is **not** part of `npm run ci` or the GitHub workflow on purpose: it needs the network, and agency sites are slow or down at times, so it would fail builds for reasons unrelated to a change.
2. Review the agency pages for new or revised guidance, drafts that became final, and superseded texts.
3. Edit `content/guidance/guidance.yaml` by hand (fields: `id`, `jurisdiction`, `agency`, `title`, `reference`, `type`, `status`, `date`, `language`, `access`, `url`, optional `pdf`, `topics`, `verified`, `notes`). Remove "confirm" from the notes only once you have confirmed the detail on the agency page.
4. Bump `checked` (the "Last checked" date on the page) and `version`.

`npm test` validates the file: unique ids and links, https only, jurisdictions, types, statuses and topics from fixed lists, and every link on the official-source host list (`OFFICIAL_GUIDANCE_HOSTS` in `packages/engine/src/guidance.ts`). A new agency means adding its host to that list on purpose.

## Pictures and credits

The page banners and unit-operation pictures are **AI-generated, fictional illustrations**: no real site, product, person or brand is shown, and no picture contains text. They are decoration only (empty alt text), carry no information the page does not also say in words, and have all metadata removed. They are kept in `apps/web/public/art/` (two widths each, 1600 and 800 px webp) and are loaded on demand, not bundled into the JavaScript. `scripts/make-site-art.py` rebuilds the files from the review copies and fails if any EXIF, XMP, ICC or C2PA data is left. Banners are hidden when printing, in forced-colours mode and for browsers that ask to save data.

## Running on your own machine (server mode)

The public GitHub Pages site stays a **static demo**: it has no accounts, makes no network calls and keeps everything in the visitor's browser. Server mode is a separate, optional way to run the same app from your own computer with sign-in, so a small, invited group can use it from any device. The server is in `apps/server` (`@gap/server`) and needs nothing beyond Node.js 22 or later.

### Two storage modes

The mode is chosen once, when the data folder is created (`admin init --storage ...`), and is stored in `<data>/config.json`.

| Mode | What the server keeps | Where projects, templates and documents live |
|---|---|---|
| `server` | Accounts, sessions, **projects, the template library and uploaded document files** | On the server's disk, under `<data>/users/<userId>/...`, so they follow the person to any computer. Uploaded files are stored as real, openable files with their original extension. |
| `client` | **Only** accounts, sessions and the plan | Still in the person's browser, exactly like the static app. `/api/projects`, `/api/templates` and `/api/files` answer `403 {"error":"client-storage"}`. Meant for confidential use later. |

Deleted projects, templates and files are moved to `<data>/trash/`, never erased. Every account carries a plan object (`{ id, status, since, modules }`; `trial-free` for now) so billing can be added later; there is no payment provider. `modules` lists the parts of the product the account may use (`gap` is the gap assessment); the signed-in header shows it, for example "Plan: Trial (free) · Modules: Gap assessment".

### Set it up (Windows or any OS)

Keep the data folder **outside the repository** and always give it with `--data` (an absolute path, for example `C:\path\to\data`). The server refuses to start without `--data` and without the `config.json` that `admin init` creates.

```bash
npm ci
npm run build:server                       # web build for server mode + server + admin tool

# 1. create the data folder's settings (once)
npm run admin -w @gap/server -- init --data C:\path\to\data --storage server --max-upload-mb 50

# 2. make the first invite, as an admin; the code is printed once
npm run admin -w @gap/server -- invite --data C:\path\to\data --role admin

# 3. start the server (127.0.0.1 only; port 8787 unless you pass --port)
npm run serve -- --data C:\path\to\data
```

Open `http://localhost:8787/`, choose **Create account** and enter the invite code. After that, invite other people with `invite` (role `member`, valid 7 days unless you pass `--days`, module `gap` unless you pass `--modules`).

Admin commands (all take `--data <dir>`; each prints a plain-English result and exits non-zero on error):

| Command | What it does |
|---|---|
| `init --storage server\|client --max-upload-mb <n> [--force]` | Create `config.json` and the empty account files. Refuses if the folder is already set up unless `--force` (accounts are kept). |
| `invite [--role admin\|member] [--days 7] [--modules gap[,other]]` | Print a new invite code (4 groups of 5 characters) **once**. Only its hash is stored. The new account gets the invite's modules; without `--modules` it gets `gap`, and the command says so. |
| `invites` | List invites with their status (unused, used by, revoked, expired). Never shows the codes. |
| `revoke-invite <number-or-hash-start>` | Cancel an unused invite, by its number in `invites` or by the first characters (4 or more) of its hash. |
| `users` | List accounts (role, plan, modules, disabled). |
| `disable <username>` / `enable <username>` | Block or allow an account. Disabling also signs the person out everywhere. |
| `sessions-revoke <username>` | Sign an account out of all its sessions. |
| `set-plan <username> <planId>` | Change the account's plan, for example `trial-free`. Its modules are kept. |
| `set-modules <username> <comma list>` | Change the modules the account may use, for example `gap,other`. Accounts made before modules existed read as `gap`. |

The admin tool may be used while the server is running: both take the lock file `<data>/.lock` (created exclusively, retried for about 5 seconds, taken over if older than 30 seconds) around every change to `users.json`, `invites.json` and `sessions.json`, and read the file again from disk under the lock, so no change is lost. the web build from `apps/web/dist-server`; add `--web <dir>` to serve a different folder and `--port <n>` to change the port. The build scripts are `npm run build -w @gap/server` (server and admin only) and `npm run build:server -w @gap/web` (web only).

### My files (move files between your computers)

In storage mode `server`, the **My files** page lets a person upload any file on one computer and download it on another, through the server. Files are private to the account: every route is scoped to the signed-in person and another account gets 404, not 403. The page is not offered in the static demo, and in storage mode `client` the routes answer `403 {"error":"client-storage"}` and the page says so.

- **Adding files:** drag and drop (files or whole folders), the "Choose files" and "Choose a folder" buttons, or **Ctrl+V** to paste a screenshot, which is named `screenshot-YYYY-MM-DD-HHMMSS.png`. Folders can be created, renamed, moved and deleted (deleting a folder that holds files needs a confirmation). Files can be renamed, moved, deleted one by one or several at a time, and downloaded. Deleting is permanent: there is no trash for My files.
- **Auto-delete:** optional, in days. The account setting applies to files uploaded from then on; each file can also be given its own date or set to never. The server checks hourly (and at start) and removes expired files.
- **Where it is on disk:** `<data>/files/<accountId>/<fileId>/<safe name>`, with the folder structure and settings in `<data>/files/<accountId>/index.json`. Folders and names you see are labels only; no name you type is ever used as a path. Uploads are streamed to `<data>/files/<accountId>/.incoming/` and moved into place when complete; an aborted or failed upload leaves nothing behind (stray partial files older than an hour are cleaned up).
- **Files are stored as they are.** The server does not open, scan or convert them. Run an antivirus program on the computer that hosts the data folder, and treat downloaded files from any source with the usual care.
- **Safety of downloads:** always an attachment with `X-Content-Type-Options: nosniff` and a sandboxing Content-Security-Policy; HTML, SVG, XML and script files are served as `application/octet-stream`. Thumbnails and previews are shown only for png, jpeg and webp, recognised by the file's first bytes rather than its name.
- **Limits:** one file is limited by `--max-upload-mb`; each account can also have a total quota (below). Folders nest at most 8 deep; at most 20000 files and 2000 folders per account.

Admin commands for My files:

| Command | What it does |
|---|---|
| `files-usage` | List each account's My files usage (file count, MB, quota or "no quota set") and the total. |
| `set-files-quota <username> <MB\|none>` | Set an account's total My files quota in MB (1 to 1048576), or `none` to remove it. There is no default quota. |

### Testing server mode

- `npm test` includes the server's unit tests (`apps/server/test`, real HTTP on a free port, temporary data folders).
- `npm run e2e:server` builds first (`npm run build:server`) and then runs the browser tests against the real server. To run them without rebuilding, run `npm run build:server` once and then `npx playwright test -c playwright.server.config.ts` in `apps/web`. The suite needs the build: it starts `apps/server/dist/server.mjs` with `apps/web/dist-server` on ports 8788 (storage `server`) and 8789 (storage `client`), using temporary data folders that are deleted afterwards.

### Make it reachable with Tailscale

The server listens on `127.0.0.1` only, never on the network. Tailscale proxies HTTPS to it, and provides the certificate.

```bash
# only people on your tailnet:
tailscale serve --bg 8787
#   -> https://<machine>.<tailnet>.ts.net/

# anyone with the link (public internet), for a small invite-only trial:
tailscale funnel --bg 8787
#   -> https://<machine>.<tailnet>.ts.net/

tailscale serve status         # see what is published
tailscale funnel reset         # stop public access again
tailscale serve reset          # stop sharing completely
```

Funnel must be allowed for your tailnet (an admin switch in the Tailscale admin console) and HTTPS must be enabled there. Check `tailscale funnel --help` for the exact options of your version. The session cookie is `Secure`, so sign in through the `https://` address (plain `http://localhost` also works on the same computer).

### Security notes

- **Only invited people get in.** There is no open sign-up; a code is single-use, expires, and can be revoked. Passwords are at least 7 characters (no other character rules), hashed with scrypt (N=2^15, r=8, p=1, 64-byte key, per-password salt) and compared in constant time. An unknown user name takes as long to check as a real one, and every sign-in failure gives the same message.
- **Sessions** are random 32-byte tokens in an `HttpOnly; Secure; SameSite=Strict` cookie, valid 14 days. Only a SHA-256 hash of the token is stored, so a copy of the data folder does not contain usable sessions. Changing the password signs the account out of its other sessions.
- **Cross-site requests** are blocked: every change needs the `X-Gap-Request: 1` header, and an `Origin` header, when present, must match the address the request came to.
- **Rate limits** (in memory, reset on restart): 5 failed sign-ins per user name and 20 per address in 15 minutes; 10 sign-up attempts per address per hour. The address is taken from `X-Forwarded-For` only when the connection comes from this machine (Tailscale), otherwise the real peer address is used. Because failures are counted per user name, anyone can briefly lock a known user name out by guessing wrongly; the lock ends after 15 minutes.
- **Headers:** a strict Content-Security-Policy (same-origin only, no inline scripts), `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, HSTS, and `Cache-Control: no-store` for the API. Downloads are always `application/octet-stream` attachments.
- **Limits and paths:** JSON bodies up to 25 MB, sign-in bodies up to 16 KB, uploads up to the configured size; a body that goes over the limit is cut off while it is being read, not stored, and the sender gets the 413 message (up to four times the limit, at least 64 MB, is read and thrown away so the browser is not reset; a sender that stops for 30 seconds is cut off). Ids are checked before any disk access, uploaded file names are reduced to a safe name (no folders, no reserved Windows names, no control or direction-override characters) and static files cannot be fetched from outside the web folder. Every route is scoped to the signed-in person; nobody can reach another account's data.
- **Data:** writes are atomic (temp file, then rename) and queued per file. `<data>/audit.log` records sign-ups, sign-ins (ok and failed), sign-outs, invites, password changes, enable/disable, uploads and deletes, without passwords, tokens or invite codes. Back up the whole data folder; it is the only copy of server-stored projects.
- **Not provided:** password reset by e-mail (an admin can `disable` the account and issue a new invite), multi-factor sign-in, encryption of files at rest (use disk encryption), and running more than one server process on the same data folder (the admin tool alongside one server is fine). Responder names in a project are still free text; an account is not an electronic signature.
- Never put the data folder, an invite code or a session cookie in the repository, a ticket or a chat.

---

*Proof of concept. Not validated. Not for GMP use. Fictional data only.*
