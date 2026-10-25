/*
 * A small generated placeholder picture for the fictional demo TRD ("a picture goes here"). It is drawn from nothing but arithmetic
 * (a flat panel, a frame and two diagonals), so the repository holds no image file and no photograph, and the demo is the same on every
 * machine. PNG needs a CRC-32 per chunk and an Adler-32 over the zlib stream; the pixel data is stored, not compressed (it is tiny).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): number[] {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** A width x height PNG: pale panel, dark frame, two diagonals. Fictional placeholder, not a drawing of anything real. */
export function placeholderPng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const frame = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
      const diagonal = Math.abs(x / width - y / height) < 0.006 || Math.abs(x / width - (1 - y / height)) < 0.006;
      const [r, g, b] = frame || diagonal ? [40, 70, 110] : [225, 232, 242];
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const z: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(raw.length, i + 65535));
    const last = i + 65535 >= raw.length ? 1 : 0;
    z.push(last, part.length & 255, part.length >>> 8, ~part.length & 255, (~part.length >>> 8) & 255, ...part);
  }
  z.push(...u32(adler32(raw)));
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", ihdr), ...chunk("IDAT", new Uint8Array(z)), ...chunk("IEND", new Uint8Array(0))]);
}
