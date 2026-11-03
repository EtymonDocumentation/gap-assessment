import { TRD_DATA_NAMESPACE } from "@gap/engine";
import type { DocPackage } from "./docpkg";
import type { Pkg } from "./package";
import { XML_DECL, childElements, esc, localName, parseXml, textOf } from "./xml";

/**
 * The data part of a Word file (upload of a finished TRD, levels 1 and 2).
 *
 * The TRD record, or the form description, travels inside the file as a Word "custom XML part" (customXml/cascade-data.xml). Word keeps
 * such a part untouched when a person edits and saves the document, and it does not show it, so the file can be read back exactly while
 * the visible text is whatever the person made of it. The JSON is stored as escaped text (not CDATA) so any XML tool keeps it intact.
 */

export const DATA_PART = "customXml/cascade-data.xml";
const PROPS_PART = "customXml/cascade-dataProps1.xml";
const REL_CUSTOM_XML = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const REL_CUSTOM_XML_PROPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps";
const CT_CUSTOM_PROPS = "application/vnd.openxmlformats-officedocument.customXmlProperties+xml";

export interface DataPart {
  /** "trd-data" for an export, "trd-form" for a fill-in form. */
  kind: "trd-data" | "trd-form";
  json: string;
}

/** Adds the data part to a package: the part, its properties, the relationship from the document and the content types. */
export function writeDataPart(dp: DocPackage, data: DataPart): void {
  const xml = `${XML_DECL}<cascade xmlns="${TRD_DATA_NAMESPACE}" kind="${data.kind}">${esc(data.json)}</cascade>`;
  dp.pkg.set(DATA_PART, xml);
  dp.ct.overrides.set(DATA_PART, "application/xml");
  const id = "{6F1D2C54-8A3B-4E7D-9C10-5B2E7A4D1C01}";
  dp.pkg.set(PROPS_PART, `${XML_DECL}<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="${id}"><ds:schemaRefs><ds:schemaRef ds:uri="${TRD_DATA_NAMESPACE}"/></ds:schemaRefs></ds:datastoreItem>`);
  dp.ct.overrides.set(PROPS_PART, CT_CUSTOM_PROPS);
  // The part's own relationship file points at its properties.
  dp.pkg.set(
    "customXml/_rels/cascade-data.xml.rels",
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_CUSTOM_XML_PROPS}" Target="cascade-dataProps1.xml"/></Relationships>`,
  );
  const used = new Set(dp.mainRels.map((r) => r.id));
  let n = 1;
  while (used.has(`rIdCascadeData${n}`)) n++;
  dp.mainRels = dp.mainRels.filter((r) => !(r.type === REL_CUSTOM_XML && r.target === "../" + DATA_PART));
  dp.mainRels.push({ id: `rIdCascadeData${n}`, type: REL_CUSTOM_XML, target: "../" + DATA_PART, external: false });
}

/** Finds our data part in any package, whatever its name (Word may rename custom parts on save). */
export function readDataPart(pkg: Pkg): DataPart | undefined {
  for (const name of pkg.names()) {
    if (!/^customXml\/[^/]+\.xml$/i.test(name) || /props/i.test(name)) continue;
    const text = pkg.text(name);
    if (!text || !text.includes(TRD_DATA_NAMESPACE)) continue;
    try {
      const root = parseXml(text, name).documentElement;
      if (localName(root) !== "cascade" || root.namespaceURI !== TRD_DATA_NAMESPACE) continue;
      const kind = root.getAttribute("kind");
      if (kind !== "trd-data" && kind !== "trd-form") continue;
      const json = childElements(root).length ? "" : textOf(root);
      if (json) return { kind, json };
    } catch {
      // A damaged part counts as no data part: the file is then treated like any other layout.
    }
  }
  return undefined;
}
