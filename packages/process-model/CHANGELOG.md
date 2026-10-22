# Changelog

All notable changes to `@gap/process-model`. Versions follow semver; see README.md for what counts as breaking.

## 1.1.0

PPQ sampling plans. Additive: nothing was removed or re-meant.

### Added
- The sampling plan data shapes (src/sampling.ts): samplingPlanSchema, samplingPointSchema, samplingBatchSchema,
  samplingStateSchema, companyTableSnapshotSchema, samplingInputsSchema, atchResultSchema and their types, the option
  lists (SAMPLING_METHODS, SAMPLING_CATEGORIES, TIMING_OPTIONS, ...) and eportOnlyAllowed(). No field has a default: a
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
