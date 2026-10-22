import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as stats from "../../src/stats/index";
import { SAMPLING_STATS_VERSION } from "../../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; private?: boolean; dependencies: Record<string, string> };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : []));
}

describe("package independence", () => {
  it("imports only zod, @gap/process-model and its own files", () => {
    const bad: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = m[1] ?? m[2]!;
        if (spec === "zod" || spec === "@gap/process-model" || spec.startsWith("./") || spec.startsWith("../")) continue;
        bad.push(`${file.slice(root.length + 1)} imports "${spec}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the statistics (src/stats) need only zod and their own files", () => {
    for (const file of sourceFiles(join(root, "src", "stats"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) expect(m[1] === "zod" || m[1]!.startsWith("./"), `${file}: ${m[1]}`).toBe(true);
    }
  });

  it("depends on zod and @gap/process-model alone", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@gap/process-model", "zod"]);
  });

  it("keeps SAMPLING_STATS_VERSION equal to package.json", () => {
    expect(SAMPLING_STATS_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe("0.1.0");
  });

  it("is private until it is published on purpose", () => {
    expect(pkg.private).toBe(true);
  });
});

/**
 * Public API snapshot of the statistics. A change here is a change to what the plan code and other tools rely on: update the
 * snapshot together with the version and the CHANGELOG.
 */
describe("public API (statistics)", () => {
  it("exports these names", () => {
    expect(Object.keys(stats).sort()).toMatchInlineSnapshot(`
      [
        "AQL_LEVELS",
        "AQL_VALUES_105E",
        "AQL_VALUES_414",
        "SAMPLING_STATS_VERSION",
        "VAR_LEVELS",
        "aqlCodeLetter",
        "aqlPlan",
        "companySamplingTableSchema",
        "companyTablePlan",
        "confRelPlan",
        "fixedCountPlan",
        "resolveAqlCell",
        "resolveVarCell",
        "validateCompanyTable",
        "varCodeLetter",
        "variablesPlan",
      ]
    `);
  });
});
