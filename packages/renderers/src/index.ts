import type { Block, DocModel } from "@gap/engine";

// ------------------------------------------------------------------ Markdown

function mdCell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function mdBlock(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return b.text;
    case "heading":
      return `### ${b.text}`;
    case "note":
      return `> ${b.text}`;
    case "list":
      return b.items.map((i) => `- ${i}`).join("\n");
    case "table": {
      if (!b.rows.length) return "_None._";
      const head = `| ${b.columns.map(mdCell).join(" | ")} |`;
      const sep = `| ${b.columns.map(() => "---").join(" | ")} |`;
      const rows = b.rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`);
      return [head, sep, ...rows].join("\n");
    }
  }
}

export function renderMarkdown(doc: DocModel): string {
  const out: string[] = [];
  out.push(`> **${doc.banner}**`, "");
  out.push(`# ${doc.title}`, "");
  out.push(`**Status:** ${doc.status}`, "");
  for (const [k, v] of doc.meta) out.push(`- **${k}:** ${v}`);
  out.push("");
  for (const s of doc.sections) {
    out.push(`## ${s.number}. ${s.title}`, "");
    for (const b of s.blocks) out.push(mdBlock(b), "");
  }
  out.push("---", "", `_${doc.banner}_`, "");
  return out.join("\n");
}

// ------------------------------------------------------------------ HTML

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function htmlBlock(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return `<p>${escapeHtml(b.text)}</p>`;
    case "heading":
      return `<h3>${escapeHtml(b.text)}</h3>`;
    case "note":
      return `<p class="note">${escapeHtml(b.text)}</p>`;
    case "list":
      return `<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    case "table":
      if (!b.rows.length) return `<p class="none">None.</p>`;
      // Focusable so keyboard users can scroll a wide table sideways.
      return `<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${b.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
  }
}

export const DOCUMENT_CSS = `
.gap-doc { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; max-width: 1100px; margin: 0 auto; }
.gap-doc .banner { border: 2px solid #8a1c1c; color: #8a1c1c; font-weight: 700; padding: 6px 10px; text-align: center; margin-bottom: 16px; }
.gap-doc h1 { font-size: 18pt; margin: 0 0 4px; }
.gap-doc .status { font-weight: 700; letter-spacing: 0.1em; color: #444; }
.gap-doc dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 12px 0 20px; }
.gap-doc dl.meta dt { font-weight: 600; }
.gap-doc dl.meta dd { margin: 0; }
.gap-doc h2 { font-size: 13pt; border-bottom: 1px solid #999; padding-bottom: 2px; margin-top: 24px; }
.gap-doc h3 { font-size: 11pt; margin: 14px 0 6px; }
.gap-doc table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 6px 0 10px; }
.gap-doc th, .gap-doc td { border: 1px solid #888; padding: 3px 5px; vertical-align: top; text-align: left; }
.gap-doc th { background: #e8e8e8; }
.gap-doc .table-wrap { overflow-x: auto; }
.gap-doc .note { font-style: italic; }
.gap-doc .footer { margin-top: 28px; border-top: 1px solid #999; padding-top: 6px; font-size: 9pt; color: #8a1c1c; font-weight: 600; }
@media print {
  @page { size: A4 landscape; margin: 14mm; }
  .gap-doc { max-width: none; }
  .gap-doc h2 { break-after: avoid; }
  .gap-doc tr { break-inside: avoid; }
  .gap-doc thead { display: table-header-group; }
  .gap-doc .table-wrap { overflow: visible; }
}
`;

/** Document body (no <html> wrapper), for in-app preview. */
export function renderHtmlBody(doc: DocModel): string {
  const meta = doc.meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");
  const sections = doc.sections
    .map((s) => `<section id="doc-${s.id}"><h2>${escapeHtml(`${s.number}. ${s.title}`)}</h2>${s.blocks.map(htmlBlock).join("\n")}</section>`)
    .join("\n");
  return `<article class="gap-doc">
<div class="banner" role="note">${escapeHtml(doc.banner)}</div>
<h1>${escapeHtml(doc.title)}</h1>
<div class="status">${escapeHtml(doc.status)}</div>
<dl class="meta">${meta}</dl>
${sections}
<div class="footer">${escapeHtml(doc.banner)}</div>
</article>`;
}

/** Self-contained, print-ready HTML file (PDF via the browser's print dialog). */
export function renderHtml(doc: DocModel): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>body{margin:16px;background:#fff;}${DOCUMENT_CSS}</style>
</head>
<body>
${renderHtmlBody(doc)}
</body>
</html>
`;
}
