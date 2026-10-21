import { buildContent, parseGuidance, type ContentBundle, type GuidanceLibrary, type RawContent } from "@gap/engine";
import { catalog } from "@gap/process-model/catalog";
import catalogOverlay from "./catalog/gap-overlay.yaml";
import demoArx217 from "./demo/arx-217.yaml";
import guidanceRaw from "./guidance/guidance.yaml";
import q00 from "./questions/00-scoping-and-site.yaml";
import q05 from "./questions/05-ds-shipping-inbound.yaml";
import q10 from "./questions/10-ds-receipt-thaw.yaml";
import q15 from "./questions/15-buffer-prep.yaml";
import q20 from "./questions/20-compounding.yaml";
import q25 from "./questions/25-bbr-filtration.yaml";
import q30 from "./questions/30-sterile-filtration.yaml";
import q40 from "./questions/40-aseptic-filling.yaml";
import q45 from "./questions/45-stoppering.yaml";
import q50 from "./questions/50-lyophilization.yaml";
import q60 from "./questions/60-capping.yaml";
import q70 from "./questions/70-visual-inspection.yaml";
import q75 from "./questions/75-bulk-packaging.yaml";
import q80 from "./questions/80-labeling-packaging.yaml";
import q90 from "./questions/90-storage-shipping.yaml";
import rules from "./rules/rules.yaml";
import templates from "./templates/gap-assessment.yaml";

/** Raw parsed YAML, keyed by file name so validation errors name the file. */
export const rawContent: RawContent = {
  // The shared catalog comes from the process-model package (validated when it loads); buildContent checks it again together
  // with the questions and rules, so a bad pairing is reported by file.
  catalog,
  catalogOverlay,
  questionFiles: {
    "questions/00-scoping-and-site.yaml": q00,
    "questions/05-ds-shipping-inbound.yaml": q05,
    "questions/10-ds-receipt-thaw.yaml": q10,
    "questions/15-buffer-prep.yaml": q15,
    "questions/20-compounding.yaml": q20,
    "questions/25-bbr-filtration.yaml": q25,
    "questions/30-sterile-filtration.yaml": q30,
    "questions/40-aseptic-filling.yaml": q40,
    "questions/45-stoppering.yaml": q45,
    "questions/50-lyophilization.yaml": q50,
    "questions/60-capping.yaml": q60,
    "questions/70-visual-inspection.yaml": q70,
    "questions/75-bulk-packaging.yaml": q75,
    "questions/80-labeling-packaging.yaml": q80,
    "questions/90-storage-shipping.yaml": q90,
  },
  ruleFiles: { "rules/rules.yaml": rules },
  templates,
};

/** Validated content bundle. Throws ContentError at load if any file is invalid. */
export const content: ContentBundle = buildContent(rawContent);

/** Raw demo scripts; build with buildDemoProject(content, raw). */
export const demos = { "arx-217": demoArx217 } as const;

/**
 * The Guidance library (links to official regulatory text). Reference material: it is not part of the question and rule
 * content, needs no project, and is validated here so a bad link or an unknown topic stops the build.
 */
export const guidance: GuidanceLibrary = parseGuidance(guidanceRaw);
