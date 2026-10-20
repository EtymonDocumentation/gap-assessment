import { DocPackage } from "./docpkg";
import { CT, REL, parseRels, relsPathFor, relsXml, resolveTarget, type Rel } from "./package";

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
const DANGEROUS_FIELD = /^\s*(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|LINK|IMPORT|MACROBUTTON|AUTOTEXT|AUTOTEXTLIST|DATABASE|RD|ADDIN)\b/i;

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
    xml = xml.replace(/(<w:instrText\b[^>]*>)([^<]*)(<\/w:instrText>)/g, (m, a: string, code: string, b: string) => {
      if (!DANGEROUS_FIELD.test(code)) return m;
      fields++;
      return `${a} QUOTE "" ${b}`;
    });
    xml = xml.replace(/(<w:fldSimple\b[^>]*\sw:instr=")([^"]*)(")/g, (m, a: string, code: string, b: string) => {
      if (!DANGEROUS_FIELD.test(code)) return m;
      fields++;
      return `${a} QUOTE &quot;&quot; ${b}`;
    });
    xml = xml.replace(/<w:altChunk\b[^>]*\/>/g, () => {
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
