/**
 * Colours of the built-in Word look, kept in one place so a test can check the contrast of every text and shading pair.
 * Shading never carries meaning alone: the category and severity cells always keep their text.
 */

/** The one accent colour (deep blue): title, headings, table header rows. */
export const ACCENT = "1F4E79";
export const ON_ACCENT = "FFFFFF";
/** Table body text is "automatic" colour, which Word draws black on light shading. */
export const BODY_TEXT = "000000";
/** Colour of the proof-of-concept banner (dark red, as in the HTML document). */
export const BANNER_COLOR = "8A1C1C";
/** Pale red fill of the cover-page banner box. */
export const BANNER_FILL = "FDF0F0";
/** Sub-headings below level 2. */
export const MUTED_HEADING = "404040";
/** Title line of the page header. */
export const HEADER_TEXT = "595959";
/** Alternate body rows. */
export const ZEBRA_FILL = "F2F6FA";
/** Label cells of the cover and document-control fact tables. */
export const LABEL_FILL = "DCE6F1";
/** Thin table borders in the built-in look. */
export const BORDER_COLOR = "A6A6A6";
/** Shading of a category or severity value that is not recognised, and of "None" / "Equivalent". */
export const NEUTRAL_TINT = "EDEDED";

export const SEVERITY_TINTS = { high: "F4CCCC", medium: "FFE8B3", low: "D9EAD3", none: NEUTRAL_TINT } as const;

/** One subtle tint per gap category. Matched on the start of the cell text, so labels worded for a program stage still match. */
export const CATEGORY_TINTS: { key: string; match: RegExp; fill: string }[] = [
  { key: "equivalent", match: /^equivalent\b/, fill: NEUTRAL_TINT },
  { key: "within_validated_range", match: /^within\b/, fill: "E2EFDA" },
  { key: "outside_validated_range", match: /^outside\b/, fill: "FCE4D6" },
  { key: "different_principle", match: /^different\b/, fill: "E4DFEC" },
  { key: "scale_change", match: /^scale\b/, fill: "FFF2CC" },
  { key: "new_requirement", match: /^new requirement\b/, fill: "DDEBF7" },
  { key: "removed_element", match: /^removed\b/, fill: "F8E0E0" },
  { key: "information_required", match: /^information required\b/, fill: "D9F0EE" },
];

export type Tint = (cellText: string) => string | undefined;

function severityTint(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const m = /^(high|medium|low|none)\b/i.exec(t);
  return m ? SEVERITY_TINTS[m[1]!.toLowerCase() as keyof typeof SEVERITY_TINTS] : NEUTRAL_TINT;
}

function categoryTint(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return CATEGORY_TINTS.find((c) => c.match.test(t))?.fill ?? NEUTRAL_TINT;
}

/** The shading function for a table column, found by its header text (never by the values), or undefined for an ordinary column. */
export function tintForColumn(header: string): Tint | undefined {
  const h = header.trim().toLowerCase();
  if (h === "severity") return severityTint;
  if (h === "category") return categoryTint;
  return undefined;
}

/** Every text colour on a shading colour that the built-in look uses. */
export interface ColourPair {
  name: string;
  fg: string;
  bg: string;
}

export const CONTRAST_PAIRS: ColourPair[] = [
  { name: "table header text on accent", fg: ON_ACCENT, bg: ACCENT },
  { name: "heading text on page", fg: ACCENT, bg: "FFFFFF" },
  { name: "sub-heading text on page", fg: MUTED_HEADING, bg: "FFFFFF" },
  { name: "page header title on page", fg: HEADER_TEXT, bg: "FFFFFF" },
  { name: "banner text on page", fg: BANNER_COLOR, bg: "FFFFFF" },
  { name: "banner text on cover banner box", fg: BANNER_COLOR, bg: BANNER_FILL },
  { name: "table text on zebra row", fg: BODY_TEXT, bg: ZEBRA_FILL },
  { name: "table text on fact label cell", fg: BODY_TEXT, bg: LABEL_FILL },
  { name: "table text on neutral tint", fg: BODY_TEXT, bg: NEUTRAL_TINT },
  ...Object.entries(SEVERITY_TINTS).map(([k, bg]) => ({ name: `table text on severity ${k}`, fg: BODY_TEXT, bg })),
  ...CATEGORY_TINTS.map((c) => ({ name: `table text on category ${c.key}`, fg: BODY_TEXT, bg: c.fill })),
];

/** WCAG 2 contrast ratio of two RRGGBB colours. */
export function contrastRatio(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const ch = [0, 2, 4].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
