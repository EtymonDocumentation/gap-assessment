# Gap Assessment Generator: handover (repo copy)

This is the public, cleaned-up handover for any machine or new session. It holds status, decisions and next
steps only. Machine-specific notes (local paths, server addresses, accounts, invite details) are kept in a
private handover outside the repo and must never be copied in here. Read this file, then `README.md`.

Last updated: 2026-10-22. Update this file (no machine-specific details) whenever a milestone lands.

## 1. Where things stand
- **M7 (PPQ sampling plan) is done:** `7228bea`, plus layout fixes `9ce5b3d` (header menu may wrap at 901 px
  and up, because 13 menu entries in wider Linux fonts pushed the theme picker off-screen) and `1153afe`
  (clear-nav e2e scrolls to top before its axe scan, because the sticky "answering from" bar covered a link
  after focus returned). CI green, deployed to the self-hosted server.
- Open idea from that fix: the sticky "answering from" bar can cover content after a dialog returns focus;
  a product-side fix (e.g. scroll-margin on focus targets) may be worth doing later.
- **NEXT:** wait for the product owner's next milestone choice.
- Remaining suite modules to choose from: risk assessment, excipient assessment, TRD generator, MBR templates.
  AI features are deliberately the very last step.

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

## 4. M7 sampling plan (latest)
- Scope chosen by the product owner: PPQ runs only for now; all five sample-size methods (MIL-STD-105E / ANSI
  Z1.4 attributes, MIL-STD-414 variables, confidence/reliability, company lot-size table as a first-class
  method, enter your own); points seeded from the project and added free-form (report-only allowed); Word +
  HTML output now, CSV and sample labels later.
- Packages: `packages/sampling` (statistics; 105E and 414 tables cross-checked against a second source, 0
  mismatches), process-model 1.1.0, project schema 1.11.0, `content/sampling` suggestion catalog, engine
  `sampling*.ts`, web Sampling + Sampling tables pages, module `sampling` checked server-side.
- Known limits: no 105E double sampling; no 414 range method, known-variability plans or split AQL; 414 table
  B-3 column .04 has a single source; CPP-based suggestion dormant until RU parameters carry a CPP classification.

## 5. Stack and checks
- npm workspaces: `packages/process-model`, `packages/engine`, `packages/renderers`, `packages/docx`,
  `packages/sampling`, `content/`, `apps/web` (React, Vite, Zustand), `apps/server` (optional self-hosted mode).
- Checks that must all pass before a commit: `npx tsc -p tsconfig.json`, `npx vitest run`, `npm run build`,
  the web e2e suite (Playwright, desktop/tablet/phone projects, axe), `npm run build:server`, `npm run e2e:server`.
  Latest counts (M7): vitest 1607, web e2e 383, server e2e 40.
- Parallel Playwright runs need separate `--output` folders.
- Commit with a message file (`git commit -F <file>`); CI (`.github/workflows/deploy.yml`) runs typecheck,
  tests, build, e2e and deploys the static demo to GitHub Pages on every push to main.
- `.gitattributes` forces LF, so CRLF warnings on commit are harmless.

## 6. Decisions already made (do not reopen)
- "Exist; update required" procedures map to **new_requirement**; the target value tells them apart.
- Classification CPP / KPP / non-critical; within-range checks use the validated range if present, else the PAR;
  equivalence is exact after unit conversion; severity only, no RPN.
- Closed or accepted gaps still imply their validation activities, marked with the gap status.
- Final revision with TBDs remaining = warn and record (not block); TBD owner and due date are optional.
- Site is the source of truth; Word/PDF is the output for review and approval in the client's QMS.
- Business direction: subscription with an optional client-side (confidential) storage mode; enterprise =
  the server installed on the client's own network.

## 7. Planned AI features (last step, not started)
- Template-from-screenshots and document pre-fill, via the self-hosted server only (API key never in the web
  bundle), every AI value marked "to be confirmed" until a human verifies it.
- Controls: per-account `ai` module, quotas, usage log, admin kill switch checked server-side.

## 8. Known limitations
- Qualification status is compared as equal / not equal only.
- Study-quality evidence questions are target-only.
- Self-verification detection relies on typed names.
- Main JS bundle is large (could be code-split later).
