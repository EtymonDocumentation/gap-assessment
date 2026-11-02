import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The colour tokens of the Cascade look live in src/styles.css. This test reads them from there (so it cannot drift from the file the
// browser gets) and checks WCAG 2.2 AA: 4.5:1 for text, 3:1 for the edges, icons and rings that carry meaning, in the light theme and the
// dark theme. It also keeps the two dark blocks identical, because the dark theme is written twice (follow the system, or chosen).

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/** The text between the braces of the rule that starts with `selector` (first match, nesting-aware). */
function ruleBody(selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`rule not found: ${selector}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed rule: ${selector}`);
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = declarations(ruleBody(":root {"));
const darkSystem = declarations(ruleBody(':root:not([data-theme="light"])'));
const darkChosen = declarations(ruleBody(':root[data-theme="dark"]'));
const dark = { ...light, ...darkChosen };

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [what, foreground token, background token, minimum ratio] */
const PAIRS: [string, string, string, number][] = [
  ["text on the page", "--text", "--bg", 4.5],
  ["text on a card", "--text", "--surface", 4.5],
  ["text on a raised surface", "--text", "--surface-2", 4.5],
  ["muted text on the page", "--muted", "--bg", 4.5],
  ["muted text on a card", "--muted", "--surface", 4.5],
  ["muted text on a raised surface", "--muted", "--surface-2", 4.5],
  ["a link on the page", "--accent", "--bg", 4.5],
  ["a link on a card", "--accent", "--surface", 4.5],
  ["accent text on the soft accent tint", "--accent", "--accent-soft", 4.5],
  ["text on the soft accent tint", "--text", "--accent-soft", 4.5],
  ["primary button text", "--accent-text", "--accent", 4.5],
  ["primary button text, hovered", "--accent-text", "--accent-hover", 4.5],
  ["a hovered link on a card", "--accent-hover", "--surface", 4.5],
  ["the notice strip", "--banner-text", "--banner-bg", 4.5],
  ["success text", "--ok", "--surface", 4.5],
  ["error text", "--danger", "--surface", 4.5],
  ["warning text on its tint", "--warn", "--warn-bg", 4.5],
  ["warning text on a card", "--warn", "--surface", 4.5],
  ["error text on the warning tint", "--danger", "--warn-bg", 4.5],
  ["the warning border on its tint", "--warn-border", "--warn-bg", 3],
  ["the warning border on a card", "--warn-border", "--surface", 3],
  ["the edge of a text field on a card", "--field-border", "--surface", 3],
  ["the edge of a text field on the page", "--field-border", "--bg", 3],
  ["the accent bar under a tab", "--accent", "--surface", 3],
  ["the accent bar under the current stage", "--accent", "--accent-soft", 3],
  ["the focus ring on the page", "--focus", "--bg", 3],
  ["the focus ring on a card", "--focus", "--surface", 3],
  ["the focus ring on the soft accent tint", "--focus", "--accent-soft", 3],
  ["header links", "--header-link", "--header-bg", 4.5],
  ["header links, hovered", "--header-link", "--header-hover", 4.5],
  ["the current header link", "--header-text", "--header-bg", 4.5],
  ["the current header link, hovered", "--header-text", "--header-hover", 4.5],
  ["the bar under the current header link and the mark", "--header-accent", "--header-bg", 3],
  ["the focus ring inside the header", "--header-focus", "--header-bg", 3],
];

describe("colour tokens (styles.css)", () => {
  it("keeps the two dark blocks identical (system dark and chosen dark)", () => {
    // The system block is only the overrides too, so the two must list the same tokens with the same values.
    expect(darkSystem).toEqual(darkChosen);
    expect(Object.keys(darkChosen).length).toBeGreaterThan(20);
  });

  it("has the light tokens of the design", () => {
    expect(light).toMatchObject({
      "--bg": "#f6f7f9",
      "--text": "#16202b",
      "--muted": "#55606d",
      "--border": "#c9d0d8",
      "--divider": "#e3e7ec",
      "--accent": "#1f5f8b",
      "--accent-hover": "#16476a",
      "--accent-soft": "#e2eef7",
      "--header-bg": "#16202b",
      "--header-link": "#a3afbc",
      "--header-accent": "#7cb8e4",
      "--ok": "#1d6b3a",
      "--warn": "#8a4600",
      "--warn-bg": "#fff7ee",
      "--warn-border": "#b35c00",
      "--banner-bg": "#7a1717",
    });
  });

  for (const [theme, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it(`passes WCAG 2.2 AA for every pair in the ${theme} theme`, () => {
      const failures: string[] = [];
      for (const [what, fg, bg, min] of PAIRS) {
        const a = tokens[fg];
        const b = tokens[bg];
        if (!a || !b) {
          failures.push(`${what}: ${fg} or ${bg} is not defined`);
          continue;
        }
        const ratio = contrast(a, b);
        if (ratio < min) failures.push(`${what}: ${fg} ${a} on ${bg} ${b} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
      expect(failures).toEqual([]);
    });
  }
});

describe("fonts (styles.css, index.html)", () => {
  it("serves IBM Plex Sans 400, 500, 600 and 700 (latin) from the site, with a system fallback", () => {
    for (const weight of [400, 500, 600, 700]) {
      expect(css).toContain(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`);
    }
    expect(light["--font"]).toMatch(/^"IBM Plex Sans", system-ui/);
    expect(css.match(/font-display:\s*swap/g)).toHaveLength(4);
  });

  it("never loads a font, script or style from another site", () => {
    for (const text of [css, indexHtml]) {
      expect(text).not.toMatch(/fonts\.googleapis|fonts\.gstatic|use\.typekit|cdn\./i);
    }
    expect(css).not.toMatch(/@import\s+url\(\s*["']?https?:/i);
  });
});
