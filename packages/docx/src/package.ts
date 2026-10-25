import PizZip from "pizzip";
import { TemplateError } from "./errors";
import { CT_NS, PKG_REL_NS, XML_DECL, esc, attrByLocal, childElements, localName, parseXml } from "./xml";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_ENTRIES = 2000;

/** Fixed zip timestamp, built from local-time fields so the DOS time stored in the zip is the same on every machine. */
export const ZIP_DATE = new Date(2000, 0, 1, 0, 0, 0);

export const REL = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  settings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  coreProps: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  customProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
} as const;

export const CT = {
  main: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  mainTemplate: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  mainMacro: "application/vnd.ms-word.document.macroEnabled.main+xml",
  mainMacroTemplate: "application/vnd.ms-word.template.macroEnabledTemplate.main+xml",
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  settings: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  comments: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  header: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  footer: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
  rels: "application/vnd.openxmlformats-package.relationships+xml",
  xml: "application/xml",
  core: "application/vnd.openxmlformats-package.core-properties+xml",
  ext: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  custom: "application/vnd.openxmlformats-officedocument.custom-properties+xml",
  png: "image/png",
  jpeg: "image/jpeg",
} as const;

export const MAIN_CONTENT_TYPES: Record<string, "docx" | "dotx" | "docm"> = {
  [CT.main]: "docx",
  [CT.mainTemplate]: "dotx",
  [CT.mainMacro]: "docm",
  [CT.mainMacroTemplate]: "docm",
};

// ------------------------------------------------------------------ relationships

export interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

export function parseRels(xml: string, label: string): Rel[] {
  const root = parseXml(xml, label).documentElement!;
  return childElements(root)
    .filter((e) => localName(e) === "Relationship")
    .map((e) => ({
      id: attrByLocal(e, "Id") ?? "",
      type: attrByLocal(e, "Type") ?? "",
      target: attrByLocal(e, "Target") ?? "",
      external: (attrByLocal(e, "TargetMode") ?? "").toLowerCase() === "external",
    }));
}

export function relsXml(rels: Rel[]): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    rels.map((r) => `<Relationship Id="${esc(r.id)}" Type="${esc(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("") +
    "</Relationships>"
  );
}

/** "word/document.xml" -> "word/_rels/document.xml.rels". */
export function relsPathFor(part: string): string {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

/** Part a relationship of `fromPart` points at (internal relationships only). */
export function resolveTarget(fromPart: string, target: string): string {
  const stack = target.startsWith("/") ? [] : fromPart.split("/").slice(0, -1);
  for (const seg of target.replace(/^\//, "").split("/")) {
    if (seg === "..") stack.pop();
    else if (seg !== "." && seg !== "") stack.push(seg);
  }
  return stack.join("/");
}

export function nextRelId(rels: Rel[]): string {
  let max = 0;
  for (const r of rels) {
    const m = /^rId(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `rId${max + 1}`;
}

// ------------------------------------------------------------------ content types

export class ContentTypes {
  defaults = new Map<string, string>();
  overrides = new Map<string, string>();

  static parse(xml: string): ContentTypes {
    const ct = new ContentTypes();
    const root = parseXml(xml, "[Content_Types].xml").documentElement!;
    for (const e of childElements(root)) {
      const n = localName(e);
      if (n === "Default") ct.defaults.set((attrByLocal(e, "Extension") ?? "").toLowerCase(), attrByLocal(e, "ContentType") ?? "");
      else if (n === "Override") ct.overrides.set((attrByLocal(e, "PartName") ?? "").replace(/^\//, ""), attrByLocal(e, "ContentType") ?? "");
    }
    return ct;
  }

  typeOf(part: string): string | undefined {
    const o = this.overrides.get(part);
    if (o) return o;
    const ext = part.includes(".") ? part.slice(part.lastIndexOf(".") + 1).toLowerCase() : "";
    return this.defaults.get(ext);
  }

  toXml(): string {
    return (
      XML_DECL +
      `<Types xmlns="${CT_NS}">` +
      [...this.defaults].map(([e, t]) => `<Default Extension="${esc(e)}" ContentType="${esc(t)}"/>`).join("") +
      [...this.overrides].map(([p, t]) => `<Override PartName="/${esc(p)}" ContentType="${esc(t)}"/>`).join("") +
      "</Types>"
    );
  }
}

// ------------------------------------------------------------------ package

const decoder = new TextDecoder("utf-8");

/** An Office Open XML package held in memory: part name -> text or bytes. */
export class Pkg {
  private parts = new Map<string, Uint8Array | string>();

  /** Opens a zip, enforcing the size limits before anything is decompressed. */
  static fromBytes(bytes: Uint8Array): Pkg {
    if (bytes.length > MAX_FILE_BYTES) throw new TemplateError(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Remove large pictures or save a smaller copy and try again.`);
    let zip: PizZip;
    try {
      zip = new PizZip(bytes);
    } catch {
      throw new TemplateError("The file is not a valid Word document (it could not be opened as a zip package). Open it in Word, save it again as a .docx, and upload that copy.");
    }
    const names = Object.keys(zip.files);
    if (names.length > MAX_ENTRIES) throw new TemplateError(`The file contains more than ${MAX_ENTRIES} parts, which is far more than a normal Word document. It was not opened.`);
    let declared = 0;
    for (const n of names) {
      const size = (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (typeof size === "number") declared += size;
    }
    if (declared > MAX_UNCOMPRESSED_BYTES) throw new TemplateError(`The file would expand to more than ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB when opened, which is far more than a normal Word document. It was not opened.`);
    const pkg = new Pkg();
    let actual = 0;
    for (const n of names) {
      const f = zip.files[n]!;
      if (f.dir) continue;
      const data = f.asUint8Array();
      actual += data.length;
      if (actual > MAX_UNCOMPRESSED_BYTES) throw new TemplateError(`The file expands to more than ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB, which is far more than a normal Word document. It was not opened.`);
      pkg.parts.set(n, data);
    }
    return pkg;
  }

  names(): string[] {
    return [...this.parts.keys()];
  }
  has(name: string): boolean {
    return this.parts.has(name);
  }
  text(name: string): string | undefined {
    const v = this.parts.get(name);
    if (v === undefined) return undefined;
    return typeof v === "string" ? v : decoder.decode(v);
  }
  bytes(name: string): Uint8Array | undefined {
    const v = this.parts.get(name);
    if (v === undefined) return undefined;
    return typeof v === "string" ? new TextEncoder().encode(v) : v;
  }
  set(name: string, data: string | Uint8Array): void {
    this.parts.set(name, data);
  }
  delete(name: string): void {
    this.parts.delete(name);
  }

  /** Deterministic zip: fixed timestamps, [Content_Types].xml and the root relationships first. */
  toBytes(): Uint8Array {
    const zip = new PizZip();
    const order = ["[Content_Types].xml", "_rels/.rels", ...[...this.parts.keys()].filter((n) => n !== "[Content_Types].xml" && n !== "_rels/.rels")];
    for (const n of order) {
      const v = this.parts.get(n);
      if (v === undefined) continue;
      if (typeof v === "string") zip.file(n, v, { date: ZIP_DATE });
      else zip.file(n, v, { date: ZIP_DATE, binary: true });
    }
    return zip.generate({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
  }
}
