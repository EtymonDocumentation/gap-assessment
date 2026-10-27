# Changelog

All notable changes to `@gap/process-model`. Versions follow semver; see README.md for what counts as breaking.

## 1.13.0

Project schema 1.22.0 (unchanged), catalog 1.9.0 (unchanged), questions 1.8.0 (unchanged). Additive: the step-blocks library file (not the project) gains one optional field.

### Added
- `MBR_SAMPLE_MOMENTS`, `MbrSampleMoment`, `mbrSampleSlotSchema`, `MbrSampleSlot`: a library block may list `sampleSlots` (a moment, a place in the block and a step text). The engine
  puts a sampling step at that place when the sampling plan has sample points of that moment, so a sample is taken where it is due and not in one table step after the work.
- Library file 1.2.0 (content/mbr/blocks.yaml): new versions of the receipt and thaw, pooling, dilution, bioburden-reduction filtration, sterile filtration, filter integrity test,
  filling, plunger stopper placement, bulk packing, labelling, time-out-of-refrigeration, storage and shipment and sample-table blocks, and new blocks for in-line sterile filtration,
  the stopper placement set-up and the portion definition. The earlier versions stay in each block's history.
- Hold samples are taken at the end of the hold: the sample slots of the bioburden-reduction filtration block say "take the sample at the end of the hold, in the step that ends the hold"
  (no fixed hour), and the receipt and thaw block starts the ambient clock at the end of the thaw (the thaw has its own limit).
- TRD write-up library (content/trd-writeups/writeups.yaml): "Overall process parameters" is version 4 (a note: after PPQ the PAR of a hold or time limit is the most conservative, lowest, value
  achieved across the PPQ lots, not the full tested range) and "Receipt and storage, and thawing" is version 4 (the ambient time starts at the end of the thaw).

## 1.12.0

Project schema 1.22.0, catalog 1.9.0, questions 1.8.0. Additive in the type and the schema; the catalog changes are described below. Nothing was removed.

### Added
- `TRD_DRAWING_IDS`, `TrdDrawingId`: a library figure part may name a standard drawing (`drawing`), shown until the author attaches a picture.
- Catalog items (parameters, all with set point / NOR / PAR like any parameter): `ds_receipt_thaw.max_cold_hold`, `bbr_filtration.max_cold_hold`,
  `visual_inspection.max_time_out_of_refrigeration`, `storage_shipping.max_total_time_out_of_refrigeration`. New target-side questions
  `rt.cold_hold`, `bbr.cold_hold`, `vi.time_out`, `ss.total_tor` bind them.
- Shipper options `dry_ice_shipper` and `dry_vapour_shipper` (the dry-vapour liquid-nitrogen shipper).
- Demo answers may be not applicable (`notApplicable` with a justification).
- Migration 1.21.0 -> 1.22.0: version only.

### Changed
- The label of `aseptic_filling.max_interventions` is "Interventions". The shipper option `dry_shipper_frozen` is kept for projects that chose it,
  and now reads "Dry-vapour or dry-ice shipper (type not specified)". Labels with "100%" read "100 %". No item key was renamed or removed.

## 1.11.0

Project schema 1.21.0. The TRD export is two documents: the short standard TRD (`trd-docx`, `trd-html`) and the evidence record (`trd-evidence-docx`, `trd-evidence-html`). Additive: nothing was removed.

### Added
- Export formats `trd-evidence-docx` and `trd-evidence-html`.
- `printableUnit` (the unit "count" is never printed); `formatRange` writes "-80 to -65 °C" when an end is negative.
- Catalog 1.8.0: prefilled syringe and cartridge container formats (options only), the PUPSIT label "Pre-use, post-sterilization integrity test (PUPSIT)".
- Migration 1.20.0 -> 1.21.0: version only.

## 1.10.0

