# Gap Assessment Generator: handover (repo copy)

This is the public, cleaned-up handover for any machine or new session. It holds status, decisions and next
steps only. Machine-specific notes (local paths, server addresses, accounts, invite details) are kept in a
private handover outside the repo and must never be copied in here. Read this file, then `README.md`.

Last updated: 2026-10-26. Update this file (no machine-specific details) whenever a milestone lands.

## 1. Where things stand
- **M10 (PPQ flow figures in the sampling plan) is built and verified, waiting for the product owner's review and commit** (section 5b).
- **M9 (TRD module) is built and verified, waiting for the product owner's review and commit** (section 5a).
  Before it, the My files page (move files between your own computers through the server, server storage only)
  landed in `a8cbe49`.
- **M8 (risk assessment) is done, with its follow-ups:** `5664b28` plus the follow-up change set (section 5):
  the risk method library edits scales and bands itself, an assessment is told when the library has a newer
  version of its method, and the risk Word output uses the Templates library. Before M8: M7 and its
  sub-milestones M7.1 and M7.2 (section 4) and a sampling polish pass.
- Current versions: project schema 1.26.0, process model 1.7.0, sampling plan format 1.4.0, TRD format 1.0.0, risk format 1.0.0, content catalog 1.0.0 (failure
  modes and method load-outs 1.0.0), all other packages 0.1.0.
- Saved answers (schema 1.26.0, version-only migration; the answer record gains an optional `fromSavedSet` {name, savedAt}): an
  author keeps a project's SU and/or RU answers as a named set and offers it to another project through a review list (every
  answer ticked, a different existing answer shown beside the saved one, questions the project does not ask skipped). Not saved:
  TBD, "same as SU", open questions and shared scoping answers. Applying goes through `applyAnswer`; the provenance shows on the
  question (note ends when the answer is retyped), in the source label and in the change log. Storage like the other libraries
  (static = IndexedDB `gap-saved-answers`, server = `/api/saved-answers`, module `gap`) plus Export set / Import set files.
  Code: process model `saved-answers.ts`, engine `saved-answers.ts`, web `SavedAnswersPage.tsx`, `SavedAnswersDialogs.tsx`,
  `saved-answers-store.ts`, server `routes/saved-answers.ts`; Library menu entry "Saved answers" and a card on the Interview page.
- **Memo template fixes (sampling plan and CMO instructions).** A plan party has an optional department and an optional memo
  line (From, To or Cc); schema 1.16.0 (version-only migration), process model 1.6.0, sampling plan format 1.3.0. New template
  tags: `{#parties}`, `{#fromParties}`, `{#toParties}`, `{#ccParties}` (name, role, department, memoLine), `{fromText}`,
  `{toText}`, `{ccText}`, `{sendingUnit}`, `{receivingSite}`, `{cmoName}`, `{sponsorName}`; listed in the Templates tag
  reference and accepted by the unknown-tag check. Nothing is defaulted: a party is on a memo line only when the user chose it,
  and an empty line prints "[none chosen]". A first-page-only header (`titlePg`) of the template's first section now survives
  assembly (`restoreFirstPageHeader`, run for every template mode); later sections behave as before. Both sampling exports
  use the shared Word panel with the Templates library (Built-in, Their look, Placeholder tags; mapping not offered). The body
  parties table of the plan is unchanged.
- Open idea: the sticky "answering from" bar can cover content after a dialog returns focus; a product-side fix
  (e.g. scroll-margin on focus targets) may be worth doing later.
- **NEXT:** wait for the product owner's next milestone choice.
- Remaining suite modules to choose from: excipient assessment, MBR templates. AI features are
  deliberately the very last step.

