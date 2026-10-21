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
    expect(pkg.version).toBe("1.0.0");
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
        "COLLECTION_KINDS",
        "COLLECTION_LABELS",
        "CUSTOM_ITEM_KINDS",
        "CUSTOM_KEY_MAX",
        "CUSTOM_KEY_PREFIX",
        "CatalogError",
        "ImportError",
        "KEY_LABELS",
        "PROCESS_MODEL_VERSION",
        "PathError",
        "SCHEMA_VERSION",
        "SEED_CLASSIFICATIONS",
        "SEED_COLLECTIONS",
        "SEED_STATUSES",
        "SEED_VERIFICATIONS",
        "SYSTEM_ACTOR",
        "SourceError",
        "TRD_SEED_FORMAT",
        "TRD_SEED_VERSION",
        "TrdSeedError",
        "UNITS",
        "UnitError",
        "VerificationError",
        "addSource",
        "allEntries",
        "attachSource",
        "attachSourceMany",
        "catalogProblems",
        "catalogSchema",
        "cleanLocation",
        "clearEntries",
        "compareQuantities",
        "conditionRefs",
        "conditionSchema",
        "contentPathOf",
        "convert",
        "customKeyFromLabel",
        "customSchema",
        "describeVerification",
        "detachSource",
        "docRefKey",
        "docRefLabel",
        "documentStateSchema",
        "emptyCollections",
        "emptyProject",
        "ensureUnitOperation",
        "entrySchema",
        "fingerprintResolved",
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
        "newId",
        "optionSchema",
        "parseProject",
        "parseRef",
        "parseTrdSeed",
        "pathMatches",
        "planVerification",
        "projectSchema",
        "putEntry",
        "quantitiesEqual",
        "quantityRatio",
        "quantityWithin",
        "rangeWithin",
        "rangesEqual",
        "recordersOf",
        "removeSource",
        "resolveEntry",
        "sameName",
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
        "sourceById",
        "sourceUsage",
        "stableStringify",
        "stepScopeSchema",
        "tailoringSchema",
        "toBase",
        "trdSeedSchema",
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
