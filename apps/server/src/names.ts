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

// Direction-override and zero-width characters can make "evil‮fdp.exe" look like a PDF; path separators would
// make a label read as a path in the download name.
// eslint-disable-next-line no-control-regex
const LABEL_BAD = /[\u0000-\u001f\u007f-\u009f/\\\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
export const MAX_LABEL = 200;

/**
 * A name as shown and stored in "My files" for a file or a folder. It never decides a path on disk (files are stored
 * under their id; see myfiles.ts), so it keeps spaces, dots in the middle and non-ASCII letters, but it can never hold
 * a path separator, a control or direction-override character, and is never "." or "..". Returns null when nothing usable
 * is left, so the caller can answer 400 instead of inventing a name.
 */
export function cleanLabel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let name = input.normalize("NFC").replace(LABEL_BAD, "_").trim();
  if (name.length > MAX_LABEL) {
    // Keep a short extension when cutting, so a long photo name still ends in ".png".
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, MAX_LABEL - ext.length).trimEnd() + ext;
  }
  if (!name || name === "." || name === "..") return null;
  return name;
}