## 2. Milestones done
| Milestone | Commit | What it added |
|---|---|---|
| M1-M4 | `3b93466` | Interview, comparison, gap register, validation plan, source register, verification, change log |
| M5 | `4d93491` | Word (.docx) export, template library (4 template modes), revisions, reviewer comments |
| M5.1 | `2877a72` | Program stage per side (commercial / clinical / development), stage-aware wording, styled Word template |
| M5.2 | `bef075e` | SU/RU wording everywhere, lean gap table + details appendix, per-gap notes, documents-first sources, optional sections |
| M5.3 | `88516d2` | Optional self-hosted server mode: invite-only accounts, server storage, plan object with `modules` |
| — | `3d3a9bc` | Buffer prep unit, BBR filtration split, PUPSIT block, PFS stopper position |
| — | `e357772`, `0664260` | Guidance library page; clear-answer buttons and interview navigation |
| M5.4 | `0b64dcc` | Drafting: "Answering from" bar, bulk citing, TBD values (best guess, owner, due) |
| — | `de35f0b`, `b964e30` | Site art (webp, decorative, light + dark) |
| M5.5 | `2f0d563` | DS shipping inbound, bulk packaging, labelling-location scoping, per-section topic tailoring |
| M5.6 | `c95d838` | "Unknown" merged into TBD (with change-log record per converted entry) |
| M5.7 | `5461b1f` | Scope step, unit-op groups, review workflow removed (archived), TBD warning on every download |
| M6 | `7d6bf9e` | Shared process model 1.0.0 package and the TRD seed export (JSON + draft outline) |
| M7 | `7228bea` | PPQ sampling plan module (see section 4) |
| M7.1 | `7b428b9` | Sampling interview by step and by study type, agency requests, reporting instructions (CMO document), plan subsections library; schema 1.12.0 |
| — | `94dd9f2` | Saved PPQ batch rows collapse into a summary with an Edit button |
| M7.2 | `7714eb4`, `80a8d17` | Plan's own process steps, flow diagram with draggable sample markers and a linked points table (schema 1.13.0); short add form, optional wizard, collapsed point cards |
| — | `393279c` | Sampling polish: demo points sit on the diagram, plan details collapse after Save |
| M8 | `5664b28` | Risk assessment module (ICH Q9(R1)): four user-chosen scoring methods, method library, Word + HTML output (see section 5) |
| M8 follow-ups | see section 5 | Library edits scales and bands with versions; update-from-library; risk Word output through the Templates library |
| My files | `a8cbe49` | Server storage: upload, organise and download any file between your own computers; private to the account |
| M9 | not committed yet | TRD module: start from project / seed file / blank, overrides with the project value beside, update review, PAR/NOR entry and check, Word + HTML (section 5a) |
| M10 | not committed yet | PPQ flow figures: time-scale and step-card drawings of the plan (holds, time targets, buffer sub-process, samples), in the sampling page, HTML and Word (section 5b) |

## 3. Hard rules
- **Identity:** never put a personal name or email in the repo (files, commits, issues, PRs). Git identity is
  EtymonDocumentation (noreply address). Check `git log --format='%an <%ae>' -1` before every push.
- **Fictional data only** in the repo and demo (DEMO-... IDs, "Vendor X (fictional)"). Never commit real customer files.
- Permanent banner: "Proof of concept. Not validated. Not for GMP use."
- **No default values.** Catalogs supply options, never answers; unknowns stay visible.
- Every value has a source. Removing a source cascades: entries left without one revert to Not established,
  the old value is kept only in the change log. Changing a value withdraws its verification.
- The tool **never decides a filing category**; the only wording is "Requires regulatory affairs assessment".
- **Accessibility WCAG 2.2 AA:** axe in e2e with no serious/critical issues, no colour-only cues, light and dark
  themes via CSS tokens, no sideways page scroll (390 px phone up to desktop), wide tables inside
  `.table-scroll` regions.
- **Milestone discipline:** finish, verify, report against the criteria, stop, wait for approval.
- **Commits tell the story:** why, what changed per area, decisions and trade-offs, what was left out, how it
  was checked (test counts). Code comments explain the why of non-obvious logic.

## 4. M7 sampling plan
- Scope chosen by the product owner: PPQ runs only for now; all five sample-size methods (MIL-STD-105E / ANSI
  Z1.4 attributes, MIL-STD-414 variables, confidence/reliability, company lot-size table as a first-class
  method, enter your own); points seeded from the project and added free-form (report-only allowed); Word +
  HTML output now, CSV and sample labels later.
- Packages: `packages/sampling` (statistics; 105E and 414 tables cross-checked against a second source, 0
  mismatches), process-model 1.1.0, project schema 1.11.0, `content/sampling` suggestion catalog, engine
  `sampling*.ts`, web Sampling + Sampling tables pages, module `sampling` checked server-side.
