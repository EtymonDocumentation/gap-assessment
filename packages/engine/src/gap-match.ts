import type { ContentBundle } from "./content";
import type { Question } from "./content-schema";
import { questionLabel } from "./format";
import { emptyGapField, gapInputText, ensureGapRow, gapFieldOf, GAP_SIDE_LABEL, newGapSession, parseGapAnswer, sortGapRows, type GapImportSession, type GapSide } from "./gap-import";
import type { GapColumnKind, GapImportSynonyms } from "./gap-synonyms";
import { cellKey, clip, containsSeq, headerKindsOf, important, linkCells, norm, sameSeq, SCANNED_PDF_MESSAGE, tableGrid, toks, type GridCell, type UploadRead, type ViewBlock } from "./import-shared";
import { readValue } from "./trd-value";

/**
 * Level 3 of the gap assessment upload: a gap assessment written by somebody else (Word or PDF, any layout). FIXED RULES only, no AI:
 *
 *  - A question table is found by the words in its header row (content/gap-import/synonyms.yaml): a column for the question and at least
 *    one for the sending-unit answer, the receiving-unit answer, or one answer column.
 *  - Each row is matched to a question of the catalogue by its text (the question's prompt, its short label, or a synonym). A row that
 *    matches no question, or more than one, is listed under "Not used yet": the tool never guesses which question somebody meant.
 *  - Every answer read is only a SUGGESTION ("Matched"). One that does not fit the question's choices or units is "Not found" with the
 *    reason, and the document's words are listed. Nothing is converted, nothing is defaulted, and an empty cell is nothing.
 *  - ONE answer column (no sending/receiving split) is used only for questions asked of both units together. For a question asked of
 *    each unit it would be a guess which unit the answer is about, so it is not used and the screen says why.
 */

interface ColSpec {
  col: number;
  kind: GapColumnKind;
  header: string;
  unit?: string;
}

const MAX_NOT_USED_PARAS = 12;

interface Phrase {
  q: Question;
  toks: string[];
}

function phrasesOf(content: ContentBundle, syn: GapImportSynonyms): Phrase[] {
  const out: Phrase[] = [];
  for (const q of content.questions) {
    for (const t of new Set([q.prompt, questionLabel(q)])) out.push({ q, toks: toks(t) });
    for (const s of syn.questions) if (s.id === q.id) for (const w of s.words) out.push({ q, toks: toks(w) });
  }
  return out.filter((p) => p.toks.length);
}

/** The words that name a section: its title and the synonyms. */
function sectionPhrases(content: ContentBundle, syn: GapImportSynonyms): { id: string; toks: string[] }[] {
  const out: { id: string; toks: string[] }[] = [];
  for (const s of content.sections) {
    out.push({ id: s.id, toks: toks(s.title) });
    for (const x of syn.sections) if (x.id === s.id) for (const w of x.words) out.push({ id: s.id, toks: toks(w) });
  }
  return out.filter((p) => p.toks.length);
}

function sectionOf(text: string, phrases: { id: string; toks: string[] }[]): string | undefined {
  const t = toks(text);
  if (!t.length) return undefined;
  const exact = new Set(phrases.filter((p) => sameSeq(p.toks, t)).map((p) => p.id));
  if (exact.size === 1) return [...exact][0];
  if (exact.size > 1) return undefined;
  const hits = phrases.filter((p) => containsSeq(t, p.toks));
  const longest = Math.max(0, ...hits.map((h) => h.toks.length));
  const best = new Set(hits.filter((h) => h.toks.length === longest).map((h) => h.id));
  return best.size === 1 ? [...best][0] : undefined;
}

/** The question a text names: the whole text, or the one question whose wording it contains. Never a guess when it is unclear. */
export function matchQuestionText(text: string, phrases: Phrase[], section?: string): { q: Question } | { reason: string } {
  const t = toks(text);
  if (!t.length) return { reason: "there is no question text" };
  const pick = (cands: Phrase[]): { q: Question } | { reason: string } | undefined => {
    const exact = new Map(cands.filter((p) => sameSeq(p.toks, t)).map((p) => [p.q.id, p.q]));
    if (exact.size === 1) return { q: [...exact.values()][0]! };
    if (exact.size > 1) return { reason: "its wording fits more than one question of the catalogue" };
    const hits = cands.filter((p) => containsSeq(t, p.toks));
    const longest = Math.max(0, ...hits.map((h) => h.toks.length));
    const best = new Map(hits.filter((h) => h.toks.length === longest).map((p) => [p.q.id, p.q]));
    if (best.size === 1) return { q: [...best.values()][0]! };
    if (best.size > 1) return { reason: "its wording fits more than one question of the catalogue" };
    return undefined;
  };
  // The section named above the table narrows the choice first: the same wording is asked in several steps.
  if (section) {
    const r = pick(phrases.filter((p) => p.q.section === section));
    if (r && "q" in r) return r;
  }
  return pick(phrases) ?? { reason: "no question of the catalogue has this wording" };
}

