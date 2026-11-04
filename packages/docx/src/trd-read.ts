import type { UploadRead, ViewBlock, ViewCell, WordTable } from "@gap/engine";
import { DocPackage } from "./docpkg";
import { Pkg } from "./package";
import { readDataPart } from "./trd-data";
import { attrByLocal, childElements, localName, parseXml } from "./xml";

/**
 * Reads a Word file for the TRD upload: the document as headings, paragraphs and tables (for the left pane of the review screen), the
 * content controls by tag (the fill-in form), the printed parameter tables (to compare with the data stored in an export), and the data
 * part itself. Nothing is evaluated and nothing leaves the browser.
 *
 * Only what Word itself shows is read as text; the hidden data part is read separately. A file without our data part comes back with
 * `dataKind` undefined and is read by the fixed rules of level 3 (trd-match in the engine). Merged cells are kept: gridSpan as `colSpan`,
 * vMerge as `rowSpan` on the first cell and `vContinue` on the cells below.
 */

/** Text of a paragraph: runs, tabs and line breaks. Deleted tracked text is not read; inserted text is. */
function paraText(p: Element): string {
  let s = "";
  const walk = (n: Element) => {
    for (const c of childElements(n)) {
      const name = localName(c);
      if (name === "del" || name === "pPr" || name === "rPr") continue;
      if (name === "t") s += c.textContent ?? "";
      else if (name === "tab") s += "\t";
      else if (name === "br" || name === "cr") s += "\n";
      else walk(c);
    }
  };
  walk(p);
  return s;
}

function blockText(el: Element): string {
  const parts: string[] = [];
  for (const c of childElements(el)) {
    const name = localName(c);
    if (name === "p") parts.push(paraText(c));
    else if (name === "sdt") {
      const content = childElements(c).find((x) => localName(x) === "sdtContent");
      if (content) parts.push(blockText(content));
    }
  }
  return parts.join("\n");
}

function sdtInfo(sdt: Element): { tag?: string; placeholder: boolean; text: string } {
  const pr = childElements(sdt).find((x) => localName(x) === "sdtPr");
  const tagEl = pr ? childElements(pr).find((x) => localName(x) === "tag") : undefined;
  const placeholder = Boolean(pr && childElements(pr).some((x) => localName(x) === "showingPlcHdr"));
  const content = childElements(sdt).find((x) => localName(x) === "sdtContent");
  return { tag: tagEl ? attrByLocal(tagEl, "val") : undefined, placeholder, text: content ? (childElements(content).some((x) => localName(x) === "p") ? blockText(content) : paraText(content)) : "" };
}

function headingLevel(p: Element): number | undefined {
  const pPr = childElements(p).find((x) => localName(x) === "pPr");
  if (!pPr) return undefined;
  const style = childElements(pPr).find((x) => localName(x) === "pStyle");
  const id = style ? (attrByLocal(style, "val") ?? "") : "";
  const m = /^(?:heading|überschrift)\s*(\d)$/i.exec(id) ?? /^heading(\d)$/i.exec(id);
  if (m) return Number(m[1]);
  const ol = childElements(pPr).find((x) => localName(x) === "outlineLvl");
  const v = ol ? attrByLocal(ol, "val") : undefined;
  return v !== undefined && /^\d$/.test(v) ? Number(v) + 1 : undefined;
}

/** The first content control below an element (block level or inside a paragraph). */
function firstSdt(el: Element): Element | undefined {
  for (const c of childElements(el)) {
    if (localName(c) === "sdt") return c;
    const inner = firstSdt(c);
    if (inner) return inner;
  }
  return undefined;
}

/** Every content control below an element, by tag. The first one with a tag wins; a repeat is ignored (the form has one per cell). */
function collectControls(root: Element, into: UploadRead["controls"]): void {
  const walk = (n: Element) => {
    for (const c of childElements(n)) {
      if (localName(c) === "sdt") {
        const info = sdtInfo(c);
        if (info.tag && !(info.tag in into)) into[info.tag] = { text: info.text, placeholder: info.placeholder };
      }
      walk(c);
    }
  };
  walk(root);
}

export function readTrdUpload(bytes: Uint8Array, fileName: string): UploadRead {
  const pkg = Pkg.fromBytes(bytes);
  const dp = DocPackage.open(pkg);
  const doc = parseXml(dp.mainXml(), dp.mainName);
  const body = childElements(doc.documentElement).find((x) => localName(x) === "body");
  const blocks: ViewBlock[] = [];
  const tables: WordTable[] = [];
  const controls: UploadRead["controls"] = {};
  if (body) {
    collectControls(body, controls);
    const visit = (parent: Element) => {
      for (const el of childElements(parent)) {
        const name = localName(el);
        if (name === "p") {
          const text = paraText(el).trim();
          if (!text) continue;
          const level = headingLevel(el);
          blocks.push(level ? { kind: "heading", level, text } : { kind: "para", text });
        } else if (name === "tbl") {
          const rows: ViewCell[][] = [];
          // Merged cells: a cell can span columns (gridSpan) and start or continue a vertical merge (vMerge). The grid column of each
          // cell is kept so a continuation cell can be tied to the cell that started the merge (which then gets its rowSpan).
          const starts = new Map<number, ViewCell>();
          for (const tr of childElements(el).filter((x) => localName(x) === "tr")) {
            const row: ViewCell[] = [];
            let gridCol = 0;
            for (const tc of childElements(tr).filter((x) => localName(x) === "tc")) {
              const sdt = firstSdt(tc);
              const info = sdt ? sdtInfo(sdt) : undefined;
              const tcPr = childElements(tc).find((x) => localName(x) === "tcPr");
              const prop = (name: string) => (tcPr ? childElements(tcPr).find((x) => localName(x) === name) : undefined);
              const spanEl = prop("gridSpan");
              const span = Math.max(1, Number(spanEl ? attrByLocal(spanEl, "val") : "1") || 1);
              const vm = prop("vMerge");
              const cont = Boolean(vm) && (attrByLocal(vm!, "val") ?? "continue") === "continue";
              const cell: ViewCell = { text: cont ? "" : blockText(tc).trim(), ...(info?.tag ? { controlId: info.tag } : {}), ...(span > 1 ? { colSpan: span } : {}), ...(cont ? { vContinue: true } : {}) };
              if (cont) {
                const top = starts.get(gridCol);
                if (top) top.rowSpan = (top.rowSpan ?? 1) + 1;
              } else if (vm) starts.set(gridCol, cell);
              else starts.delete(gridCol);
              row.push(cell);
              gridCol += span;
            }
            rows.push(row);
          }
          tables.push({ blockIndex: blocks.length, rows: rows.map((r) => r.map((c) => c.text)) });
          blocks.push({ kind: "table", rows });
        } else if (name === "sdt") {
          const content = childElements(el).find((x) => localName(x) === "sdtContent");
          if (content) visit(content);
        }
      }
    };
    visit(body);
  }
  const data = readDataPart(pkg);
  return { fileName, blocks, tables, controls, format: "docx" as const, ...(data ? { dataKind: data.kind, dataJson: data.json } : {}) };
}
