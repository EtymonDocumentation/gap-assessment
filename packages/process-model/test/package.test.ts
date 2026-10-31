import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as api from "../src/index";
import { catalogSchema, entrySchema, projectSchema, PROCESS_MODEL_VERSION } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; private?: boolean; dependencies: Record<string, string> };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : []));
}

describe("package independence", () => {
  it("imports only zod and its own files", () => {
    const bad: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = m[1] ?? m[2]!;
        if (spec === "zod" || spec.startsWith("./") || spec.startsWith("../")) continue;
        bad.push(`${file.slice(root.length + 1)} imports "${spec}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("reaches outside src only for its own catalog file", () => {
    for (const file of sourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+["'](\.\.\/[^"']+)["']/g)) expect(m[1], file).toBe("../catalog/catalog.yaml");
    }
  });

  it("depends on zod alone", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["zod"]);
  });

  it("keeps PROCESS_MODEL_VERSION equal to package.json", () => {
    expect(PROCESS_MODEL_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe("1.15.0");
  });

  it("is private until it is published on purpose", () => {
    expect(pkg.private).toBe(true);
  });
});

/**
 * Public API snapshot. A change here is a change to what other tools (the TRD and MBR tools) can rely on: adding an export is a
 * minor version, removing or changing one is a major version (see README.md). Update the snapshot together with the version.
 */
describe("public API", () => {
  it("exports these names", () => {
    expect(Object.keys(api).sort()).toMatchInlineSnapshot(`
      [
        "AGENCY_REQUEST_KINDS",
        "AGENCY_REQUEST_STATUSES",
        "BLANK_PATTERN",
        "COLLECTION_KINDS",
        "COLLECTION_LABELS",
        "CUSTOM_ITEM_KINDS",
        "CUSTOM_KEY_MAX",
        "CUSTOM_KEY_PREFIX",
        "CatalogError",
        "ENGINEERING_BATCH_DECISIONS",
        "FILTER_TESTS",
        "FLOW_POSITIONS",
        "HOLD_UNITS",
        "INSPECTIONS",
        "INTERVAL_UNITS",
        "ImportError",
        "KEY_LABELS",
        "MBR_CHOICES",
        "MBR_CHOICE_LABEL",
        "MBR_FORMAT_VERSION",
        "MBR_SAMPLE_MOMENTS",
        "MBR_STUDY_POINT_CHOICE",
        "MBR_TRD_COLLECTIONS",
        "MEMO_LINES",
        "MEMO_LINE_LABEL",
        "MIXING_POSITIONS",
        "PLACEMENT_PATTERN",
        "POINT_AFTER_PPQ",
        "POINT_AFTER_PPQ_LABEL",
        "PPQ_READINESS_ITEMS",
        "PROCESS_MODEL_VERSION",
        "PathError",
        "RANGE_KINDS",
        "READINESS_STATUSES",
        "READINESS_STATUS_LABEL",
        "REPORT_ONLY_CATEGORIES",
        "REPORT_ONLY_TYPES",
        "REPORT_PRESENTATION",
        "REPORT_WHAT",
        "RESPONSIBLE_PARTIES",
        "RETAIN_PURPOSES",
        "RISK_ACCEPTED",
        "RISK_ACTION_STATUSES",
        "RISK_COMBINES",
        "RISK_FORMAT_VERSION",
        "RISK_INTERVENTION_FACTORS",
        "RISK_LMH",
        "RISK_METHODS",
        "RISK_ORIGIN_KINDS",
        "RISK_REVIEW_TRIGGERS",
        "RISK_REVIEW_TRIGGER_LABEL",
        "RUN_TAGS",
        "SAMPLING_CATEGORIES",
        "SAMPLING_METHODS",
        "SAMPLING_PLAN_FORMAT_VERSION",
        "SAMPLING_RUN_TYPES",
        "SAMPLING_TYPES",
        "SAVED_SET_FORMAT",
        "SAVED_SET_FORMAT_VERSION",
        "SCHEMA_VERSION",
        "SEED_CLASSIFICATIONS",
        "SEED_COLLECTIONS",
        "SEED_STATUSES",
        "SEED_VERIFICATIONS",
        "STEP_ORDER_AT_1130",
        "SYSTEM_ACTOR",
        "SourceError",
        "TIME_COMPARATORS",
        "TIME_EDGES",
        "TIMING_OPTIONS",
        "TRD_BASIS_LOADOUTS",
        "TRD_CONTROL_METHODS",
        "TRD_CONTROL_METHOD_LABEL",
        "TRD_DETAIL_KEYS",
        "TRD_DRAWING_IDS",
        "TRD_FORMAT_VERSION",
        "TRD_IMAGES_MAX_TOTAL_BYTES",
        "TRD_IMAGE_LIMIT_TEXT",
        "TRD_IMAGE_MAX_BYTES",
        "TRD_IMAGE_TYPES",
        "TRD_ORIGIN_KINDS",
        "TRD_PART_KINDS",
        "TRD_PART_KIND_LABELS",
        "TRD_SEED_FORMAT",
        "TRD_SEED_VERSION",
        "TRD_SOURCE_DOC_TYPES",
        "TRD_WRITEUP_FORMAT_VERSION",
        "TrdImageError",
        "TrdSeedError",
        "UNITS",
        "UNIT_OP_CUSTOM_STEP",
        "UNIT_OP_FINISHED_PRODUCT",
        "UNIT_OP_NONE",
        "UnitError",
        "VerificationError",
        "WORST_CASES",
        "addSource",
        "agencyRequestSchema",
        "allEntries",
        "attachSource",
        "attachSourceMany",
        "base64ToBytes",
        "batchResultSchema",
        "blanksOf",
        "bytesToBase64",
        "catalogProblems",
        "catalogSchema",
        "categoryToType",
        "cleanLocation",
        "clearEntries",
        "companyTableSnapshotSchema",
        "compareQuantities",
        "conditionRefs",
        "conditionSchema",
        "contentPathOf",
        "convert",
        "customConfigSchema",
        "customKeyFromLabel",
        "customSchema",
        "customSubsectionSchema",
        "describeVerification",
        "designLoadoutSchema",
        "designLoadoutsSchema",
        "detachSource",
        "docRefKey",
        "docRefLabel",
        "documentStateSchema",
        "emptyCollections",
        "emptyProject",
        "ensureUnitOperation",
        "entrySchema",
        "entryValueSchema",
        "failureModeSuggestionSchema",
        "failureModeSuggestionsSchema",
        "fingerprintResolved",
        "fmeaConfigSchema",
        "fnv1a",
        "formatNumber",
        "formatQuantity",
        "formatRange",
        "fullRef",
        "getEntry",
        "isCustomKey",
        "isEntry",
        "isSelfVerification",
        "isValidContentPath",
        "isValidCustomKey",
        "loadCatalog",
        "matrixConfigSchema",
        "mbrBlockSchema",
        "mbrChoiceText",
        "mbrFormSchema",
        "mbrLibraryBlockSchema",
        "mbrLibraryFileSchema",
        "mbrLibraryParamSchema",
        "mbrLibraryTimeLimitSchema",
        "mbrLibraryVersionSchema",
        "mbrParamRowSchema",
        "mbrRecordSchema",
        "mbrSampleRowSchema",
        "mbrSampleSlotSchema",
        "mbrSectionSchema",
        "mbrSplitSchema",
        "mbrStateSchema",
        "mbrStepSchema",
        "mbrTargetSchema",
        "mbrTimeLimitSchema",
        "mbrTrdRefSchema",
        "mixingDesignSchema",
        "mixingRunSchema",
        "newId",
        "optionSchema",
        "parseProject",
        "parseRef",
        "parseSavedAnswerSet",
        "parseTrdSeed",
        "pathMatches",
        "placementSchema",
        "planDesignSchema",
        "planHoldSchema",
        "planPartySchema",
        "planStepSchema",
        "planSubProcessSchema",
        "planTimeTargetSchema",
        "planTimeZeroSchema",
        "planVerification",
        "pointFlowSchema",
        "pointSampleSizeSchema",
        "pointStatisticalBasisSchema",
        "printableUnit",
        "projectSchema",
        "pulledFromAnswer",
        "putEntry",
        "qualitativeConfigSchema",
        "quantitiesEqual",
        "quantityRatio",
        "quantityWithin",
        "rangeSupportSchema",
        "rangeWithin",
        "rangesEqual",
        "readTrdImage",
        "readinessEntrySchema",
        "recordersOf",
        "removeSource",
        "reportOnlyAllowed",
        "reportingSchema",
        "resolveEntry",
        "riskActionSchema",
        "riskApprovalSchema",
        "riskAssessmentSchema",
        "riskBandSchema",
        "riskConfigSchema",
        "riskFactorSchema",
        "riskInterventionSchema",
        "riskItemSchema",
        "riskLevelSchema",
        "riskLoadoutSchema",
        "riskLoadoutsSchema",
        "riskMethodSnapshotSchema",
        "riskOriginSchema",
        "riskReviewSchema",
        "riskScaleSchema",
        "riskScoreSchema",
        "riskStateSchema",
        "runParameterSchema",
        "sameName",
        "samplingAcceptanceSchema",
        "samplingBatchSchema",
        "samplingInputsSchema",
        "samplingOriginSchema",
        "samplingPlanSchema",
        "samplingPointSchema",
        "samplingStateSchema",
        "savedAnswerInputSchema",
        "savedAnswerSchema",
        "savedAnswerSetSchema",
        "seedAnswerSchema",
        "seedFieldSchema",
        "seedItemSchema",
        "seedMetaSchema",
        "seedReferenceSchema",
        "seedScopeSchema",
        "seedSourceSchema",
        "seedUnitOperationSchema",
        "seedValueSchema",
        "sideOfRef",
        "sniffTrdImage",
        "sourceById",
        "sourceUsage",
        "stableStringify",
        "stepScopeSchema",
        "subsectionBlockSchema",
        "subsectionLibraryItemSchema",
        "subsectionOriginSchema",
        "tailoringSchema",
        "toBase",
        "trdApprovalSchema",
        "trdBlankValueSchema",
        "trdControlSchema",
        "trdDocumentSchema",
        "trdFieldSchema",
        "trdImageMeta",
        "trdImageSchema",
        "trdImageSize",
        "trdImageUrl",
        "trdItemSchema",
        "trdLibraryFileSchema",
        "trdLibraryPartSchema",
        "trdLibraryVersionSchema",
        "trdLibraryWriteupSchema",
        "trdLimitsSchema",
        "trdOriginSchema",
        "trdOverrideSchema",
        "trdPartSchema",
        "trdPlacementSchema",
        "trdPulledSchema",
        "trdRangeSchema",
        "trdSeedSchema",
        "trdSetPointSchema",
        "trdStateSchema",
        "trdStepSchema",
        "trdWriteupSchema",
        "typeDetailSchema",
        "unitDef",
        "unitsForDimension",
        "unverifyEntry",
        "updateSource",
        "verificationProblem",
        "verificationState",
        "verifyEntries",
        "verifyEntry",
      ]
    `);
  });

  it("Entry, Source and catalog keep their JSON-schema shape", () => {
    const shape = (j: { properties?: Record<string, unknown>; required?: string[] }) => ({ properties: Object.keys(j.properties ?? {}).sort(), required: [...(j.required ?? [])].sort() });
    const json = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, unknown>; required?: string[] };
    expect(shape(json(entrySchema))).toMatchInlineSnapshot(`
      {
        "properties": [
          "id",
          "justification",
          "path",
          "recordedAt",
          "recordedBy",
          "revision",
          "sameAsSource",
          "sourceIds",
          "sourceLocations",
          "status",
          "tbd",
          "value",
          "verification",
        ],
        "required": [
          "id",
          "path",
          "recordedAt",
          "recordedBy",
          "revision",
          "sourceIds",
          "status",
        ],
      }
    `);
    const project = json(projectSchema) as { properties: { sources: { items: { properties: Record<string, unknown>; required?: string[] } } } };
    expect(shape(project.properties.sources.items)).toMatchInlineSnapshot(`
      {
        "properties": [
          "date",
          "docRef",
          "file",
          "id",
          "label",
          "responder",
          "supersededBy",
          "type",
        ],
        "required": [
          "date",
          "id",
          "label",
          "type",
        ],
      }
    `);
    expect(shape(json(catalogSchema))).toMatchInlineSnapshot(`
      {
        "properties": [
          "catalog",
          "fieldLabels",
          "optionSets",
          "stageGroups",
          "unitOperations",
        ],
        "required": [
          "catalog",
          "fieldLabels",
          "optionSets",
          "stageGroups",
          "unitOperations",
        ],
      }
    `);
  });
});