- M7.1 and M7.2 added study types, the process-step flow diagram (pointer-drag plus a full keyboard equivalent),
  a short add form with a wizard option, and collapsed cards; they never add required fields or rules ("possibilities,
  not rules": load-outs only fill a starting shape).
- Known limits: no 105E double sampling; no 414 range method, known-variability plans or split AQL; 414 table
  B-3 column .04 has a single source; CPP-based suggestion dormant until RU parameters carry a CPP classification.

## 5. M8 risk assessment (latest)
- Scope chosen by the product owner: all four scoring methods, one per assessment (FMEA factor product, risk
  matrix, user-defined factors with product/sum/max/lookup, qualitative levels); failure modes seeded from gaps,
  from a catalog and free-form; links to sampling points; optional residual risk; Word + HTML output.
- Packages: `packages/risk` (pure scoring; every result carries its working and a problem list, missing input is
  "not scored", never a guess), process-model 1.4.0, project schema 1.14.0 (old projects simply have no
  assessment), `content/risk` (failure-mode suggestions and method load-outs), engine `risk*.ts`, module `risk`
  checked server-side with a method library route.
- No default method, scale, band or threshold: load-outs are optional starting shapes the user edits. The tool
  never calls a risk acceptable; it only reports the band the user defined, in the user's words, else "(no band)".
  Gap severity is reference text and is never copied into a score.
- **Follow-ups:**
  - Method library editing: the library page edits the whole method of all four kinds with the same editors as the
    Method step, creates methods from a load-out or blank, and every save is a new entry version with the earlier
    content kept in the history. Band and scale problems are shown as in an assessment.
  - Assessments keep their own copy. When the library has a newer version (or the same version label with changed
    content) the Method step says "Library has v<x>; this assessment uses v<y>" and offers "Update from library".
    The update lists which scores would read differently, then writes a change-log entry. Scores are never
    changed by an update; they are the team's answers.
  - Risk Word output uses the Templates library like the gap document (built-in, their look, placeholder tags) and
    records the template in the export history and the file properties. "Map to their headings" is not offered
    because the saved mapping names gap sections.
- Known limits: no CSV export, no AI suggestions, no review reminders. Server e2e covers library editing; the
  module gating is covered by server unit tests.

## 5b. M10 PPQ flow figures
- Spec: M10-SPEC (in the project docs folder). Versions: project schema 1.17.0, process model 1.7.0, sampling plan format 1.4.0.
  Old plans load unchanged: every new field is optional, and there are no new completeness checks, warnings or rules.
- Plan data (all optional): step `figureText`, `durationHours`, `subProcess`; plan `holds`, `timeTargets`, `subProcesses`,
  `timeZero`; sample `takenAtHour` and `flow.holdId` (taken during a hold). The figure style (time scale, step cards, none) is an
  export choice, not stored in the plan. Missing hours are normal: a narrow dotted block and a plain "Hours not given" list.
- The figure is ONE pure function, `buildFigures(plan, options)` in packages/sampling (plan/figure): SVG per page plus page-split
  information, text never below 8 pt at printed size, legend on every page, "Continued on next page" when it splits. Default page
  width 640 pt so it prints unscaled on Letter and A4 landscape. A sub-process (buffer) is its own figure before the main one
  ("Feeds <step> in Figure N"). Routine samples (in-process, release) are one line per step; everything else is a PPQ sample.
  A very crowded timeline taller than the limit is flagged `overflow` and not shrunk (known limit).
- Word: a figure block in the document model; the docx writer draws each page as a PNG (200 dpi) in a landscape section with a
  numbered caption, then the long sample table follows. The docx package takes an injected rasteriser: the browser canvas in the
  web app (no bundle cost; a WASM renderer was rejected, about 2.5 MB plus a bundled font), @napi-rs/canvas in Node tests and
  samples (dev dependency). Without a rasteriser the figure falls back to caption, description and a warning.
- Web: "More details" on each step (figure text, hours, sub-process; a suggestion button copies established project / TRD values
  or hold-time sample data into the plan, never written back), a "Flow figure details" card (holds, time targets, sub-processes,
  time zero), hour and hold on a sample, the figure on the sampling page with two-way highlight against the table, and a figure
  style choice in the export panel. A focusable sample mark is a labelled group, not a button (label-in-name rule).
- Demo plan has fictional holds, time targets, hours and a buffer sub-process. Tests: sampling figure tests, content m10-figure,
  docx m10-figure, web e2e m10.

## 5a. M9 TRD module
- Scope chosen by the product owner: a TRD that can start from the project, a seed file or blank; every value can
  be overridden (reason optional, "No reason recorded"); updates never replace an overridden value on their own;
  set point, NOR and PAR entered by the team with sources from the source register.
- Data: `project.trd.documents` (schema 1.15.0 migration adds an empty list), process model 1.5.0 (`trd.ts`, TRD
  format 1.0.0, export kinds `trd-docx` and `trd-html`), engine `trd*.ts` (edits, check, update, document), web
  pages `Trd*.tsx`, module `trd` checked in the project save routes (`403 module-not-included`).
- Each field keeps the project value (`pulled`) and the team's `override` side by side. The "project changed"
  notice compares a content fingerprint of the seed that leaves out the export time and the gap document
  fingerprint (that one moves with any change-log entry, so it would flag a brand-new TRD as out of date).
- PAR and NOR are never derived from the sampling plan or a project range; "Copy the project value of ..." is an
  explicit button. The check only reports (NOR within PAR, set point within range, min above max, units that
  differ are not converted, a missing citation is an open item, provisional is labelled).
- Source document types and basis wordings are suggestions only. No filing category is ever named.
- Known limits: process sections only (no facility or quality sections), no CSV, approval roles are text only,
  a renamed step in a newer seed shows as removed plus added.

## 5c. M9.1 TRD process descriptions (Step B)
- What: each TRD can hold "process descriptions": one write-up per included process step (in step order) plus TRD-level
  prose sections. They export (Word and HTML) as the section "Manufacturing process overview" with numbered
  sub-sections per step (for example 18.1), lettered sub-steps, notes styled as notes and open blanks highlighted.
- Versions: process model 1.10.0, project schema 1.20.0 (version-only migration), TRD format 1.2.0 (optional
  `writeups`, pictures and placement), write-up library format 1.1.0. A TRD without write-ups exports exactly as before.
- Library: `content/trd-writeups/writeups.yaml` (35 write-ups: 20 sections, 15 unit operations), account level like the
  MBR step blocks (static = IndexedDB, server = `/api/trd-writeups`, module `trd`). Edit makes a new version with its
  history, duplicate, create new, back to shipped. The TRD keeps its own copy and shows "Update from library" with
  a note of what would change; edited paragraphs are kept, removed ones stay removed.
- Blanks are written `{{key|Label}}`. Order: typed in this write-up, typed in another write-up of the TRD, TRD record,
  project answer, otherwise open (shown as `[Label]`, highlighted; nothing is filled in by default). Typed values are
  TRD-level entries, not new project questions. A value appendix lists filled blanks with sources and the open ones.
- Optional parts start off and are plain switches; nothing is required and nothing blocks saving or export.
- Deviation from the spec: heading numbers are written into the heading text instead of using auto-numbered
  headings, so customer templates show the same numbers.
- Code: engine `trd-writeup*.ts`, process model `trd-writeups.ts`, web `TrdWriteups.tsx`, `TrdLibraryPage.tsx`,
  `trd-writeups-store.ts`, server `routes/trd-writeups.ts`.
- Gap closure (figures, table rows, placement):
  - Figures: a figure part takes a PNG or JPEG (file picker or a pasted screenshot) with a caption and alternative text.
    The type is decided from the first bytes of the file, never from its name. Limits: 2 MB per picture and 10 MB of
    pictures per TRD, stated beside the picker and in every refusal. Pictures are stored inside the project (base64 in
    the TRD part): there is no per-project file store, and the server accepts project bodies up to 25 MB, so the TRD cap
    keeps a project well below that. The change log keeps the type, size, pixel size and SHA-256 of a picture, never
    its bytes, so removing a figure or a write-up cannot be undone from the log. Figures are numbered through the document
    ("Figure N. caption") in Word, HTML and Markdown (Markdown and HTML embed the picture as a data: image). In Word
    the picture is scaled down to the text width (never enlarged), keeps its shape, and has its caption under it; it
    works in the built-in look, a customer look and tags mode (new block type "picture"). A figure with no picture
    keeps the "Figure to be added" note and counts as an open item (summary, card, appendix "Figures without a picture").
    A library figure may have a caption and no picture.
  - Table rows: the TRD tab edits rows (add, remove, move up or down, edit each cell; a cell may hold a blank) and the
    library form edits column heads and starting rows. Every save is change-logged with what changed. Rows are cut or
    padded to the column heads, and a cell has no line breaks. Exports have a header row; an empty cell stays empty; an
    open blank in a cell shows as [Label] (plain text, not highlighted). "Update from library" keeps rows the team
    typed and its difference note names table changes.
  - Placement and order: a library section can be placed before or after a unit operation (picker in process order) or at
    the end of the overview, or left unplaced; clearing it makes a new version. In the TRD, Up and Down move a
    description past its neighbour (change-logged). A description of a unit operation sits with its step, so it moves only
    among descriptions of the same step; the button explains why otherwise. A placed section that passes a unit-operation
    description takes that place and keeps it on update (`placementEdited`). Export order follows the Descriptions order.
  - Code: engine `trd-writeup-order.ts` (order and move plan), `demo-image.ts` (generated placeholder picture for the
    fictional demo), process model `trd-image.ts`; web `rows-editor.tsx`.

## 5d. SYR-305 demo batch record
- What: the fictional prefilled-syringe demo now carries a master batch record (DEMO-MBR-305-01) built from its approved
  TRD, reachable like the vial demo's ("Open syringe example", then Batch record), in static and server modes.
- Content: 11 unit-operation sections in process order plus a review section. Mostly "same as TRD"; one row tightened by
  the CMO with a reason (stopper position range); one time limit with targets (12 h out of refrigeration = filling 6 +
  inspection 3 + bulk packing 1 + labelling 2); one study point beyond a limit (inspection rate range); one TRD
  requirement without a step (compounding in-process controls); several "not decided". No filtered-hold block (the TRD
  has none) and no needle-clog block (the TRD says clogging is not likely).
- Library `content/mbr/blocks.yaml` format 1.1.0: six blocks went to version 2 (receipt and thaw, buffer preparation,
  BBR filtration, sterile filtration, visual inspection, bulk packing) with the earlier version kept in `history`; four
  new blocks (shipment monitoring and custody, syringe nest debagging, plunger stopper placement, total time out of
  refrigeration). Records made from version 1 are offered "Update from library".
- Demo recipe (`packages/engine/src/demo.ts`): a target may span steps in different blocks (`stepPlace`). The demo is built
  from the current library, so the vial demo also uses the version 2 blocks.
- Review fixes (2026-10-25): out-of-refrigeration times are recorded before handling and the return time is the last step
  (bulk packing 9.2 / 9.6, labelling 10.3 / 10.6, inspection 8.2 / 8.6; labelling is now library version 2, bulk packing
  and sterile filtration were edited in place at version 2 because version 2 was never committed). The total-time targets
  span those out and return steps. The sterile filtration steps refer to the integrity test steps by an automatic
  cross-reference (demo recipe `refs:`; stored as ids, shown as "(Step 6.7)"). A study point reads "Study point (not a
  limit)" in the Choice column (`mbrChoiceText`) and is never counted as not decided.
