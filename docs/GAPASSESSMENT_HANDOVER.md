# Cascade (the gap-assessment repository): handover (repo copy)

This is the public handover for any machine or new session: status, architecture, decisions and next steps only.
Machine-specific notes (local paths, server addresses, accounts) live in a private handover outside the repo and
must never be copied in here. Read this file, then `README.md`. The commit history tells the detail of each change.

Last updated: 2026-11-09. Update this file (no machine-specific details) whenever a milestone lands; replace
section 1 rather than appending to it.

## 1. Where things stand
- Cascade ("GMP transfer documentation") is a drafting aid and client showcase with fictional data. Every module below
  is built, committed and deployed (static demo on GitHub Pages; optional self-hosted server with accounts).
- Latest: M11 sampling plan design review, complete in three jobs (`1dd435c`, `cc69e86`, `249cdb9`): questions about
  likely design errors and left-out studies, a Process view "Coverage" group, a Word/HTML appendix, and an
  account-editable "Expected studies" list (`/sampling/expected`).
- Current versions: project schema 1.32.0, process model 1.18.0, MBR format 1.3.0. Check `packages/process-model/src` for the other format versions.
- **M12 (TRD interview) is built** (jobs 1 to 3): an Interview tab inside the TRD stage, no new module, no schema change. Starts: TRD page
  and Home ("Answer questions"), also Home starts for a sampling plan and a batch record on their own. Files: engine
  `packages/engine/src/trd-interview.ts`, wording `content/trd-interview/wording.yaml` (all questions hand-worded), tab
  `apps/web/src/pages/TrdInterview.tsx` + `TrdInterviewCard.tsx`, helpers `apps/web/src/trd-interview-lib.ts`, tests
  `content/test/m12-trd-interview.test.ts`, `apps/web/e2e/m12-interview.spec.ts`, `m12-job3.spec.ts`. Spec: docsGAPASSESSMENT_M12-SPEC.md.
- **M13 (excipient assessment) is built** (jobs 1 to 4B, commits `7883a4f`, `188d2a8`, `bd7898b`, `52233aa`, then job 4B): a module
  `excipient` at `/excipient` (list, five tabs, an excipient page per line) and a library at `/excipient/library`. Compares the
  excipients of the product between the sending and the receiving site; no verdict, no score, the only filing wording is "Requires
  regulatory affairs assessment". Links to the gap assessment, a draft risk item and the TRD material row; Word, HTML and Markdown
  document; an optional "Excipient assessment" section in the gap document; both demos carry a small fictional assessment (`excipients:`
  block in `content/demo/*.yaml`); tour, glossary and "?" help; a Home card. Files: model `packages/process-model/src/excipient*.ts`,
  engine `packages/engine/src/excipient*.ts`, content `content/excipient/`, screens `apps/web/src/pages/Excipient*.tsx`, tests
  `content/test/m13-*.test.ts`, `apps/web/e2e/m13-*.spec.ts`. Spec: docs/GAPASSESSMENT_M13-EXCIPIENT-SPEC.md (kept outside the repo).
- **Open design question (M13):** the batch record has no material list, so an excipient line cannot yet be copied onto the record's
  dispensing step. That needs a new optional list in the batch record format (a format change), so it was left for a decision.
- **NEXT:** the batch-record material list (see above), then the ease-of-use pass; AI features are deliberately the very last step.