function findHeader(grid: GridCell[][], words: { kind: GapColumnKind; toks: string[] }[]): { row: number; cols: ColSpec[] } | undefined {
  let best: { row: number; cols: ColSpec[]; kinds: number } | undefined;
  for (let r = 0; r < Math.min(3, grid.length); r++) {
    const cols: ColSpec[] = [];
    const seen = new Set<GapColumnKind>();
    let prev = "";
    grid[r]!.forEach((cell, col) => {
      // A header merged over several columns is read once.
      if (cell.text === prev && col > 0 && grid[r]![col - 1]!.c === cell.c) return;
      prev = cell.text;
      const kinds = headerKindsOf(words, cell.text);
      if (kinds.size !== 1) return;
      const kind = [...kinds][0]!;
      if (seen.has(kind)) return;
      seen.add(kind);
      const unit = /\(([^)]{1,12})\)/.exec(cell.text)?.[1]?.trim();
      cols.push({ col, kind, header: cell.text, ...(unit ? { unit } : {}) });
    });
    const kinds = new Set(cols.map((c) => c.kind));
    if (kinds.has("question") && (kinds.has("source") || kinds.has("target") || kinds.has("answer")) && (!best || kinds.size > best.kinds)) best = { row: r, cols, kinds: kinds.size };
  }
  return best ? { row: best.row, cols: best.cols } : undefined;
}

/** A row that only names a group ("Filling"): one distinct text spread over the row. It sets the section for the rows below. */
function subHeading(cells: GridCell[]): string | undefined {
  const texts = cells.map((c) => c.text).filter(Boolean);
  if (!texts.length) return undefined;
  return new Set(texts).size === 1 && cells.length > 2 ? texts[0] : undefined;
}

function headingAbove(blocks: ViewBlock[], at: number): { text: string } | undefined {
  for (let i = at - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.kind === "heading") return { text: b.text };
    if (b.kind === "table") return undefined;
  }
  return undefined;
}

const unitSide = (side: GapSide) => (side === "source" ? "sending" : "receiving");

