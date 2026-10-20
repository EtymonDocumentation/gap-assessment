import { TemplateError } from "./errors";
import type { OutlineHeading } from "./types";

const MAX_PAGES_SCANNED = 60;
const MAX_HEADINGS = 400;

interface OutlineNode {
  title: string;
  items?: OutlineNode[];
}

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}

interface PdfDoc {
  numPages: number;
  getOutline(): Promise<OutlineNode[] | null>;
  getPage(n: number): Promise<PdfPage>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDoc>;
  destroy(): Promise<void>;
}

interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported: boolean; useSystemFonts?: boolean; verbosity?: number; disableFontFace?: boolean }): PdfLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
}

let loaded: Promise<PdfJs> | undefined;

/**
 * Loads pdf.js only when a PDF is read. In Node (tests, scripts) the legacy build runs without a worker thread.
 * In a browser bundle the worker file is taken from a Vite `?url` import, so it becomes a separate downloadable asset.
 */
function loadPdfjs(): Promise<PdfJs> {
  loaded ??= (async () => {
    const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
    const inNode = !!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
    if (!inNode && !mod.GlobalWorkerOptions.workerSrc) {
      const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")) as { default: string };
      mod.GlobalWorkerOptions.workerSrc = worker.default;
    }
    return mod;
  })();
  loaded.catch(() => {
    loaded = undefined;
  });
  return loaded;
}

const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,4})\.?\s+(\S.{0,118})$/;

/** "4.1 Process Description" -> number "4.1", text "Process Description". */
function splitNumber(title: string): { number?: string; text: string } {
  const m = NUMBERED.exec(title.trim());
  return m ? { number: m[1]!, text: m[2]!.trim() } : { text: title.trim() };
}

function fromBookmarks(nodes: OutlineNode[], level: number, out: OutlineHeading[]): void {
  for (const n of nodes) {
    if (out.length >= MAX_HEADINGS) return;
    const title = (n.title ?? "").replace(/\s+/g, " ").trim();
    if (title) {
      const { number, text } = splitNumber(title);
      out.push({ index: out.length, level: Math.min(level, 9), text, hasBody: false, ...(number ? { number } : {}) });
    }
    if (n.items?.length) fromBookmarks(n.items, level + 1, out);
  }
}

/** Lines of text of a page, top to bottom (items on the same baseline are joined). */
async function pageLines(page: PdfPage): Promise<string[]> {
  const content = await page.getTextContent();
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of content.items) {
    if (!it.str || !it.transform) continue;
    const y = Math.round(it.transform[5]!);
    const row = rows.get(y) ?? [];
    row.push({ x: it.transform[4]!, s: it.str });
    rows.set(y, row);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) => r.sort((a, b) => a.x - b.x).map((p) => p.s).join("").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Headings from visible numbered lines such as "4.1 Process Description" (used when the PDF has no bookmarks). */
function fromNumberedLines(lines: string[], out: OutlineHeading[]): void {
  const seen = new Set(out.map((h) => `${h.number ?? ""}|${h.text}`));
  for (const line of lines) {
    if (out.length >= MAX_HEADINGS) return;
    const m = NUMBERED.exec(line);
    // A heading starts with a capital letter, is short, and does not end like a sentence.
    if (!m || !/^\p{Lu}/u.test(m[2]!) || m[2]!.length > 90 || /[.;,]$/.test(m[2]!)) continue;
    const key = `${m[1]}|${m[2]!.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ index: out.length, level: Math.min(9, m[1]!.split(".").length), text: m[2]!.trim(), number: m[1], hasBody: false });
  }
}

/**
 * Headings of a PDF: the bookmark outline when there is one, otherwise the numbered lines of text.
 * A PDF has no text of its own that the tool can keep, so `hasBody` is always false.
 */
export async function readOutlineFromPdf(bytes: Uint8Array): Promise<OutlineHeading[]> {
  const pdfjs = await loadPdfjs();
  let doc: PdfDoc;
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string }).name ?? "";
    if (name === "PasswordException") throw new TemplateError("The PDF is password protected. Remove the password in your PDF program, save it again, and upload that copy.");
    throw new TemplateError("The PDF could not be read. It may be damaged. Open it in a PDF viewer, save or print it to a new PDF, and upload that copy.");
  }
  try {
    const out: OutlineHeading[] = [];
    const outline = await doc.getOutline().catch(() => null);
    if (outline?.length) fromBookmarks(outline, 1, out);
    if (!out.length) {
      const pages = Math.min(doc.numPages, MAX_PAGES_SCANNED);
      for (let p = 1; p <= pages && out.length < MAX_HEADINGS; p++) fromNumberedLines(await pageLines(await doc.getPage(p)), out);
    }
    return out.map((h, index) => ({ ...h, index }));
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
