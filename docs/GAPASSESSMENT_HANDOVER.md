# Gap Assessment Generator: handover (repo copy)

This is the public, cleaned-up handover for any machine or new session. It holds status, decisions and next
steps only. Machine-specific notes (local paths, server addresses, accounts, invite details) are kept in a
private handover outside the repo and must never be copied in here. Read this file, then `README.md`.

Last updated: 2026-10-23. Update this file (no machine-specific details) whenever a milestone lands.

## 1. Where things stand
- **M9 (TRD module) is built and verified, waiting for the product owner's review and commit** (section 5a).
  Before it, the My files page (move files between your own computers through the server, server storage only)
  landed in `a8cbe49`.
- **M8 (risk assessment) is done, with its follow-ups:** `5664b28` plus the follow-up change set (section 5):
  the risk method library edits scales and bands itself, an assessment is told when the library has a newer
  version of its method, and the risk Word output uses the Templates library. Before M8: M7 and its
  sub-milestones M7.1 and M7.2 (section 4) and a sampling polish pass.
- Current versions: project schema 1.16.0, process model 1.6.0, TRD format 1.0.0, risk format 1.0.0, content catalog 1.0.0 (failure
  modes and method load-outs 1.0.0), all other packages 0.1.0.
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

## 6. Stack and checks
- npm workspaces: `packages/process-model`, `packages/engine`, `packages/renderers`, `packages/docx`,
  `packages/sampling`, `packages/risk`, `content/`, `apps/web` (React, Vite, Zustand), `apps/server` (optional self-hosted mode).
- Checks that must all pass before a commit: `npx tsc -p tsconfig.json`, `npx vitest run`, `npm run build`,
  the web e2e suite (Playwright, desktop/tablet/phone projects, axe), `npm run build:server`, `npm run e2e:server`.
  Latest counts (M8 follow-ups): vitest 1818 (90 files), web e2e 572 passed (7 skipped), server e2e 44.
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
