/**
 * What every "upload a finished document" feature shares (TRD: jobs I1 and I2; sampling plan: job I3): the document as the reader hands
 * it over, the words used on the review screen, the table-as-a-grid view, header-word matching, the upload file rules and the summary
 * sentence. Nothing here knows what a TRD or a sampling plan is, so the next document type (the gap assessment) can use it unchanged.
 *
 * The rules that hold for every kind of upload live in the modules that use this one: every match is a suggestion, nothing is
 * defaulted, units are never converted, and what is not accepted stays open.
 */

export const norm = (s: string | undefined) => (s ?? "").replace(/[\s ]+/g, " ").trim();

// ------------------------------------------------------------------ the document as read

/** The document as read, for the left pane. */
export type ViewBlock =
  | { kind: "heading"; level: number; text: string; page?: number }
  | { kind: "para"; text: string; page?: number }
  | { kind: "table"; rows: ViewCell[][]; page?: number };
export interface ViewCell {
  text: string;
  /** The field id of the content control in this cell (the form). */
  controlId?: string;
  /** A merged cell: how many columns it spans (Word gridSpan). Absent = 1. */
  colSpan?: number;
  /** The first cell of a vertical merge: how many rows it spans. */
  rowSpan?: number;
  /** The continuation of a vertical merge (Word vMerge): it has no text of its own; the cell above covers it. */
  vContinue?: boolean;
}

export interface WordTable {
  /** Index of the table in the view blocks. */
  blockIndex: number;
  /** Rows of cell text; the first row is the header. */
  rows: string[][];
}

/** What the file reader hands over. It knows Word and PDF; the review model of each document type knows its own fields. */
export interface UploadRead {
  fileName: string;
  blocks: ViewBlock[];
  tables: WordTable[];
  /** Content controls by tag: their text, and whether it is still the placeholder. */
  controls: Record<string, { text: string; placeholder: boolean }>;
  /** What the hidden data part of the file says it is ("trd-data", "trd-form", "sampling-data", "sampling-form", "gap-data", "gap-form"). */
  dataKind?: "trd-data" | "trd-form" | "sampling-data" | "sampling-form" | "gap-data" | "gap-form";
  dataJson?: string;
  /** Level 3: what kind of file the blocks were read from. */
  format?: "docx" | "pdf";
  /** A PDF with no text layer (a picture of text): nothing was read. */
  noText?: boolean;
}

export type Confidence = "exact" | "matched" | "not_found" | "changed";
export const CONFIDENCE_LABEL: Record<Confidence, string> = { exact: "Exact", matched: "Matched", not_found: "Not found", changed: "Changed in Word" };

// ------------------------------------------------------------------ counts and the summary sentence

export interface ImportCounts {
  taken: number;
  open: number;
  /** Open fields the reader found nothing for. For a foreign document (level 3) most catalogue fields are like this, and
   * counting them as "still open" next to a handful of found values reads as if the upload failed. */
  notFound: number;
  changed: number;
}

/** "38 values taken, 12 still open, 5 changed in Word". A value is open until it is accepted; a blank cell is open. */
export function importSummaryText(c: ImportCounts, level: 1 | 2 | 3): string {
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  // Our own files (levels 1-2) carry every field, so "still open" is the honest count. A document in another layout
  // (level 3) only mentions some steps: split what was found and waits for a decision from what the document never had.
  if (level === 3) return [`${n(c.taken, "value", "values")} taken`, `${c.open - c.notFound} found and waiting for you`, `${c.notFound} not in this document (left open)`].join(", ");
  return [`${n(c.taken, "value", "values")} taken`, `${c.open} still open`, ...(level === 1 ? [`${c.changed} changed in Word`] : [])].join(", ");
}

// ------------------------------------------------------------------ which files are accepted

/** 25 MB, the limit for every document the site reads in the browser. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type UploadKind = { ok: true; kind: "docx" | "pdf" } | { ok: false; message: string };

/** The file rules in plain words: .docx and .docm are read as Word, .pdf is accepted, older formats get a clear next step. */
export function classifyUpload(name: string, size: number): UploadKind {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  if (size > UPLOAD_MAX_BYTES) return { ok: false, message: `This file is larger than ${UPLOAD_MAX_BYTES / 1024 / 1024} MB. Save a smaller copy (for example without large pictures) and try again.` };
  if (ext === "docx" || ext === "docm") return { ok: true, kind: "docx" };
  if (ext === "pdf") return { ok: true, kind: "pdf" };
  if (ext === "doc" || ext === "rtf" || ext === "odt") return { ok: false, message: "Save it as .docx or PDF first." };
  return { ok: false, message: "This file type is not read. Upload a .docx (Word) or a PDF." };
}