## 2. Milestones done
| Milestone | Commit | What it added |
|---|---|---|
| M1-M4 | `3b93466` | Interview, comparison, gap register, validation plan, source register, verification, change log |
| M5-M5.7 | `4d93491`..`5461b1f` | Word export + template library, program stage per side, SU/RU wording, server mode (`88516d2`), drafting aids (TBD values, bulk citing), scope step |
| M6 | `7d6bf9e` | Shared process model package and the TRD seed export |
| M7-M7.2 | `7228bea`, `7b428b9`, `7714eb4` | PPQ sampling plan: five sample-size methods, interview by step / study type, CMO reporting instructions, plan subsections library, flow diagram |
| M8 | `5664b28` | Risk assessment (ICH Q9(R1)), four scoring methods, method library with versions |
| My files | `a8cbe49` | Move any file between your own computers (server storage only) |
| M9 / M9.1 | `6dcc1e3`, `6fc7d42`, `9f08bde` | TRD module; process descriptions from an editable write-up library (figures, table rows, placement) |
| M10 | `7eef0b7` | PPQ flow figures (time scale / step cards) in the page, HTML and Word |
| MBR | `ddbe540`, `a1ceba2`, `7cc6f5a` | Master batch record from the TRD and/or plan; Process view (equipment train + fluid tracker); two-part record |
| Demos | `7468529`..`4f9f6c9`, `5d65ffe`, `d5a7096` | SYR-305 (syringe) and ARX-217 (vial) demos: TRD, plan, batch record that agree |
| PDA TRs | `c57c4e5`, `80b945c` | What the PDA technical reports expect of a transfer package; optional TR 44 FMEA load-out |
| Layout | `12151fb`, `715451d`, `3cab589` | First-time-user layout: document chain strip, tabs, "?" help |
| Saved answers | `bbca9cc` | Keep a project's interview answers as a set and offer them to another project |
| Sample method | `4b4eaea`, `7dd51a0`, `9bc02a7` | How each sample is physically taken, as reminders and drawings |
| Redesign | `53a979a`, `39d6906`, `9ccd969`, `d76d6f1` | Cascade name and shell, page headers, first-time-user fixes, faster downloads, client codes kept out |
| Life stage | `f2b4b5c`, `d6cd384` | One project stage (Engineering/development, Clinical, PPQ, Commercial) that the whole chain adapts to |
| Tour | `2f6ccb7` | Short guided tour per page, glossary, Help (?) button |
| Upload | `134f89d`, `8088ecf`, `4225132`, `a5712b1` | Upload a finished TRD, sampling plan or gap assessment (Word/PDF, fixed rules, review screen) |
| Home | `bf0f4c6` | Cascade Home page; gap assessment gets its own page |
| Stage-up | `5ce06ec`, `5d8f582`, `a1cafdf` | Version history per project, stage change = new version + guided review, compare two versions, version stamp on documents |
| M11 | `1dd435c`, `cc69e86`, `249cdb9` | Sampling plan design review (see section 1) |
| M13 | `7883a4f`, `188d2a8`, `bd7898b`, `52233aa`, job 4B | Excipient assessment: model and engine, screens, library, links and document, demos, tour, glossary, help (see section 1) |

## 3. Hard rules
- **Identity:** never put a personal name or email in the repo (files, commits, issues, PRs). Git identity is
  EtymonDocumentation (noreply address). Check `git log --format='%an <%ae>' -1` before every push.
- **Fictional data only** in the repo and demos. Never commit real customer files, client names, client document
  codes, product codes or supplier brands; CI checks a private term list (secret `GAP_PRIVATE_TERMS_TEXT`).
- Permanent drafting-aid notice on every screen and in every Markdown, HTML and Word document, written once in
  `packages/engine/src/product.ts`. It never says the tool is validated or approved for GMP use.
- **No default values.** Catalogs and load-outs supply options and starting shapes, never answers; unknowns stay
  visible. Practices are optional load-outs, never enforced rules. Nothing blocks saving or export.
- Every value has a source. Removing a source cascades: entries left without one revert to Not established,
  the old value is kept only in the change log. Changing a value withdraws its verification.
- The tool **never decides a filing category**; the only wording is "Requires regulatory affairs assessment".
- Everything the user makes can be deleted (with a confirmation and a logged reason), versions included.
- **Accessibility WCAG 2.2 AA:** axe in e2e with no serious/critical issues, no colour-only cues, light and dark
  themes via CSS tokens, no sideways page scroll (390 px phone up to desktop), wide tables inside `.table-scroll`.
- **Easy for a first-time user:** plain words, the reason next to the question, same wording in app, HTML and Word.
- **Commits tell the story:** why, what changed per area, decisions and trade-offs, what was left out, how it was
  checked (test counts). Code comments explain the why of non-obvious logic.

## 4. Architecture notes per module
- **Sampling plan** (`packages/sampling`, engine `sampling*.ts`, `content/sampling`): PPQ batches bracketed by size;
  five sample-size methods (MIL-STD-105E / ANSI Z1.4, MIL-STD-414, confidence/reliability, company table, own);
  process steps + flow diagram with a keyboard equivalent; flow figures are one pure function `buildFigures` (SVG,
  rasterised for Word by an injected rasteriser). Design review = `plan/review.ts` (pure checks A-D, answers with a
  facts fingerprint so changed facts say "look again"). Known limits: no 105E double sampling; no 414 range method.
