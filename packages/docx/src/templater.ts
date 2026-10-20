import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { TemplateError } from "./errors";
import { knownTagNames } from "./tags";

export const NOT_AVAILABLE = "[not available]";

export interface TagInspection {
  found: string[];
  unknown: string[];
  missingRecommended: string[];
  errors: string[];
}

interface XtError {
  message?: string;
  properties?: { id?: string; explanation?: string; xtag?: string; file?: string; errors?: XtError[]; context?: string; offset?: number | number[] };
}

/** One error from docxtemplater as a plain-language sentence. */
function describeError(e: XtError): string {
  const p = e.properties ?? {};
  const where = p.file && /header/i.test(p.file) ? " (in a page header)" : p.file && /footer/i.test(p.file) ? " (in a page footer)" : "";
  const tag = p.xtag ? ` "${p.xtag}"` : "";
  switch (p.id) {
    case "unclosed_tag":
      return `A tag is opened with "{" but never closed with "}"${tag ? ` near${tag}` : ""}${where}. Check that the tag is typed in one go.`;
    case "unopened_tag":
      return `A closing "}" has no matching "{"${tag ? ` near${tag}` : ""}${where}.`;
    case "duplicate_open_tag":
      return `Two "{" follow each other without a closing "}"${tag ? ` near${tag}` : ""}${where}.`;
    case "duplicate_close_tag":
      return `Two "}" follow each other without an opening "{"${tag ? ` near${tag}` : ""}${where}.`;
    case "unbalanced_loop_tags":
    case "closing_tag_does_not_match_opening_tag":
      return `A loop is not closed correctly${tag ? ` (${tag.trim()})` : ""}${where}. Every {#name} needs a matching {/name}, in the same order.`;
    case "raw_xml_tag_should_be_only_text_in_paragraph":
      return `A raw tag${tag ? ` (${tag.trim()})` : ""}${where} must be alone in its own paragraph, with no other text next to it.`;
    case "loop_position_invalid":
      return `A loop tag${tag ? ` (${tag.trim()})` : ""}${where} is in a position where it cannot repeat anything. For a table row, put the opening tag in the first cell and the closing tag in the last cell of the same row.`;
    default:
      return `${p.explanation ?? e.message ?? "The template has a problem with its tags."}${where}`;
  }
}

export function describeErrors(err: unknown): string[] {
  const e = err as XtError;
  const list = e?.properties?.errors?.length ? e.properties.errors : [e];
  const out = [...new Set(list.map(describeError))];
  return out.slice(0, 20);
}

/** Options used for both checking and filling: tags only look values up by name (no expression parser), missing values show [not available]. */
export function templaterOptions() {
  return {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
    nullGetter: () => NOT_AVAILABLE,
    errorLogging: false as const,
  };
}

/** Plain text of the paragraphs of a part (used to find tags when the template does not compile). */
function plainText(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function regexTags(zip: PizZip): string[] {
  const names: string[] = [];
  for (const n of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(n)) continue;
    const text = plainText(zip.files[n]!.asText());
    for (const m of text.matchAll(/\{([#^/@]?)\s*([A-Za-z_][\w.]*)\s*\}/g)) if (m[1] !== "/") names.push(m[2]!);
  }
  return names;
}

interface TagTree {
  [name: string]: TagTree;
}

function walk(tree: TagTree, enclosing: string[], found: Set<string>, unknown: Set<string>): void {
  const known = knownTagNames();
  for (const [key, child] of Object.entries(tree)) {
    if (key === ".") continue;
    const inLoop = enclosing.length > 0;
    const isField = inLoop && enclosing.some((l) => known.loopFields.get(l)?.has(key));
    const isTop = known.top.has(key);
    const label = inLoop ? `${enclosing.join(".")}.${key}` : key;
    found.add(label);
    if (!isField && !isTop) unknown.add(label);
    if (Object.keys(child).length) walk(child, [...enclosing, key], found, unknown);
  }
}

/** Finds the tags in a Word package and the problems with them. Nothing is evaluated: the template is only parsed. */
export function inspectTags(bytes: Uint8Array): TagInspection {
  const zip = new PizZip(bytes);
  const found = new Set<string>();
  const unknown = new Set<string>();
  let errors: string[] = [];
  try {
    const dx = new Docxtemplater(zip, templaterOptions());
    // getTags exists since docxtemplater 3.45 but is missing from its type declarations.
    const tags = (dx as unknown as { getTags(): { document?: { tags: TagTree }; headers: { tags: TagTree }[]; footers: { tags: TagTree }[] } }).getTags();
    for (const t of [tags.document?.tags, ...tags.headers.map((h) => h.tags), ...tags.footers.map((h) => h.tags)]) if (t) walk(t, [], found, unknown);
  } catch (e) {
    errors = describeErrors(e);
    // The template does not compile; list the tags that can still be seen so the user sees what was found.
    const known = knownTagNames();
    for (const n of regexTags(zip)) {
      found.add(n);
      if (!known.top.has(n) && ![...known.loopFields.values()].some((s) => s.has(n))) unknown.add(n);
    }
  }
  const topFound = new Set([...found].map((n) => n.split(".")[0]!));
  const missingRecommended = knownTagNames().recommended.filter((t) => !topFound.has(t));
  return { found: [...found].sort(), unknown: [...unknown].sort(), missingRecommended, errors };
}

/** Compiles the template and fills it. Throws a TemplateError (plain language) when the tags are wrong. */
export function fillTemplate(bytes: Uint8Array, data: object): PizZip {
  const zip = new PizZip(bytes);
  try {
    const dx = new Docxtemplater(zip, templaterOptions());
    dx.render(data);
    return dx.getZip() as PizZip;
  } catch (e) {
    throw new TemplateError(`The template could not be filled in. ${describeErrors(e).join(" ")}`);
  }
}
