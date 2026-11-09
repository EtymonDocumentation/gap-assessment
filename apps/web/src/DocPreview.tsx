import type { MouseEvent } from "react";

/**
 * The on-screen preview of a document. The HTML is built from escaped text by renderHtmlPreview (every value passes through escapeHtml).
 * A long table shows its first rows and a "Show all N rows" button (EOU-44): a first reader used to meet a page 200,000 px tall. The button is in
 * the HTML string, so one click handler here reveals the rest of that table. The downloads never use this: they always hold every row.
 */
export function DocPreview({ html, testId }: { html: string; testId?: string }) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-show-all]");
    const note = button?.closest("p.preview-rows");
    if (!button || !note) return;
    // The table is the block just before the note. The rows are un-hidden, and the note says so in words (it is a status line, so a screen
    // reader announces it). Focus moves to the note's table region so a keyboard user is not left on a button that has gone.
    const region = note.previousElementSibling as HTMLElement | null;
    region?.querySelectorAll("tr.preview-more-row").forEach((tr) => tr.classList.remove("preview-more-row"));
    note.textContent = `All ${button.dataset.showAll} rows are shown.`;
    region?.focus();
  };
  return <div className="doc-preview" {...(testId ? { "data-testid": testId } : {})} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