export function gapSessionFromOther(read: UploadRead, content: ContentBundle, syn: GapImportSynonyms): GapImportSession {
  const s = newGapSession(3, read, `A document in another layout (${read.format === "pdf" ? "PDF" : "Word"}), read by fixed rules. Everything found is a suggestion for you to check.`);
  s.matchedTables = [];
  if (read.noText) {
    s.notUsed.push(SCANNED_PDF_MESSAGE);
    return s;
  }
  const first = read.blocks[0];
  if (first && first.kind !== "table" && norm(first.text) && (first.kind === "heading" || (norm(first.text).length <= 100 && !norm(first.text).includes(":") && !/[.]\s*$/.test(norm(first.text))))) {
    s.title = { value: clip(first.text, 120), source: `First line of the document: "${clip(first.text, 120)}"` };
  }
  const words = syn.columns.flatMap((c) => c.words.map((w) => ({ kind: c.kind, toks: toks(w) }))).filter((w) => w.toks.length);
  const phrases = phrasesOf(content, syn);
  const sections = sectionPhrases(content, syn);
  let tableNo = 0;

  read.blocks.forEach((block, bi) => {
    if (block.kind !== "table") return;
    tableNo++;
    const grid = tableGrid(block.rows);
    const head = findHeader(grid, words);
    if (!head) {
      if (grid.length > 1) s.notUsed.push(`Table ${tableNo} (${grid.length - 1} rows) was not used: no column heading looked like a question with an answer (question, sending unit, receiving unit, answer).`);
      return;
    }
    const above = headingAbove(read.blocks, bi);
    const label = `Table ${tableNo}${above ? ` under "${clip(above.text, 60)}"` : ""}`;
    const byKind = new Map(head.cols.map((c) => [c.kind, c]));
    const mapped = new Set(head.cols.map((c) => c.col));
    // Columns that mean nothing to the reader are listed, not dropped silently.
    const seenHeader = new Set<string>();
    grid[head.row]!.forEach((cell, col) => {
      if (mapped.has(col) || !cell.text || seenHeader.has(`${cell.r}:${cell.c}`)) return;
      seenHeader.add(`${cell.r}:${cell.c}`);
      s.notUsed.push(`${label}: the column "${clip(cell.text, 40)}" was not used.`);
    });
    let section = above ? sectionOf(above.text, sections) : undefined;
    let rowsMatched = 0;
    for (let r = head.row + 1; r < grid.length; r++) {
      const cells = grid[r]!;
      const sub = subHeading(cells);
      if (sub) {
        section = sectionOf(sub, sections) ?? section;
        continue;
      }
      const cellOf = (k: GapColumnKind) => {
        const c = byKind.get(k);
        return c ? cells[c.col] : undefined;
      };
      const qText = cellOf("question")?.text ?? "";
      if (!qText || head.cols.every((c) => !cells[c.col]?.text)) continue;
      // The same header repeated on the next page of a long table.
      if (head.cols.every((c) => !cells[c.col]?.text || norm(cells[c.col]!.text).toLowerCase() === norm(c.header).toLowerCase())) continue;
      const where = `${label}, line ${r - head.row}`;
      const anyAnswer = (["source", "target", "answer"] as const).some((k) => cellOf(k)?.text);
      const m = matchQuestionText(qText, phrases, section);
      if ("reason" in m) {
        if (anyAnswer) s.notUsed.push(`${where}: "${clip(qText, 70)}" was not used: ${m.reason}.`);
        continue;
      }
      const q = m.q;
      if (s.rows.some((x) => x.questionId === q.id)) {
        // The same question twice in the document: the first row stands and the later one is listed.
        if (anyAnswer) s.notUsed.push(`${where}: "${clip(qText, 70)}" appears more than once; this later row was not used.`);
        continue;
      }
      const row = ensureGapRow(content, s, q, where);
      rowsMatched++;
      const so = cellOf("source");
      const ta = cellOf("target");
      const an = cellOf("answer");
      for (const side of row.sides) {
        // Which column feeds this side. One answer column serves only a question asked of both units together.
        let col: GapColumnKind | undefined;
        let differ = "";
        let agree = "";
        if (side === "shared") {
          if (an?.text) col = "answer";
          else if (so?.text && ta?.text && norm(so.text).toLowerCase() === norm(ta.text).toLowerCase()) {
            col = "source";
            agree = "; the sending and receiving columns of the document give the same answer";
          }
          else if (so?.text && ta?.text) {
            differ = "the two sites differ; this question has one answer for both";
            s.notUsed.push(`${where}: "${clip(qText, 70)}" is asked of both units together, but the document gives different answers for the sending unit ("${clip(so.text, 40)}") and the receiving unit ("${clip(ta.text, 40)}"). Neither was used.`);
          }
          else if (so?.text || ta?.text) col = so?.text ? "source" : "target";
        } else if (byKind.has(side)) col = side;
        else if (an?.text) s.notUsed.push(`${where}: "${clip(qText, 70)}" is asked of the ${unitSide(side)} unit, but the document has one answer column that does not say which unit it is about. "${clip(an.text, 50)}" was not used.`);
        // An answer for the other unit of a question that is not asked of it.
        if (side !== "shared" && q.sides !== "paired") {
          const other = side === "source" ? ta : so;
          if (other?.text) s.notUsed.push(`${where}: "${clip(qText, 70)}" is asked of the ${unitSide(side)} unit only; the answer "${clip(other.text, 50)}" for the other unit was not used.`);
        }
        const f = emptyGapField(q.id, side, `${where}: no answer for the ${GAP_SIDE_LABEL[side]} in the document`);
        if (differ) f.notUsedWhy = differ;
        f.table = bi;
        const spec = col ? byKind.get(col) : undefined;
        const cell = col ? cellOf(col) : undefined;
        let text = cell?.text ?? "";
        let note = agree;
        // A bare number under a heading with a unit, "Volume (mL)": read with the unit of the heading, when the question allows it.
        if (text && spec?.unit && q.input.type === "quantity" && q.input.units?.includes(spec.unit)) {
          const v = readValue(text);
          if (v.kind === "number" && !v.unit) {
            text = `${norm(text)} ${spec.unit}`;
            note = `; the unit "${spec.unit}" is from the column heading`;
          }
        }
        if (text && cell) {
          const parsed = parseGapAnswer(content, q, side, text, syn, true);
          const src = `${where}, column "${clip(spec?.header ?? "", 40)}": "${clip(cell.text, 80)}"${note}`;
          if (parsed.ok) {
            // The review shows the canonical text (the question's own choice words), so accepting it parses back to exactly this answer.
            Object.assign(f, { value: gapInputText(content, q, parsed.input), confidence: "matched" as const, source: src });
            linkCells(s, f.id, cellKey(bi, cell.r, cell.c));
          } else {
            f.source = src;
            f.notUsedWhy = `"${clip(cell.text, 60)}" was not used: ${parsed.reason}`;
            s.notUsed.push(`${where}: the ${GAP_SIDE_LABEL[side]} answer "${clip(cell.text, 60)}" was not used: ${parsed.reason}`);
          }
        }
        if (!gapFieldOf(s, q.id, side)) s.fields.push(f);
      }
    }
    if (rowsMatched) s.matchedTables!.push({ block: bi, label });
  });

  const paras = read.blocks.filter((b): b is Extract<ViewBlock, { kind: "para" }> => b.kind === "para" && important(b.text));
  paras.slice(0, MAX_NOT_USED_PARAS).forEach((b) => s.notUsed.push(`Text not used: "${clip(b.text, 140)}"`));
  if (paras.length > MAX_NOT_USED_PARAS) s.notUsed.push(`${paras.length - MAX_NOT_USED_PARAS} more passages with amounts or requirements were not used.`);
  sortGapRows(content, s);
  if (s.rows.length === 0) s.notUsed.unshift("No question table was recognised in this document. If it has one, its column headings or question wording may use words this tool does not know yet.");
  return s;
}
