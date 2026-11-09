import type { DesignLoadouts, FailureModeSuggestions, MbrLibraryBlock, RiskLoadouts, TrdLibraryWriteup } from "@gap/process-model";
import { buildContent, parseFailureModes, parseGuidance, parseMbrLibrary, parseTrdWriteupLibrary, parseDesignLoadouts, parseRiskLoadouts, parseSamplingSuggestions, parseSamplingImportSynonyms, parseGapImportSynonyms, parseTrdSynonyms, parseTrdInterviewWording, parseExcipientClasses, parseExcipientWording, type GapImportSynonyms, type SamplingImportSynonyms, type TrdSynonyms, type ContentBundle, type GuidanceLibrary, type RawContent, type SamplingSuggestions } from "@gap/engine";
import { catalog } from "@gap/process-model/catalog";
import catalogOverlay from "./catalog/gap-overlay.yaml";
import demoArx217 from "./demo/arx-217.yaml";
import demoSyr305 from "./demo/syr-305.yaml";
import glossaryRaw from "./help/glossary.yaml";
import toursRaw from "./help/tours.yaml";
import guidanceRaw from "./guidance/guidance.yaml";
import trdInterviewWordingRaw from "./trd-interview/wording.yaml";
import excipientClassesRaw from "./excipient/classes.yaml";
import excipientWordingRaw from "./excipient/wording.yaml";
import { parseGlossary, parseTours } from "./help";
import mbrBlocksRaw from "./mbr/blocks.yaml";
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
import failureModesRaw from "./risk/failure-modes.yaml";
import riskLoadoutsRaw from "./risk/method-loadouts.yaml";
import rules from "./rules/rules.yaml";
import designLoadoutsRaw from "./sampling/design-loadouts.yaml";
import ppqSuggestionsRaw from "./sampling/ppq-suggestions.yaml";
import templates from "./templates/gap-assessment.yaml";
import trdImportSynonymsRaw from "./trd-import/synonyms.yaml";
import gapImportSynonymsRaw from "./gap-import/synonyms.yaml";
import samplingImportSynonymsRaw from "./sampling-import/synonyms.yaml";
import trdWriteupsRaw from "./trd-writeups/writeups.yaml";

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
export const demos = { "arx-217": demoArx217, "syr-305": demoSyr305 } as const;

/**
 * The Guidance library (links to official regulatory text). Reference material: it is not part of the question and rule
 * content, needs no project, and is validated here so a bad link or an unknown topic stops the build.
 */
export const guidance: GuidanceLibrary = parseGuidance(guidanceRaw);

/**
 * Options for the PPQ sampling plan: common sampling candidates per unit operation. Options only (no sizes, criteria or methods;
 * the schema refuses them). Validated here against the unit operations of the catalog, so a misspelt step stops the build.
 */
export const samplingSuggestions: SamplingSuggestions = parseSamplingSuggestions(
  ppqSuggestionsRaw,
  content.catalog.unitOperations.map((u) => u.key),
);

/** Presets for the optional study design of a mixing point. The user applies one, then edits or ignores it; no value is supplied. */
export const designLoadouts: DesignLoadouts = parseDesignLoadouts(designLoadoutsRaw);

/** Presets for the risk assessment METHOD (FMEA, matrix, qualitative). The user picks one, then edits or ignores it; there is no default method. */
export const riskLoadouts: RiskLoadouts = parseRiskLoadouts(riskLoadoutsRaw);

/**
 * Typical failure modes per unit operation, offered as suggestions (nothing is added by itself, and none carries a score).
 * Validated here against the catalog's unit operations and the Guidance library, so a misspelt step or reference stops the build.
 */
export const failureModes: FailureModeSuggestions = parseFailureModes(
  failureModesRaw,
  content.catalog.unitOperations.map((u) => u.key),
  guidance.items.map((g) => g.id),
);

/**
 * The shipped step-blocks library for the master batch record (own neutral wording). Offers only: a record gets a block when the author
 * ticks it. Checked here against the catalog's unit operations, so a misspelt step key stops the build.
 */
export const mbrLibrary: MbrLibraryBlock[] = (() => {
  const file = parseMbrLibrary(mbrBlocksRaw);
  const keys = new Set(content.catalog.unitOperations.map((u) => u.key));
  const ids = new Set<string>();
  for (const b of file.blocks) {
    if (ids.has(b.id)) throw new Error(`mbr/blocks.yaml: duplicate block id "${b.id}"`);
    ids.add(b.id);
    for (const u of b.unitOps) if (!keys.has(u)) throw new Error(`mbr/blocks.yaml: block "${b.id}" names unknown unit operation "${u}"`);
  }
  return file.blocks;
})();

/**
 * The shipped TRD write-up library (process descriptions per unit operation and the TRD-level prose, own neutral wording). Offers only:
 * a TRD gets a copy when it is created or when the author adds one, and the copy is the author's to edit. Checked here against the
 * catalog's unit operations, so a misspelt step key stops the build.
 */
export const trdWriteups: TrdLibraryWriteup[] = parseTrdWriteupLibrary(
  trdWriteupsRaw,
  content.catalog.unitOperations.map((u) => u.key),
).writeups;

/**
 * The words the fixed-rule reader recognises in a TRD written by somebody else (upload, level 3). Words to recognise, never answers.
 * Checked here against the catalog, so a misspelt step or parameter key stops the build.
 */
export const trdImportSynonyms: TrdSynonyms = parseTrdSynonyms(
  trdImportSynonymsRaw,
  content.catalog.unitOperations.flatMap((u) => u.items.filter((i) => i.coll === "param").map((i) => ({ uo: u.key, key: i.key }))),
  content.catalog.unitOperations.map((u) => u.key),
);

/** The short guided tour of each main page (see apps/web/src/tour.tsx). Text only: each step names the data-tour anchor it points at. */
export const tours = parseTours(toursRaw);

/** The glossary page: plain-language definitions, alphabetical. */
export const glossary = parseGlossary(glossaryRaw);

export type { GlossaryTerm, Tour, TourStep } from "./help";

/**
 * The words the fixed-rule reader recognises in a sampling plan written by somebody else (upload, level 3). Words to recognise,
 * never answers. Checked here against the catalog, so a misspelt step key stops the build.
 */
export const samplingImportSynonyms: SamplingImportSynonyms = parseSamplingImportSynonyms(
  samplingImportSynonymsRaw,
  content.catalog.unitOperations.map((u) => u.key),
);

/** The words the fixed-rule reader recognises in a gap assessment written by somebody else (upload, level 3). Words to recognise, never answers. */
export const gapImportSynonyms: GapImportSynonyms = parseGapImportSynonyms(
  gapImportSynonymsRaw,
  { questions: content.questions.map((q) => q.id), sections: content.sections.map((x) => x.id) },
);

/** Wording of the TRD interview ("Answer questions" tab); content/trd-interview/wording.yaml, versioned on its own. */
export const trdInterviewWording = parseTrdInterviewWording(trdInterviewWordingRaw);

/** Classes of excipient, with the tests teams often compare and the topics they often look at (options only); content/excipient/classes.yaml. */
export const excipientClasses = parseExcipientClasses(excipientClassesRaw);

/** Wording of the Excipient assessment interview and of its change-risk markers; content/excipient/wording.yaml, versioned on its own. */
export const excipientWording = parseExcipientWording(excipientWordingRaw);
