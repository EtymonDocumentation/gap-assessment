import type { ViewBlock } from "@gap/engine";
import type { RefObject } from "react";
import { Empty } from "../components";

/**
 * "Your document as read": the left pane of every upload review screen (TRD and sampling plan). It shows the file's headings, text and
 * tables; a cell that fed a field is marked "used", a cell typed over in Word is marked "Changed in Word", and while the person is
 * picking a value, a press on a cell takes its text. It knows nothing about what the fields are, so each document type shares it.
 */
export interface ImportDocPaneProps {
  blocks: ViewBlock[];
  /** Cell position ("block:row:col") -> ids of the fields it fed. */
  cellFields: Record<string, string[]>;
  /** Whether any of these fields is a "Changed in Word" row. */
  anyChanged: (ids: string[]) => boolean;
  /** The name of the value being picked, or null. */
  picking: string | null;
  onTake: (text: string) => void;
  onCancelPick: () => void;
  open: boolean;
  setOpen: (f: (o: boolean) => boolean) => void;
  innerRef: RefObject<HTMLDivElement | null>;
}

export function ImportDocPane({ blocks, cellFields, anyChanged, picking, onTake, onCancelPick, open, setOpen, innerRef }: ImportDocPaneProps) {
  return (
    <section className="import-doc" aria-labelledby="import-doc-h" ref={innerRef} data-testid="import-doc">
      <h2 id="import-doc-h">Your document as read</h2>
      <button type="button" className="btn small import-doc-toggle" aria-expanded={open} aria-controls="import-doc-body" onClick={() => setOpen((o) => !o)} data-testid="import-doc-toggle">
        {open ? "Hide the document" : "Show the document"}
      </button>
      {picking && (
        <div className="notice stack" role="status" data-testid="import-picking">
          <p>
            Picking a value for <strong>{picking}</strong>. Press a cell below, or select text in the document and press "Use selected text".
          </p>
          <div className="row wrap">
            <button type="button" className="btn small" onClick={() => onTake(window.getSelection()?.toString() ?? "")} data-testid="import-use-selection">
              Use selected text
            </button>
            <button type="button" className="btn small ghost" onClick={onCancelPick}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div id="import-doc-body" className={`import-doc-body stack${open ? "" : " collapsed"}`}>
        {blocks.length === 0 && <Empty>The file has no readable text.</Empty>}
        {blocks.map((b, bi) => {
          if (b.kind === "heading") return <p key={bi} className="import-doc-heading">{b.text}</p>;
          if (b.kind === "para") return <p key={bi} className="small">{b.text}</p>;
          const tableNo = blocks.slice(0, bi + 1).filter((x) => x.kind === "table").length;
          return (
            <div key={bi} id={`imp-table-${bi}`} className="table-scroll" role="region" aria-label={`Table ${tableNo} of the document${b.page ? `, page ${b.page}` : ""}`} tabIndex={0}>
              <table className="data import-doc-table">
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => {
                        // The continuation of a vertical merge is covered by the cell above (its rowSpan).
                        if (c.vContinue) return null;
                        const key = `${bi}:${ri}:${ci}`;
                        const used = cellFields[key] ?? [];
                        const changed = anyChanged(used);
                        const cell = ri === 0 ? "th" : "td";
                        const content = (
                          <>
                            {c.text || <span className="muted">(empty)</span>}
                            {changed && <span className="tag status-partial status"> Changed in Word</span>}
                            {!changed && used.length > 0 && <span className="tag"> used</span>}
                          </>
                        );
                        const props = { id: `imp-cell-${key.replace(/:/g, "-")}`, tabIndex: -1, ...(c.colSpan ? { colSpan: c.colSpan } : {}), ...(c.rowSpan ? { rowSpan: c.rowSpan } : {}) };
                        return cell === "th" ? (
                          <th key={ci} scope="col" {...props}>
                            {content}
                          </th>
                        ) : (
                          <td key={ci} {...props}>
                            {picking && c.text && !c.controlId ? (
                              <button type="button" className="btn small ghost" onClick={() => onTake(c.text)}>
                                {content}
                              </button>
                            ) : (
                              content
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}
