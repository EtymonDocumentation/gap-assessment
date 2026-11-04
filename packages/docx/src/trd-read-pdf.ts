import type { UploadRead, ViewBlock, ViewCell } from "@gap/engine";
import { openPdf, type PdfPage } from "./pdf";

/**
 * Reads a PDF for the TRD upload (level 3): the text of every page as headings, paragraphs and simple column tables, so the same
 * fixed-rule matcher can read it as it reads a Word file. Nothing is evaluated, nothing leaves the browser.
 *
 *  - Text items are grouped into lines by their baseline, then a line is split into cells where the gap between two items is wider
 *    than a letter-and-a-half. Neighbouring lines with two or more cells are a table; its columns are the left edges the cells share.
 *  - A PDF with no text layer (a scan, a picture of text) comes back with `noText` and nothing else: there is no OCR in this site, and
 *    guessing text from a picture would put invented numbers in front of a person who must trust them.
 *  - A heading is a numbered short line ("3.1 Process parameters") or a short line set in clearly larger type than the body text.
 */

const MAX_PAGES = 200;
/** Fewer letters than this in the whole file means there is no text layer worth reading. */
const MIN_TEXT_CHARS = 12;

interface Piece {
  x: number;
  end: number;
  s: string;
}
interface Line {
  y: number;
  size: number;
  cells: { x: number; text: string }[];
}

async function pageLinesWithCells(page: PdfPage): Promise<{ lines: Line[]; chars: number }> {
  const content = await page.getTextContent();
  const items = content.items
    .filter((it) => it.str && it.str.trim() && it.transform)
    .map((it) => ({ x: it.transform![4]!, y: it.transform![5]!, size: Math.abs(it.transform![3]!) || it.height || 10, w: it.width ?? 0, s: it.str! }));
  const chars = items.reduce((n, it) => n + it.s.replace(/\s+/g, "").length, 0);
  const rows: { y: number; size: number; items: Piece[] }[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.35));
    const piece = { x: it.x, end: it.x + it.w, s: it.s };
    if (row) {
      row.items.push(piece);
      row.size = Math.max(row.size, it.size);
    } else rows.push({ y: it.y, size: it.size, items: [piece] });
  }
  const lines: Line[] = rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const sorted = r.items.sort((a, b) => a.x - b.x);
      const cells: Line["cells"] = [];
      let last: Piece | undefined;
      for (const p of sorted) {
        const gap = last ? p.x - last.end : 0;
        // A gap wider than 1.5 letters starts a new cell; a smaller one is a space inside the same cell.
        if (!last || gap > r.size * 1.5) cells.push({ x: p.x, text: p.s.trim() });
        else cells[cells.length - 1]!.text += `${gap > r.size * 0.15 ? " " : ""}${p.s.trim()}`;
        last = p;
      }
      return { y: r.y, size: r.size, cells: cells.map((c) => ({ x: c.x, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text) };
    })
    .filter((l) => l.cells.length);
  return { lines, chars };
}

const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+\p{Lu}[^.;,]{0,80}$/u;

/** Left edges that cells share, nearest first: the columns of a table. */
function anchorsOf(lines: Line[]): number[] {
  const xs = lines.flatMap((l) => l.cells.map((c) => c.x)).sort((a, b) => a - b);
  const out: number[][] = [];
  for (const x of xs) {
    const g = out[out.length - 1];
    if (g && x - g[g.length - 1]! <= 4) g.push(x);
    else out.push([x]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

function tableRows(lines: Line[]): ViewCell[][] {
  const anchors = anchorsOf(lines);
  const rows = lines.map((l) => {
    const row: ViewCell[] = anchors.map(() => ({ text: "" }));
    for (const c of l.cells) {
      let best = 0;
      for (let i = 1; i < anchors.length; i++) if (Math.abs(anchors[i]! - c.x) < Math.abs(anchors[best]! - c.x)) best = i;
      row[best]!.text = row[best]!.text ? `${row[best]!.text} ${c.text}` : c.text;
    }
    return row;
  });
  // A group heading ("NOR" over "Min" and "Max") is one cell of the first row with empty cells to its right, while the row below
  // fills them: it spans those columns, as a merged cell would in Word.
  const [h, sub] = rows;
  if (h && sub) {
    for (let c = 0; c < h.length; c++) {
      if (!h[c]!.text || !sub[c]!.text) continue;
      let k = 0;
      while (c + k + 1 < h.length && !h[c + k + 1]!.text && sub[c + k + 1]!.text) k++;
      if (k > 0) {
        h[c]!.colSpan = k + 1;
        h.splice(c + 1, k);
        // The row below keeps all its cells; the grid the matcher builds lines them up by column.
      }
    }
  }
  return rows;
}

export async function readTrdPdf(bytes: Uint8Array, fileName: string): Promise<UploadRead> {
  const { doc, task } = await openPdf(bytes);
  try {
    const blocks: ViewBlock[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const perPage: { page: number; lines: Line[] }[] = [];
    let chars = 0;
    for (let p = 1; p <= pages; p++) {
      const r = await pageLinesWithCells(await doc.getPage(p));
      chars += r.chars;
      perPage.push({ page: p, lines: r.lines });
    }
    if (chars < MIN_TEXT_CHARS) return { fileName, blocks: [], tables: [], controls: {}, format: "pdf", noText: true };
    const sizes = perPage.flatMap((p) => p.lines.map((l) => l.size)).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] ?? 10;

    for (const { page, lines } of perPage) {
      let i = 0;
      let firstOnPage = true;
      let para: { text: string; y: number; size: number } | undefined;
      const flush = () => {
        if (para) blocks.push({ kind: "para", text: para.text, page });
        para = undefined;
      };
      while (i < lines.length) {
        const l = lines[i]!;
        // A table: this line and the lines below it with two or more cells, close together (a run of at least two lines).
        if (l.cells.length >= 2) {
          let j = i;
          while (j + 1 < lines.length && lines[j + 1]!.cells.length >= 2 && lines[j]!.y - lines[j + 1]!.y <= lines[j]!.size * 2.6) j++;
          const run = lines.slice(i, j + 1);
          if (run.length >= 2 && run.some((x) => x.cells.length >= 3 || run.every((y) => y.cells.length === 2))) {
            flush();
            const rows = tableRows(run);
            const prev = blocks[blocks.length - 1];
            // A table that carries on at the top of the next page (same number of columns) is one table.
            if (firstOnPage && prev?.kind === "table" && prev.page !== page && Math.max(...prev.rows.map((r) => r.length)) === Math.max(...rows.map((r) => r.length))) prev.rows.push(...rows);
            else blocks.push({ kind: "table", rows, page });
            i = j + 1;
            firstOnPage = false;
            continue;
          }
        }
        const text = l.cells.map((c) => c.text).join("  ");
        firstOnPage = false;
        const numbered = NUMBERED.exec(text);
        const big = l.size >= body * 1.2 && text.length <= 80 && !/[.;,]$/.test(text);
        if (numbered || big) {
          flush();
          blocks.push({ kind: "heading", level: numbered ? numbered[1]!.split(".").length : l.size >= body * 1.5 ? 1 : 2, text, page });
        } else if (para && para.y - l.y <= l.size * 1.6) {
          para.text += ` ${text}`;
          para.y = l.y;
        } else {
          flush();
          para = { text, y: l.y, size: l.size };
        }
        i++;
      }
      flush();
    }
    return { fileName, blocks, tables: [], controls: {}, format: "pdf" };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
