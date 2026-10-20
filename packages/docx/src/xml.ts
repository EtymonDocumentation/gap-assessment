import { DOMParser } from "@xmldom/xmldom";
import { TemplateError } from "./errors";

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Drops characters that are not allowed in XML 1.0 (control characters, lone surrogates, U+FFFE/U+FFFF). */
export function cleanXmlText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd)) {
      out += s[i];
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      }
    }
  }
  return out;
}

/** Escapes text for use in element content or in a double-quoted attribute. Illegal characters are dropped first. */
export function esc(s: string): string {
  return cleanXmlText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Decodes the five predefined entities and numeric character references (for text read out of template XML). */
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff) return m;
    try {
      return String.fromCodePoint(code);
    } catch {
      return m;
    }
  });
}

export const MAX_XML_PART_BYTES = 30 * 1024 * 1024;

/**
 * Parses XML that came from an untrusted file. Rejects document type declarations (which Office files never
 * contain, and which are the way to attack XML parsers) and any parse error. Nothing is evaluated.
 */
export function parseXml(xml: string, label: string): Document {
  if (xml.length > MAX_XML_PART_BYTES) throw new TemplateError(`The part "${label}" inside the file is too large to read safely.`);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new TemplateError(`The part "${label}" inside the file contains a document type declaration, which Word files never have. The file was not read.`);
  }
  let problem: string | undefined;
  let doc: Document;
  try {
    doc = new DOMParser({
      onError: (level, msg) => {
        if (level !== "warning" && !problem) problem = msg.split("\n")[0];
      },
    }).parseFromString(xml.replace(/^﻿/, ""), "text/xml") as unknown as Document;
  } catch (e) {
    problem = (e as Error).message.split("\n")[0];
    doc = undefined as never;
  }
  if (problem || !doc || !doc.documentElement) {
    throw new TemplateError(`The part "${label}" inside the file is not valid XML (${problem ?? "empty"}). The file may be damaged: open it in Word, save it again as a .docx, and upload that copy.`);
  }
  return doc;
}

export function childElements(node: Node): Element[] {
  const out: Element[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

export function localName(el: Element): string {
  return el.localName ?? el.nodeName.replace(/^.*:/, "");
}

/** Attribute value by local name (prefix ignored), or undefined. */
export function attrByLocal(el: Element, name: string): string | undefined {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i)!;
    if ((a.localName ?? a.name.replace(/^.*:/, "")) === name) return a.value;
  }
  return undefined;
}

export function firstChildByLocal(el: Element, name: string): Element | undefined {
  return childElements(el).find((c) => localName(c) === name);
}

/** Plain text of an element: all descendant text nodes. */
export function textOf(node: Node): string {
  let s = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue ?? "";
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(node);
  return s;
}
