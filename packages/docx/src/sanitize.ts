import { DocPackage } from "./docpkg";
import { CT, REL, parseRels, relsPathFor, relsXml, resolveTarget, type Rel } from "./package";
import { decodeXml } from "./xml";

/** Parts that carry macros, toolbars or embedded objects. They are removed, never run. */
const REMOVE_PARTS: { re: RegExp; label: string }[] = [
  { re: /^word\/vbaProject\.bin$/i, label: "Macros (vbaProject.bin)" },
  { re: /^word\/vbaData\.xml$/i, label: "Macro data (vbaData.xml)" },
  { re: /^word\/_rels\/vbaProject\.bin\.rels$/i, label: "" },
  { re: /^word\/customizations\.xml$/i, label: "Custom toolbars and keyboard shortcuts (customizations.xml)" },
  { re: /^word\/_rels\/customizations\.xml\.rels$/i, label: "" },
  { re: /^word\/attachedToolbars\.bin$/i, label: "Custom toolbars (attachedToolbars.bin)" },
  { re: /^word\/keyMapCustomizations\.xml$/i, label: "Custom keyboard shortcuts (keyMapCustomizations.xml)" },
  { re: /^word\/activeX\//i, label: "ActiveX controls" },
  { re: /^word\/embeddings\//i, label: "Embedded objects" },
];

const REMOVE_TYPES = /vbaProject|vbaData|activeX|attachedToolbars|customizations|keyMapCustomizations|oleObject|\.vbaProject/i;
const COMMENT_TYPES = /wordprocessingml\.comments|ms-word\.comments|ms-word\.people|wordprocessingml\.people/i;
const REL_REMOVE_TYPE = /\/(attachedTemplate|oleObject|package|frame|subDocument|mailMergeSource|vbaProject|vbaProjectSignature|activeXControlBinary|attachedToolbars|customizations|keyMapCustomizations)$|ms-office\/2006\/relationships\/(vbaProject|vbaData|activeXControlBinary|attachedToolbars|keyMapCustomizations|customizations)/i;
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/i;
const DANGEROUS_FIELD = /^\s*(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|LINK|EMBED|IMPORT|MACROBUTTON|AUTOTEXT|AUTOTEXTLIST|DATABASE|RD|ADDIN)\b/i;

/* ---------- fields ----------
 *
 * A Word field is a short instruction ("fetch this file", "run this macro") that Word carries out when the document is opened or
 * updated. The instruction is not always in one piece or in one spelling: a complex field is written as a begin mark, any number of
 * instruction pieces (often split between runs) and an end mark; the same XML name can carry another prefix; attribute values may
 * use either kind of quote; and the first word may be wrapped in quotes or hidden behind characters with no width. So the check
 * reads the whole instruction of each field, tidies it, and only then looks at its first word. Nothing is evaluated or run.
 */

/** An XML name's optional prefix ("w:" or any other prefix that the file maps to the Word namespace). */
const ANY_PREFIX = "(?:[\\w.-]+:)?";
/** One piece of a start tag's attributes: a quoted value (either quote kind, may contain ">") or any other character. */
const ATTR_TEXT = `"[^"]*"|'[^']*'|[^>"']`;
const INVISIBLE = new RegExp("[\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]", "g");

/** The instruction as plain text: character references decoded, CDATA unwrapped, invisible characters removed, odd spaces made plain. */
function plainInstruction(raw: string): string {
  return decodeXml(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(INVISIBLE, "")
    .replace(new RegExp("[\u00a0\u2000-\u200a\u202f\u205f\u3000]", "g"), " ");
}

/** What follows a field's keyword, split into its words: quoted text (either quote kind) counts as one word. */
function instructionWords(rest: string): { text: string; quoted: boolean }[] {
  const words: { text: string; quoted: boolean }[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    const quoted = m[3] === undefined;
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    words.push({ text: quoted ? text.replace(/\\(.)/g, "$1") : text, quoted });
  }
  return words;
}

/**
 * A link field is kept only when it points to a web address, a mail or phone link, or a place inside the same document. A link to
 * a file, a network share or anything else is the kind of thing Word fetches or opens, so it is not kept.
 */
function linkFieldIsUnsafe(afterKeyword: string): boolean {
  const words = instructionWords(afterKeyword);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    // A switch such as \l (a place in this document), \o (tool tip) or \t (frame): the three that take a value skip it.
    if (!w.quoted && /^\\[A-Za-z]$/.test(w.text)) {
      if (/^\\[loptLOPT]$/.test(w.text)) i++;
      continue;
    }
    return !SAFE_LINK.test(w.text.trim());
  }
  return false; // no target at all: nothing to fetch
}

/** True when a field instruction could fetch outside content, open a file or run a macro. */
export function fieldIsUnsafe(instruction: string): boolean {
  const text = plainInstruction(instruction).replace(new RegExp("^[\\s\"'\u2018-\u201f]+"), "");
  if (DANGEROUS_FIELD.test(text)) return true;
  const keyword = /^([A-Za-z]+)/.exec(text)?.[1];
  return keyword !== undefined && keyword.toUpperCase() === "HYPERLINK" && linkFieldIsUnsafe(text.slice(keyword.length));
}

const FIELD_PIECES = new RegExp(
  // a begin / separate / end mark
  `<${ANY_PREFIX}fldChar\\b((?:${ATTR_TEXT})*)>` +
    // or one piece of instruction text (also the kind kept inside a tracked deletion)
    `|(<${ANY_PREFIX}(?:del)?instrText\\b(?:${ATTR_TEXT})*>)((?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|[^<])*)(</${ANY_PREFIX}(?:del)?instrText\\s*>)`,
  "g",
);
const SIMPLE_FIELD = new RegExp(`<${ANY_PREFIX}fldSimple\\b(?:${ATTR_TEXT})*>`, "g");
/** One attribute of a start tag, read as a whole so that text inside one value is never mistaken for another attribute. */
const ATTRIBUTE = /(\s)([\w.-]+:)?([\w.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g;

/** The value of the attribute with this local name (whatever its prefix or quote kind), or undefined. */
function attributeValue(attrs: string, local: string): string | undefined {
  for (const m of attrs.matchAll(ATTRIBUTE)) if (m[3] === local) return m[5]!.slice(1, -1);
  return undefined;
}

interface Piece {
  start: number;
  end: number;
  open: string;
  text: string;
  close: string;
}

/**
 * Replaces the instruction of every unsafe field with an empty QUOTE field, so the field is still there (the visible text and the
 * structure stay) but no longer points anywhere. Returns the new XML and how many fields were changed.
 */
export function neutraliseFields(xml: string): { xml: string; count: number } {
  let count = 0;

  // Complex fields: collect the instruction pieces of each field (nested fields keep their own), then judge the pieces together.
  const edits: Piece[] = [];
  const stack: { pieces: Piece[]; inResult: boolean }[] = [];
  const settle = (pieces: Piece[]) => {
    if (pieces.length === 0 || !fieldIsUnsafe(pieces.map((p) => p.text).join(""))) return;
    count++;
    pieces.forEach((p, i) => edits.push({ ...p, text: i === 0 ? ' QUOTE "" ' : "" }));
  };
  FIELD_PIECES.lastIndex = 0;
  for (let m = FIELD_PIECES.exec(xml); m; m = FIELD_PIECES.exec(xml)) {
    if (m[1] !== undefined) {
      const kind = attributeValue(m[1], "fldCharType");
      if (kind === "begin") stack.push({ pieces: [], inResult: false });
      else if (kind === "separate") {
        const top = stack[stack.length - 1];
        if (top) top.inResult = true;
      } else if (kind === "end") {
        const done = stack.pop();
        if (done) settle(done.pieces);
      }
      continue;
    }
    const piece: Piece = { start: m.index, end: m.index + m[0].length, open: m[2]!, text: m[3]!, close: m[4]! };
    const top = stack[stack.length - 1];
    if (!top) settle([piece]); // instruction text with no field around it is judged on its own
    else if (!top.inResult) top.pieces.push(piece);
  }
  // A field that was never closed is still judged.
  while (stack.length) settle(stack.pop()!.pieces);

  let out = xml;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.open + e.text + e.close + out.slice(e.end);

  // Simple fields keep their instruction in an attribute.
  out = out.replace(SIMPLE_FIELD, (tag: string) =>
    tag.replace(ATTRIBUTE, (whole: string, space: string, prefix: string | undefined, local: string, equals: string, value: string) => {
      if (local !== "instr" || !fieldIsUnsafe(value.slice(1, -1))) return whole;
      count++;
      return `${space}${prefix ?? ""}${local}${equals}"QUOTE &quot;&quot;"`;
    }),
  );
  return { xml: out, count };
}

function isXmlPart(name: string): boolean {
  return /^word\/[^/]+\.xml$/i.test(name);
}

function isUnsafeName(name: string): boolean {
  return name.includes("\\") || name.startsWith("/") || name.split("/").some((s) => s === "..");
}

/**
 * Removes everything in a Word package that could run code or fetch outside content, and returns a plain-language
 * list of what was removed. Nothing in the file is ever executed or evaluated.
 */
export function sanitizePackage(dp: DocPackage): string[] {
  const stripped: string[] = [];
  const note = (s: string) => {
    if (s && !stripped.includes(s)) stripped.push(s);
  };
  const { pkg, ct } = dp;

  // 1. Parts to remove, by name and by content type.
  const doomed = new Set<string>();
  const counts = new Map<string, number>();
  for (const name of pkg.names()) {
    if (isUnsafeName(name)) {
      doomed.add(name);
      note("Parts with unsafe file names");
      continue;
    }
    const rule = REMOVE_PARTS.find((r) => r.re.test(name));
    const type = ct.typeOf(name) ?? "";
    if (rule || REMOVE_TYPES.test(type)) {
      doomed.add(name);
      const label = rule?.label ?? (type.includes("activeX") ? "ActiveX controls" : "Macro-related parts");
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  for (const [label, n] of counts) note(/controls|objects/.test(label) ? `${label} (${n})` : label);

  // 2. Existing review comments in the template (the tool writes its own).
  let removedComments = 0;
  for (const name of pkg.names()) {
    if (COMMENT_TYPES.test(ct.typeOf(name) ?? "")) {
      if (/comments\.xml$/i.test(name)) removedComments += (pkg.text(name)?.match(/<w:comment\s/g) ?? []).length;
      doomed.add(name);
    }
  }
  if (removedComments) note(`Review comments in the template (${removedComments})`);
  else if ([...doomed].some((n) => /comments/i.test(n))) note("Review comments in the template");

  for (const name of doomed) {
    pkg.delete(name);
    ct.overrides.delete(name);
  }
  // A Default entry that only served a removed macro part is not needed any more.
  for (const [ext, type] of [...ct.defaults]) if (REMOVE_TYPES.test(type)) ct.defaults.delete(ext);

  // 3. Relationships.
  const removedIds = new Map<string, Set<string>>();
  const external: string[] = [];
  const cleanRels = (owner: string, rels: Rel[]): Rel[] =>
    rels.filter((r) => {
      let drop = false;
      if (r.external) {
        if (r.type === REL.hyperlink) drop = !SAFE_LINK.test(r.target.trim());
        else drop = true;
        if (drop) external.push(r.type.replace(/^.*\//, ""));
      } else {
        const target = resolveTarget(owner, r.target);
        drop = doomed.has(target) || REL_REMOVE_TYPE.test(r.type) || !pkg.has(target);
        if (drop && REL_REMOVE_TYPE.test(r.type) && /attachedTemplate/i.test(r.type)) note("Link to an attached template file");
      }
      if (/attachedTemplate$/i.test(r.type)) {
        drop = true;
        note("Link to an attached template file");
      }
      if (drop) {
        const set = removedIds.get(owner) ?? new Set<string>();
        set.add(r.id);
        removedIds.set(owner, set);
      }
      return !drop;
    });
  dp.rootRels = cleanRels("x", dp.rootRels);
  dp.mainRels = cleanRels(dp.mainName, dp.mainRels);
  for (const name of pkg.names()) {
    if (!name.endsWith(".rels") || name === "_rels/.rels" || name === relsPathFor(dp.mainName)) continue;
    const owner = name.replace(/_rels\//, "").replace(/\.rels$/, "");
    const before = parseRels(pkg.text(name)!, name);
    const after = cleanRels(owner, before);
    if (after.length !== before.length) {
      if (after.length === 0) pkg.delete(name);
      else pkg.set(name, relsXml(after));
    }
  }
  if (external.length) note(`Links to outside files or addresses other than web links (${external.length})`);

  // 4. Remove references to removed relationships, and the other things that point outside the file.
  let fields = 0;
  let altChunks = 0;
  for (const name of pkg.names()) {
    if (!isXmlPart(name)) continue;
    let xml = pkg.text(name)!;
    const original = xml;
    const ids = removedIds.get(name);
    if (ids) for (const id of ids) xml = xml.replace(new RegExp(`\\s[\\w.-]+:(?:id|link|embed|pict|href|dm|lo|qs|cs)="${id.replace(/[^\w-]/g, "")}"`, "g"), "");
    if (/(^|\/)settings\.xml$/i.test(name)) {
      xml = xml.replace(/<w:attachedTemplate\b[^>]*\/>/g, "");
      xml = xml.replace(/<w:mailMerge\b[\s\S]*?<\/w:mailMerge>|<w:mailMerge\b[^>]*\/>/g, () => {
        note("Mail-merge data source settings");
        return "";
      });
      xml = xml.replace(/<w:(documentProtection|writeProtection)\b[^>]*\/>/g, () => {
        note("Editing restrictions (document protection)");
        return "";
      });
    }
    xml = xml.replace(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*\/>/g, "");
    const neutralised = neutraliseFields(xml);
    xml = neutralised.xml;
    fields += neutralised.count;
    xml = xml.replace(new RegExp(`<${ANY_PREFIX}altChunk\\b(?:${ATTR_TEXT})*?(?:/>|>[\\s\\S]*?</${ANY_PREFIX}altChunk\\s*>)`, "g"), () => {
      altChunks++;
      return "";
    });
    if (xml !== original) pkg.set(name, xml);
  }
  if (fields) note(`Fields that could fetch outside content or run a macro (${fields})`);
  if (altChunks) note(`Embedded document chunks (${altChunks})`);

  // 5. Plain document type.
  const mainType = ct.typeOf(dp.mainName);
  if (mainType === CT.mainTemplate || mainType === CT.mainMacro || mainType === CT.mainMacroTemplate) {
    ct.overrides.set(dp.mainName, CT.main);
    note(mainType === CT.mainTemplate ? "Template file type (saved as a plain Word document)" : "Macro-enabled file type (saved as a plain Word document)");
  }
  return stripped;
}
