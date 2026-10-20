/**
 * The fictional sample templates in packages/docx/fixtures. The web app imports them with Vite `?url`, for example:
 *
 *   import brightwaterUrl from "../../../packages/docx/fixtures/brightwater-template.docx?url";
 *
 * This list only holds the file names, so a page can show what is available without loading the files.
 * Regenerate the files with: node packages/docx/scripts/make-fixtures.mjs
 */
export const FIXTURE_FILES = {
  template: "brightwater-template.docx",
  tags: "brightwater-tags.docx",
  macro: "brightwater-macro.docm",
  outline: "brightwater-outline.pdf",
} as const;

export type FixtureKey = keyof typeof FIXTURE_FILES;

/** Display names of the fictional samples. */
export const FIXTURE_LABELS: Record<FixtureKey, string> = {
  template: "Brightwater Biologics (fictional): SOP-style template",
  tags: "Brightwater Biologics (fictional): placeholder-tag template",
  macro: "Brightwater Biologics (fictional): macro-enabled template",
  outline: "Brightwater Biologics (fictional): PDF outline",
};
