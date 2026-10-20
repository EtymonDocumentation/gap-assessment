import { buildContent, type ContentBundle, type RawContent } from "@gap/engine";
import catalog from "./catalog/catalog.yaml";
import demoArx217 from "./demo/arx-217.yaml";
import q00 from "./questions/00-scoping-and-site.yaml";
import q20 from "./questions/20-compounding.yaml";
import q30 from "./questions/30-sterile-filtration.yaml";
import q40 from "./questions/40-aseptic-filling.yaml";
import q60 from "./questions/60-capping.yaml";
import rules from "./rules/rules.yaml";
import templates from "./templates/gap-assessment.yaml";

/** Raw parsed YAML, keyed by file name so validation errors name the file. */
export const rawContent: RawContent = {
  catalog,
  questionFiles: {
    "questions/00-scoping-and-site.yaml": q00,
    "questions/20-compounding.yaml": q20,
    "questions/30-sterile-filtration.yaml": q30,
    "questions/40-aseptic-filling.yaml": q40,
    "questions/60-capping.yaml": q60,
  },
  ruleFiles: { "rules/rules.yaml": rules },
  templates,
};

/** Validated content bundle. Throws ContentError at load if any file is invalid. */
export const content: ContentBundle = buildContent(rawContent);

/** Raw demo scripts; build with buildDemoProject(content, raw). */
export const demos = { "arx-217": demoArx217 } as const;