- Decision (product owner, 2026-10-25): the 12 h total time out of refrigeration counts from the start of filling until the
  product is back in refrigerated storage (not from the end of thaw; the post-thaw ambient time has its own limit). Changed in
  question `ss.total_tor` (question bank 1.9.0), write-ups `sec_process_parameters` v3 and `wu_aseptic_filling` v4, and the
  MBR block `time_out_of_refrigeration_total`. The value 12 h and the rule text are unchanged.
- Not in the data: per-step rooms and operator counts. Durations exist as TRD limits and set points only.
- Syringe PPQ plan (2026-10-26): `content/demo/syr-305.yaml` now has a `sampling:` block, "SYR-305 PPQ sampling plan
  (fictional)", with Table 4 samples 1 to 17 as points SP-001..SP-017 over three batches (PPQ 1 50 L, PPQ 2 100 L, PPQ 3
  9 L). Mixing homogeneity T0/T1/T2 top and bottom (1-6), post-filtration hold in the holding bag (7-9; sample 9 applies
  to PPQ 2 and 3 only, demo point field `appliesTo` = batch labels, resolved to batch ids in `applySamplingDemo`),
  enhanced filling samples (10-14, 14 after a 60-minute line stop), surge bag hold (15), stability after the time-out
  challenge (16: 600 syringes = 2 conditions x 5 time points x 60) and the T0 total-time sample (17). Everything is
  complete except the plan-level "not yet stated whether agency requests exist" item, which the demo schema cannot
  clear. PPQ-only extended holds (36 h) are challenges in the plan, never MBR limits.