TRD format 1.2.0, write-up library format 1.1.0 (project schema 1.20.0). Additive: nothing was removed, and a TRD without pictures, rows or a moved write-up is unchanged.

### Added
- Pictures in figures: `trdImageSchema` (PNG or JPEG, base64, at most 2 MB), `TRD_IMAGE_MAX_BYTES`, `TRD_IMAGES_MAX_TOTAL_BYTES` (10 MB per TRD), `TRD_IMAGE_TYPES`,
  and `readTrdImage`, `sniffTrdImage`, `trdImageSize`, `trdImageMeta`, `trdImageUrl`, `bytesToBase64`, `base64ToBytes`, `TrdImageError`, `TRD_IMAGE_LIMIT_TEXT`.
  A TRD part has an optional `image`; a figure part (library and TRD) has an optional `caption` and `alt`.
- `placementEdited` on a TRD write-up: the author moved it, so "Update from library" keeps its place.
- Table parts keep `rows` that the author typed (the field existed; the TRD editor now writes it).
- The label of the figure part kind is "Figure" (was "Figure placeholder").
- Migration 1.19.0 -> 1.20.0: version only.

## 1.9.0

TRD format 1.1.0, write-up library format 1.0.0 (project schema 1.19.0). Additive: nothing was removed, and a TRD without `writeups` is unchanged.

### Added
- TRD write-ups (`trdDocument.writeups`, WU-nn): a process description per TRD step and the TRD-level prose sections, kept as ordered parts
  with optional (switched-off) parts, blanks written `{{key|Label}}`, values typed for a blank, and the library entry and version each was
  copied from. Library schemas: `trdLibraryWriteupSchema`, `trdLibraryFileSchema`.
- Migration 1.18.0 -> 1.19.0: version only.

## 1.8.0

MBR format 1.0.0 (project schema 1.18.0). Additive: nothing was removed, and a project without `mbr` migrates to an empty one.

### Added
- Master batch records (`project.mbr.records`, MBR-nnn): sections per unit operation, blocks with computed step numbers, parameter rows
  (TRD value copied with its source, MBR value, a never-preselected choice, optional reason and study-point marker), two-level time
  limits, sample rows from the sampling plan and "to be completed by the CMO" labels.
- The step-blocks library shapes (`mbrLibraryBlockSchema`, versioned with history), MBR_CHOICES, MBR_CHOICE_LABEL, MBR_FORMAT_VERSION.
- Export formats "mbr-docx" and "mbr-html" in the document export record.
- Migration 1.17.0 -> 1.18.0: adds an empty `mbr`.

## 1.7.0

Sampling plan format 1.4.0 (project schema 1.17.0). Additive: nothing was removed, and a plan without the new fields is still valid and loads unchanged.

### Added
- Optional flow-figure data on a sampling plan (M10): steps gain `figureText`, `durationHours` and `subProcess`; the plan gains
  `holds` (HD-nn), `timeTargets` (TT-nn), `subProcesses` (SB-nn) and `timeZero`; a point gains `takenAtHour` and `flow.holdId`.
  Nothing is required or defaulted; missing hours are a normal state. Only reference integrity is checked (an id must exist).
- planHoldSchema, planTimeTargetSchema, planSubProcessSchema, planTimeZeroSchema, TIME_EDGES, TIME_COMPARATORS.
- Migration 1.16.0 -> 1.17.0: only the version moves.

## 1.6.0

Sampling plan format 1.3.0 (project schema 1.16.0). Additive: nothing was removed, and a party without the new fields is still valid.

### Added
- `planPartySchema` gains two optional fields: `department` (free text, for a team member's unit) and `memoLine` ("from", "to" or
  "cc"). Neither is required, defaulted or validated; they exist so a Word template can fill the From / To / Cc lines of a memorandum.
- MEMO_LINES, MemoLine and MEMO_LINE_LABEL.
- Migration 1.15.0 -> 1.16.0: only the version moves (the new fields are absent from every stored party).

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
