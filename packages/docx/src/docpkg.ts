import { TemplateError } from "./errors";
import { CT, ContentTypes, MAIN_CONTENT_TYPES, Pkg, REL, nextRelId, parseRels, relsPathFor, relsXml, resolveTarget, type Rel } from "./package";

/** A Word package: the parts, [Content_Types].xml and the relationships of the root and of the main document part. */
export class DocPackage {
  pkg: Pkg;
  ct: ContentTypes;
  rootRels: Rel[];
  mainName: string;
  mainRels: Rel[];

  private constructor(pkg: Pkg, ct: ContentTypes, rootRels: Rel[], mainName: string, mainRels: Rel[]) {
    this.pkg = pkg;
    this.ct = ct;
    this.rootRels = rootRels;
    this.mainName = mainName;
    this.mainRels = mainRels;
  }

  /** Opens a package and checks that it really is a Word document. */
  static open(pkg: Pkg): DocPackage {
    const ctXml = pkg.text("[Content_Types].xml");
    const rootXml = pkg.text("_rels/.rels");
    if (!ctXml || !rootXml) throw new TemplateError("The file is a zip but not a Word document: it has no [Content_Types].xml or _rels/.rels. Open it in Word, save it again as a .docx, and upload that copy.");
    const ct = ContentTypes.parse(ctXml);
    const rootRels = parseRels(rootXml, "_rels/.rels");
    const main = rootRels.find((r) => r.type === REL.officeDocument && !r.external);
    if (!main) throw new TemplateError("The file is a zip but not a Word document: it has no main document part. Open it in Word, save it again as a .docx, and upload that copy.");
    const mainName = main.target.replace(/^\//, "");
    if (!pkg.has(mainName)) throw new TemplateError("The Word document is damaged: the main document part is missing. Open the original in Word, save it again as a .docx, and upload that copy.");
    const mainType = ct.typeOf(mainName);
    if (!mainType || !(mainType in MAIN_CONTENT_TYPES)) {
      throw new TemplateError("The file is a zip but not a Word document (it looks like another kind of Office file). Upload a .docx, .dotx or .docm file.");
    }
    const relsName = relsPathFor(mainName);
    const mainRels = pkg.has(relsName) ? parseRels(pkg.text(relsName)!, relsName) : [];
    return new DocPackage(pkg, ct, rootRels, mainName, mainRels);
  }

  /** An empty package ready for the built-in template. */
  static fresh(): DocPackage {
    const ct = new ContentTypes();
    ct.defaults.set("rels", CT.rels);
    ct.defaults.set("xml", CT.xml);
    ct.overrides.set("word/document.xml", CT.main);
    const rootRels: Rel[] = [{ id: "rId1", type: REL.officeDocument, target: "word/document.xml", external: false }];
    return new DocPackage(new Pkg(), ct, rootRels, "word/document.xml", []);
  }

  mainXml(): string {
    return this.pkg.text(this.mainName) ?? "";
  }

  setMainXml(xml: string): void {
    this.pkg.set(this.mainName, xml);
  }

  /** The part a main-document relationship of this type points at. */
  partOf(type: string): string | undefined {
    const r = this.mainRels.find((x) => x.type === type && !x.external);
    if (!r) return undefined;
    return resolveTarget(this.mainName, r.target);
  }

  /** Writes a part and its content type, and (when `relType` is given and the main part has no such relationship yet) links it from the main part. */
  setPart(name: string, data: string | Uint8Array, contentType?: string, relType?: string): void {
    this.pkg.set(name, data);
    if (contentType) this.ct.overrides.set(name, contentType);
    if (relType && !this.mainRels.some((r) => r.type === relType && !r.external)) {
      const base = this.mainName.split("/").slice(0, -1).join("/");
      const target = base && name.startsWith(base + "/") ? name.slice(base.length + 1) : `/${name}`;
      this.mainRels.push({ id: nextRelId(this.mainRels), type: relType, target, external: false });
    }
  }

  /** Removes a part, its content-type override and every relationship (root or main) that points at it. */
  removePart(name: string): void {
    this.pkg.delete(name);
    this.ct.overrides.delete(name);
    const rels = relsPathFor(name);
    this.pkg.delete(rels);
    this.rootRels = this.rootRels.filter((r) => r.external || resolveTarget("x", r.target) !== name);
    this.mainRels = this.mainRels.filter((r) => r.external || resolveTarget(this.mainName, r.target) !== name);
  }

  /** Adds a root-level relationship (document properties) if one of that type is not there yet. */
  ensureRootRel(type: string, target: string): void {
    if (this.rootRels.some((r) => r.type === type)) return;
    this.rootRels.push({ id: nextRelId(this.rootRels), type, target, external: false });
  }

  /** Writes [Content_Types].xml and the relationship parts, then returns the zip. */
  commit(): Uint8Array {
    this.pkg.set("[Content_Types].xml", this.ct.toXml());
    this.pkg.set("_rels/.rels", relsXml(this.rootRels));
    const mainRelsName = relsPathFor(this.mainName);
    if (this.mainRels.length) this.pkg.set(mainRelsName, relsXml(this.mainRels));
    else this.pkg.delete(mainRelsName);
    return this.pkg.toBytes();
  }
}
