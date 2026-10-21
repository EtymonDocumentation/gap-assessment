/** Id and file-name checks. Anything from the client is checked here before it can reach a path. */

const ID_RE = /^[0-9a-f-]{36}$/;
const SOURCE_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

export function isSourceId(value: unknown): value is string {
  return typeof value === "string" && SOURCE_ID_RE.test(value);
}

// Windows device names are reserved even with an extension ("con.txt"), and a trailing dot or space is dropped.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Also zero-width and right-to-left override characters, which can make "evil‮fdp.exe" look like a PDF.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f<>:"/\\|?*​-‏‪-‮⁦-⁩﻿]/g;
const MAX_NAME = 120;

/**
 * A file name that is safe to create on disk: no folders, no control or reserved characters, no reserved
 * Windows device name, no leading or trailing dots and spaces, at most 120 characters, extension kept.
 * Never returns "meta.json", which the file folder uses for its own record.
 */
export function safeName(input: string): string {
  // Keep only the part after the last separator, so "..\\..\\x.exe" becomes "x.exe".
  const last = input.normalize("NFC").split(/[\\/]/).pop() ?? "";
  let name = last.replace(BAD_CHARS, "_").replace(/^[. ]+/, "").replace(/[. ]+$/, "");
  if (!name) return "file";

  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 16) : "";
  base = base.replace(/[. ]+$/, "");
  if (!base) base = "file";
  if (RESERVED.test(base.split(".")[0] ?? "")) base = `_${base}`;
  const extPart = ext ? `.${ext}` : "";
  if (base.length + extPart.length > MAX_NAME) base = base.slice(0, MAX_NAME - extPart.length).replace(/[. ]+$/, "") || "file";
  name = base + extPart;
  if (name.toLowerCase() === "meta.json") name = `_${name}`;
  return name;
}

/** The name as shown back to the user: control characters removed, length capped. */
export function displayName(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "").trim().slice(0, 255) || "file";
}

/** A plain media type, or application/octet-stream when the client sent something odd. */
export function safeContentType(input: string | undefined): string {
  const first = (input ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$/.test(first) ? first : "application/octet-stream";
}
