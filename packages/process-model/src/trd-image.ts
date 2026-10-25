import { TRD_IMAGE_MAX_BYTES, TRD_IMAGE_TYPES, type TrdImage, type TrdImageType } from "./trd-writeups";

/*
 * Reading a picture for a TRD figure. Pure (no canvas, no Buffer), so the browser, the server tests and the export all use the same
 * rules. The type is decided from the FIRST BYTES of the file, never from its name or the type the browser reports: a file called
 * ".png" that is something else is refused, and so is a picture type the Word export cannot place (GIF, WebP, SVG).
 */

export class TrdImageError extends Error {}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The plain-words limit shown next to the file picker and in every refusal. */
export const TRD_IMAGE_LIMIT_TEXT = "A PNG or JPEG picture of at most 2 MB. Pictures are kept inside the project file, so a TRD can hold at most 10 MB of them.";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  // In slices so a 2 MB picture does not overflow the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The type of a picture from its first bytes, or undefined when it is neither PNG nor JPEG. */
export function sniffTrdImage(b: Uint8Array): TrdImageType | undefined {
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return undefined;
}

/** Pixel size of a PNG (header chunk) or a JPEG (first frame header). Undefined when the file is cut short or malformed. */
export function trdImageSize(b: Uint8Array, mime: TrdImageType): { width: number; height: number } | undefined {
  if (mime === "image/png") {
    if (b.length < 24) return undefined;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Markers without a length: standalone ones.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    // Start-of-frame markers carry the size; C4 (huffman), C8 (reserved) and CC (arithmetic) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5]! << 8) | b[i + 6]!;
      const width = (b[i + 7]! << 8) | b[i + 8]!;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    if (len < 2) return undefined;
    i += 2 + len;
  }
  return undefined;
}

/**
 * Checks a file's bytes and makes the picture record. Throws a TrdImageError saying in plain words what is wrong and what the limit
 * is. `sha256` comes from the caller (hashing is asynchronous in the browser).
 */
export function readTrdImage(bytes: Uint8Array, opts: { name?: string; sha256?: string } = {}): TrdImage {
  if (!bytes.length) throw new TrdImageError("That file is empty.");
  if (bytes.length > TRD_IMAGE_MAX_BYTES) {
    throw new TrdImageError(`That picture is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. ${TRD_IMAGE_LIMIT_TEXT} Make it smaller (for example, save it as a JPEG or crop it) and add it again.`);
  }
  const mime = sniffTrdImage(bytes);
  if (!mime) throw new TrdImageError(`That file is not a PNG or JPEG picture. ${TRD_IMAGE_LIMIT_TEXT}`);
  if (!TRD_IMAGE_TYPES.includes(mime)) throw new TrdImageError("That picture type cannot be used.");
  const size = trdImageSize(bytes, mime);
  if (!size) throw new TrdImageError("That picture could not be read; the file looks damaged. Save it again and add it again.");
  return { mime, data: bytesToBase64(bytes), bytes: bytes.length, width: size.width, height: size.height, ...(opts.name ? { name: opts.name } : {}), ...(opts.sha256 ? { sha256: opts.sha256 } : {}) };
}

/** What the change log keeps of a picture: who-can-tell-which-one facts, not the bytes (they would double the project file). */
export function trdImageMeta(i: TrdImage): Omit<TrdImage, "data"> & { dataKept: false } {
  const { data: _data, ...rest } = i;
  void _data;
  return { ...rest, dataKept: false };
}

/** `data:` URL of a picture, for an <img> on screen. */
export const trdImageUrl = (i: Pick<TrdImage, "mime" | "data">): string => `data:${i.mime};base64,${i.data}`;
