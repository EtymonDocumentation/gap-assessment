import type { TemplateRecord } from "@gap/process-model";
import type { DocModel } from "@gap/engine";

export type TemplateMode = "builtin" | "their_look" | "mapped" | "tags";

/** One heading found in a customer template (a Word heading paragraph or a PDF bookmark). */
export interface OutlineHeading {
  /** Position among the headings of the template, from 0. */
  index: number;
  /** 1 for the top level. */
  level: number;
  text: string;
  /** The heading's number, for example "4.1" (worked out from automatic numbering, or read from the PDF text). */
  number?: string;
  /** True when text, a table or a picture follows the heading before the next heading. */
  hasBody: boolean;
}

export interface TemplateAnalysis {
  sourceFormat: "docx" | "dotx" | "docm" | "pdf";
  /** Plain-language list of what was removed, for example "Macros (vbaProject.bin)". */
  stripped: string[];
  /** Word templates only. */
  styles?: {
    headings: { level: number; styleId: string; name: string; numbered: boolean }[];
    normal?: string;
    title?: string;
    table?: string;
    listParagraph?: string;
  };
  page?: { orientation: "portrait" | "landscape"; widthTwips: number; heightTwips: number };
  hasHeader: boolean;
  hasFooter: boolean;
  hasLogo: boolean;
  outline: OutlineHeading[];
  /** Word templates only; present when the template contains at least one tag or a tag problem. */
  tags?: { found: string[]; unknown: string[]; missingRecommended: string[]; errors: string[] };
  usableModes: TemplateMode[];
  warnings: string[];
}

export interface ImportedTemplate {
  /** The sanitised .docx package (or the PDF, unchanged). */
  bytes: Uint8Array;
  /** Hex SHA-256 of the file as uploaded. */
  sha256: string;
  /** Hex SHA-256 of `bytes`. */
  storedSha256: string;
  analysis: TemplateAnalysis;
}

export interface ToolBlock {
  id: string;
  title: string;
}

export interface HeadingMapping {
  /** OutlineHeading.index. */
  headingIndex: number;
  /** ToolBlock ids, in order. */
  blocks: string[];
  /** With blocks: replace or keep the customer's own text under the heading. Without blocks: keep it, or flag the heading as still to be completed. */
  existing: "replace" | "keep" | "flag";
}

export interface TemplateMapping {
  headings: HeadingMapping[];
  unmappedBlocks: "append" | "omit";
}

/**
 * Turns one SVG page of a figure into a PNG at the given resolution. Supplied by the caller so this package stays free of any
 * graphics library: the browser export uses the native canvas (no bundle cost), tests and sample generation use @napi-rs/canvas.
 * The page is `widthPt` x `heightPt` points; the picture must be at least `dpi` dots per inch (pixels = points * dpi / 72).
 */
export type FigureRasteriser = (page: { svg: string; widthPt: number; heightPt: number }, dpi: number) => Promise<Uint8Array>;

/** Resolution of the figure pictures in the Word file. */
export const FIGURE_DPI = 200;

export interface RenderDocxInput {
  doc: DocModel;
  /** Draws the figure pages as pictures. Without it (or if it fails) a figure is its caption and text description, with a warning. */
  rasteriser?: FigureRasteriser;
  /** Needed only for a tagged template (mode "tags"); the built-in look and the other template modes ignore it. */
  tagData?: import("./tags").TagData | import("./tags").DocumentTagData | import("./tags").SamplingTagData;
  mode: TemplateMode;
  /** ISO timestamp; used for the document properties so the output is the same every time. */
  generatedAt: string;
  template?: {
    name: string;
    version: string;
    sha256: string;
    fileName?: string;
    bytes: Uint8Array;
    analysis: TemplateAnalysis;
    mapping?: TemplateMapping;
  };
}

export interface RenderDocxResult {
  bytes: Uint8Array;
  templateRecord: TemplateRecord;
  warnings: string[];
  /** Titles of tool blocks left out because the user chose "omit". */
  omittedBlocks: string[];
}