- Batch record sample rows: the compounding (1-6), BBR filtration (7-9) and aseptic filling (10-17) sections carry a
  `sample_table` block linked to the plan through the M11 mechanism (`planId`, `pointId`). `sampleFieldsOf` shows a set
  of containers as "2 x 10 mL" (`containerUnitsPerSample`).
- TRD changes with the plan: batch size after dilution 50 L (NOR 45-55, PAR 9-100) in a 100 L single-use mixing bag whose
  impeller is covered from 9 L; BBR filter contact time set point 4 h, NOR 4 h, PAR 24 h; filling duration PAR 8 h now
  rests on the media fill (filling speed PAR stays 200). Time out of refrigeration is tracked per portion, 12 h from the
  start of filling of that portion: demo-specific write-up edits in `trd.writeups.edits`, and MBR blocks
  `time_out_of_refrigeration_total`, `visual_inspection_run`, `bulk_packing`, `labeling_run` went to new versions
  (earlier ones in `history`) with a portion ID field. Kept on purpose: the dilution buffer table stays the 20 kg
  buffer batch (a separate batch from the drug product; `comp.diluent_volume` is 18.75 L = 50 L x 80 mL/L).
- Tests: `content/test/syr-305-ppq.test.ts`, `packages/docx/test/syr305-ppq.test.ts` (plan and CMO exports).
- Tests: `content/test/syr-305-mbr.test.ts`, `packages/docx/test/syr305-mbr.test.ts`, `apps/web/e2e/syr-demo.spec.ts`,
  `apps/web/e2e-server/m11-mbr.spec.ts`.

