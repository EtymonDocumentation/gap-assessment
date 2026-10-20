/**
 * Keys for user-defined unit operations and items.
 * A custom key is "x_" followed by lowercase letters, digits and underscores, so it is a valid
 * path segment (no dots) and can never collide with a catalog key.
 */
export const CUSTOM_KEY_PREFIX = "x_";
export const CUSTOM_KEY_MAX = 40;

const CUSTOM_KEY = /^x_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function isValidCustomKey(key: string): boolean {
  return key.length <= CUSTOM_KEY_MAX && CUSTOM_KEY.test(key);
}

export function isCustomKey(key: string): boolean {
  return key.startsWith(CUSTOM_KEY_PREFIX);
}

/**
 * Generates a key from a label: lowercase, "x_" prefix, [a-z0-9_] only, unique among `taken`.
 * Accented letters are reduced to their base letter. A label with no usable characters gives "x_item".
 */
export function customKeyFromLabel(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const maxBase = CUSTOM_KEY_MAX - CUSTOM_KEY_PREFIX.length - 4;
  const base = `${CUSTOM_KEY_PREFIX}${slug.slice(0, maxBase).replace(/_+$/g, "") || "item"}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const k = `${base}_${n}`;
    if (!used.has(k)) return k;
  }
}
