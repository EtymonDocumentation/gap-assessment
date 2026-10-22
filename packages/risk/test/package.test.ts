import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "../src/index";
import { RISK_SCORING_VERSION } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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

  it("depends on zod and @gap/process-model alone", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@gap/process-model", "zod"]);
  });

  it("keeps RISK_SCORING_VERSION equal to package.json", () => {
    expect(RISK_SCORING_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe("0.1.0");
  });

  it("is private until it is published on purpose", () => {
    expect(pkg.private).toBe(true);
  });
});

describe("public API", () => {
  it("exports these names", () => {
    expect(Object.keys(api).sort()).toMatchInlineSnapshot(`
      [
        "METHOD_LABEL",
        "RISK_SCORING_VERSION",
        "bandProblems",
        "bandsFor",
        "configProblems",
        "describeAnswers",
        "describeMethod",
        "factorColumns",
        "heatCounts",
        "scoreCustom",
        "scoreFmea",
        "scoreIsEmpty",
        "scoreItem",
        "scoreMatrix",
        "scoreQualitative",
        "scoreRange",
      ]
    `);
  });
});