## 6. Stack and checks
- npm workspaces: `packages/process-model`, `packages/engine`, `packages/renderers`, `packages/docx`,
  `packages/sampling`, `packages/risk`, `content/`, `apps/web` (React, Vite, Zustand), `apps/server` (optional self-hosted mode).
- Checks that must all pass before a commit: `npx tsc -p tsconfig.json`, `npx vitest run`, `npm run build`,
  the web e2e suite (Playwright, desktop/tablet/phone projects, axe), `npm run build:server`, `npm run e2e:server`.
  Latest counts (syringe PPQ plan, 2026-10-26): vitest 2145 (120 files), web e2e 804 passed first run, the 11 that failed (6 from a
  renamed hold label, 5 phone timeouts under load) pass on rerun, 7 skipped, server e2e 70.
- Parallel Playwright runs need separate `--output` folders.
- Commit with a message file (`git commit -F <file>`); CI (`.github/workflows/deploy.yml`) runs typecheck,
  tests, build, e2e and deploys the static demo to GitHub Pages on every push to main.
- `.gitattributes` forces LF, so CRLF warnings on commit are harmless.

## 7. Decisions already made (do not reopen)
- "Exist; update required" procedures map to **new_requirement**; the target value tells them apart.
- Classification CPP / KPP / non-critical; within-range checks use the validated range if present, else the PAR;
  equivalence is exact after unit conversion; severity only, no RPN.
- Closed or accepted gaps still imply their validation activities, marked with the gap status.
- Final revision with TBDs remaining = warn and record (not block); TBD owner and due date are optional.
- Site is the source of truth; Word/PDF is the output for review and approval in the client's QMS.
- Business direction: subscription with an optional client-side (confidential) storage mode; enterprise =
  the server installed on the client's own network.

## 8. Planned AI features (last step, not started)
- Template-from-screenshots and document pre-fill, via the self-hosted server only (API key never in the web
  bundle), every AI value marked "to be confirmed" until a human verifies it.
- Controls: per-account `ai` module, quotas, usage log, admin kill switch checked server-side.

## 9. Known limitations
- Qualification status is compared as equal / not equal only.
- Study-quality evidence questions are target-only.
- Self-verification detection relies on typed names.
- Main JS bundle is large (could be code-split later).