/** A PDF without a text layer: it is a picture of text, and reading pictures (OCR) is not part of the site. */
export const SCANNED_PDF_MESSAGE = "This PDF is a picture of text; save it from the original file as .docx or a text PDF.";

// ------------------------------------------------------------------ words

/** Lower-case word tokens. "Set-point (°C)" -> ["set", "point", "°c"]. Units keep their symbols. */
export const toks = (s: string): string[] =>
  norm(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}µμ°%/]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

export function containsSeq(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
}
export const sameSeq = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((w, i) => w === b[i]);

/** Text that looks important and must not vanish silently: a number with a unit, or the words of a requirement. */
const UNIT_NUMBER = /\d\s*(?:%|°\s?[CF]\b|(?:ml|µl|ul|l|g|kg|mg|µg|h|hr|hrs|hours?|min|mins|minutes?|s|sec|seconds?|days?|weeks?|rpm|bar|mbar|psi|pa|kpa|mmhg|torr|vials?|µm|mm|cm|m)\b)/i;
const REQUIREMENT = /\b(?:shall|must|limits?|not more than|not less than|nmt|nlt|maximum|minimum|required|at least|no more than)\b/i;
export const important = (t: string) => UNIT_NUMBER.test(t) || REQUIREMENT.test(t);
export const clip = (t: string, n = 140) => (norm(t).length > n ? `${norm(t).slice(0, n - 1)}…` : norm(t));

/**
 * The kinds of column a header text names, from a list of (kind, word tokens). The LONGEST phrase wins: "lower limit" is a low end and
 * not "limit", "hold time" is not "time". A phrase that is part of a longer phrase of another kind is dropped.
 */
export function headerKindsOf<K extends string>(words: readonly { kind: K; toks: string[] }[], text: string): Set<K> {
  const t = toks(text);
  const hits = words.filter((c) => containsSeq(t, c.toks));
  const kept = hits.filter((h) => !hits.some((o) => o.kind !== h.kind && o.toks.length > h.toks.length && containsSeq(o.toks, h.toks)));
  return new Set(kept.map((h) => h.kind));
}

// ------------------------------------------------------------------ the table as a grid

export interface GridCell {
  text: string;
  /** The cell in the document that the text really belongs to (merged cells point at their first cell). */
  r: number;
  c: number;
}

/** Rectangular view of a table with merged cells: a cell spanning columns or rows appears in every grid position it covers. */
export function tableGrid(rows: readonly (readonly ViewCell[])[]): GridCell[][] {
  const out: GridCell[][] = [];
  rows.forEach((row, r) => {
    const line: GridCell[] = [];
    row.forEach((cell, c) => {
      const span = Math.max(1, cell.colSpan ?? 1);
      for (let i = 0; i < span; i++) {
        const above = out[r - 1]?.[line.length];
        if (cell.vContinue && above) line.push({ ...above });
        else line.push({ text: norm(cell.text), r, c });
      }
    });
    out.push(line);
  });
  return out;
}

// ------------------------------------------------------------------ pieces every document type's review model needs

/** The first number of a version string: a data part or form of another major version is refused by every reader. */
export const majorVersion = (v: string) => v.split(".")[0];

/** What a person left in a form control: nothing when it still shows the placeholder or says "Not established". Unfilled is never a value. */
export const filledControl = (c: { text: string; placeholder: boolean } | undefined): string => {
  if (!c || c.placeholder) return "";
  const t = c.text.trim();
  return !t || t.toLowerCase() === "not established" ? "" : t;
};

/** Cell position in the view blocks, "block:row:col": the key that links a table cell of the document to the fields it fed. */
export const cellKey = (b: number, r: number, c: number) => `${b}:${r}:${c}`;

export function linkCells(s: { cellFields: Record<string, string[]>; fieldCells: Record<string, string[]> }, id: string, key: string): void {
  (s.cellFields[key] ??= []).push(id);
  (s.fieldCells[id] ??= []).push(key);
}