- **Risk** (`packages/risk`): pure scoring, every result carries its working; missing input = "not scored". Assessments
  keep their own copy of the method and are offered "Update from library"; scores are never changed by an update.
- **TRD** (engine `trd*.ts`): each field keeps the project value and the team's override side by side; PAR/NOR are
  never derived. Write-up blanks `{{key|Label}}` fill from typed values, TRD record or project answer, else stay open.
  Pictures stored inside the project (2 MB each, 10 MB per TRD).
- **Excipient assessment** (`packages/process-model/src/excipient*.ts`, engine `excipient*.ts`, `content/excipient`): each fact of a line
  is an ordinary `Entry` (once per site where it can differ), so sources, TBD and the change log work as everywhere else. Spec
  comparison, markers and open items are computed, never stored. Ids: EXA-001 (assessment), EXL-001 (line), EXR-001 (spec row). The
  gap, risk and TRD links live on the line; "Use in the TRD" writes only typed blanks through the TRD's own edit function. The
  library is account level like the other libraries (`/api/excipient-library`). Demo lines are built by `applyExcipientDemo` in
  `packages/engine/src/demo.ts`, through the same edit functions a person uses.
- **Batch record** (engine `mbr*.ts`, `content/mbr/blocks.yaml`): built from a TRD, a plan, both or blank, never
  dependent on the plan's review. Process view (`mbr-process-view.ts`) is built live from any record.
- **Libraries** (write-ups, MBR blocks, plan subsections, risk methods, saved answers, expected studies): account
  level; static = IndexedDB, server = `/api/...` gated by module; every save a version with history; records keep
  their own copy and are offered "Update from library".
- **Life stage / versions:** one project stage (`packages/engine/src/stage.ts`); stage markers in content adapt the
  wording; a stage change saves a major version with a reason; versions capped (60 / 12 MB).
- Demo product decision: the 12 h total time out of refrigeration counts from the start of filling (per portion) until
  the product is back in refrigerated storage. Demo specifics live in `content/demo/*.yaml` and their tests.

## 5. Stack and checks
- npm workspaces: `packages/process-model`, `packages/engine`, `packages/renderers`, `packages/docx`,
  `packages/sampling`, `packages/risk`, `content/`, `apps/web` (React, Vite, Zustand), `apps/server` (optional).
- Checks before a commit: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, the web e2e suite
  (Playwright, desktop/tablet/phone, axe; serves the last build), `npm run e2e:server`. Latest (2026-11-06,
  `249cdb9`): vitest 2856 (170 files), web e2e 1336 passed / 26 skipped, server e2e 106. Unit tests can time out
  under heavy load: rerun the file alone.
- Parallel Playwright runs need separate `--output` folders. Commit with a message file (`git commit -F <file>`).
- CI (`.github/workflows/deploy.yml`, sharded) runs typecheck, tests, build, e2e and deploys the static demo to
  GitHub Pages on every push to main. `.gitattributes` forces LF, so CRLF warnings are harmless.

## 6. Decisions already made (do not reopen)
- "Exist; update required" procedures map to **new_requirement**; the target value tells them apart.
- Classification CPP / KPP / non-critical; within-range checks use the validated range if present, else the PAR;
  equivalence is exact after unit conversion; severity only, no RPN.
- Closed or accepted gaps still imply their validation activities, marked with the gap status.
- Final revision with TBDs remaining = warn and record (not block); TBD owner and due date are optional.
- Site is the source of truth; Word/PDF is the output for review and approval in the client's own QMS.
- PPQ: every hold/time challenge in every PPQ lot (only batch size is bracketed); no sampling after the sterile
  filter (use filled units). Step numbers in a batch record keep gaps when steps are left out.
- Business direction: subscription with an optional client-side storage mode; enterprise = the server installed on
  the client's own network.

## 7. Planned AI features (last step, not started)
- Template-from-screenshots and document pre-fill, via the self-hosted server only (API key never in the web
  bundle), every AI value marked "to be confirmed" until a human verifies it.
- Controls: per-account `ai` module, quotas, usage log, admin kill switch checked server-side.

## 8. Known limitations
- Qualification status is compared as equal / not equal only; study-quality evidence questions are target-only.
- Self-verification detection relies on typed names.
- Main JS bundle is large (could be code-split later).
- Expected-studies list: any change sends every answered D2 question to "look again", not only the changed entry.
