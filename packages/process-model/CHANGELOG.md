# Changelog

All notable changes to `@gap/process-model`. Versions follow semver; see README.md for what counts as breaking.

## 1.5.0

TRD format 1.0.0 (project schema 1.15.0). Additive: nothing was removed, and a project without `trd` migrates to an empty one.

### Added
- `project.trd.documents` (trdStateSchema): editable technology transfer documents (TRD-001 ...). Each field keeps the value
  as it came in (`pulled`, the seed field) apart from the user's `override`; items carry optional set point, NOR and PAR with
  source citations; steps carry the user's description. Origin: project, seed import or blank.
- TRD_FORMAT_VERSION, TRD_BASIS_LOADOUTS and TRD_SOURCE_DOC_TYPES (suggestions only; the source document type stays free text).
- Export formats `trd-docx` and `trd-html`.
- Migration 1.14.0 -> 1.15.0: adds `trd: { documents: [] }`.

## 1.4.0

Risk assessment format 1.0.0 (project schema 1.14.0). Additive: nothing was removed, and a project without `risk` migrates to an
empty one.

### Added
- `project.risk.assessments` (riskStateSchema): ICH Q9(R1) risk assessments, one method each (FMEA, matrix, user-defined,
  qualitative), with items (RA-001 ...), actions (AC-001 ...), the assessment's own process steps and optional approvals.
- Method configs (`riskConfigSchema`), saved-method snapshot (`riskMethodSnapshotSchema`), load-out and failure-mode catalog
  schemas, RISK_FORMAT_VERSION, RISK_METHODS, RISK_COMBINES, RISK_ACTION_STATUSES.
- Export formats `risk-assessment-docx` and `risk-assessment-html`.
- Migration 1.13.0 -> 1.14.0: adds `risk: { assessments: [] }`.

## 1.3.0

Sampling plan format 1.2.0 (project schema 1.13.0). The plan gets its own process steps and a point can be placed on one of
them. Additive in meaning (a minor bump): nothing was removed, and a plan without steps is still a valid plan.

### Added
- `plan.steps` (planStepSchema): the plan's own process steps, in process order, each with an id (ST-01 ...), an optional catalog
  unit-operation key, a label and optional notes. Separate from the gap assessment's Scope: the plan starts as a one-time copy and
  then neither side changes the other.
- `point.flow` (pointFlowSchema): the step a point sits on and an optional position (before / during / after, FLOW_POSITIONS). No
  `flow` means "Not on the diagram", which is a normal state. A point whose flow names a step that is not in the plan is refused.
- UNIT_OP_CUSTOM_STEP ("custom_step"): the `unitOp` of a point that sits on a custom step, so code that reads `unitOp` keeps working.
- Migration 1.12.0 -> 1.13.0: steps are built from the unit operations the plan's points already use, in process order; each such
  point is placed on its step with the position NOT set (never guessed); the conversion is written to the change log.
- STEP_ORDER_AT_1130: the process order and labels the migration used (frozen; the migration cannot read the catalog).

## 1.2.0

Sampling plan format 1.1.0 (project schema 1.12.0). A sampling point's `category` is replaced by `type` (a minor bump because
the sampling shapes are new in 1.1.0 and the migration converts stored data).

### Added
- Study types (SAMPLING_TYPES, REPORT_ONLY_TYPES, reportOnlyAllowed(type), categoryToType()), responsible party, type-specific
  detail groups (typeDetailSchema), reporting instructions fields (reportingSchema), agency requests (agencyRequestSchema),
  custom subsections (customSubsectionSchema, subsectionBlockSchema, subsectionLibraryItemSchema) and plan parties.
- Optional mixing study design (mixingDesignSchema: free approach label, runs, range support with kind PAR / NOR / other / unset) and design load-outs (designLoadoutsSchema). Nothing in it is required or checked.
- Export history kinds sampling-cmo-instructions-docx and sampling-cmo-instructions-html.
- Migration 1.11.0 -> 1.12.0: category becomes type; "routine in-process / release" becomes no type (written to the change log);
  plans gain empty parties, agencyRequests and subsections.

### Removed
- samplingPointSchema no longer has category / categoryLabel (SAMPLING_CATEGORIES and REPORT_ONLY_CATEGORIES stay for readers of old files).

## 1.1.0

PPQ sampling plans. Additive: nothing was removed or re-meant.

### Added
- The sampling plan data shapes (src/sampling.ts): samplingPlanSchema, samplingPointSchema, samplingBatchSchema,
  samplingStateSchema, companyTableSnapshotSchema, samplingInputsSchema, atchResultSchema and their types, the option
  lists (SAMPLING_METHODS, SAMPLING_CATEGORIES, TIMING_OPTIONS, ...) and 
eportOnlyAllowed(). No field has a default: a
  missing input makes a point incomplete. "Report only" is refused by the schema for routine, release and enhanced PPQ points.
- Project schema 1.11.0: project.sampling.plans. Migration 1.10.0 -> 1.11.0 adds an empty list.
- Export history records may be of kind sampling-plan-docx or sampling-plan-html and ersions may carry stats and suggestions.

## 1.0.0

First stable version. The package was 0.1.0 and held the project types, schemas, entries, sources and units. It is now the shared
process model that other tools can build on.

### Added
- The unit-operation catalog: `catalogSchema`, `Catalog`, `loadCatalog()`, `catalogProblems()`, `CatalogError`, and the validated
  `catalog` object at `@gap/process-model/catalog`. The catalog data moved here from `content/catalog/catalog.yaml`
  (catalog version 1.7.0, unchanged: stage groups, unit operations with items and topics, field labels, option sets).
- The condition language of the catalog (`conditionSchema`, `Condition`, `optionSchema`, `conditionRefs()`), moved from the gap engine.
- The TRD seed format `gap-assessment.trd-seed` 1.0.0: `trdSeedSchema`, `parseTrdSeed()`, `TrdSeedError` and the field, item,
  unit operation and source schemas it is made of. The schema enforces the no-defaults rules.
- `PROCESS_MODEL_VERSION`.
- Export history records may be of kind `trd-seed-json`, `trd-outline-docx` or `trd-outline-html` and may carry `versions`
  (process model, catalog and seed format). This is additive: the project schema stays at 1.10.0, and an older build that meets
  such a record refuses the file instead of guessing.
- `README.md`, a `build` script (`dist/`, not committed), `exports`, `files` and `publishConfig` so the package can be published
  later. It stays `private: true`.
- Tests: the sources may import only `zod` and the package's own files; a snapshot of the public API (exported names and the
  shape of Entry, Source and the catalog); the version equals `package.json`.

### Changed
- Gap-assessment-only catalog data (validation activities and comparison categories) is no longer part of the catalog. It lives
  in `content/catalog/gap-overlay.yaml` (overlay version 1.0.0) and is merged with the catalog by the gap engine.

### Removed
- Nothing was removed from the public API of 0.1.0.
