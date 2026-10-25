import { useEffect, useRef } from "react";

/*
 * Rows of a table in a process description (and of a library table's starting rows). One input per cell, labelled with its row and
 * column head, and Up / Down / Remove per row. A cell may hold a blank written {{key|Label}}; an empty cell stays empty (nothing is
 * filled in). The editor is controlled: the parent keeps the draft and saves or discards it.
 */

export function RowsEditor({
  columns,
  rows,
  onChange,
  idPrefix,
  name,
}: {
  columns: string[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  idPrefix: string;
  /** What the table is called in the labels read out by a screen reader. */
  name: string;
}) {
  const addBtn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Where focus goes after the next render: a cell of a new or moved row, or the add button after a removal. */
  const focusNext = useRef<{ row: number; col: number } | "add" | "move" | null>(null);
  const moved = useRef<{ row: number; which: "up" | "down" } | null>(null);

  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    if (f === "add") addBtn.current?.focus();
    else if (f === "move") {
      // Focus follows the row that moved, on the same button, so a keyboard user can press it again.
      const m = moved.current;
      moved.current = null;
      if (m) {
        // At the first or last row the pressed button is disabled; focus then goes to its sibling so it is not lost.
        const at = root.current?.querySelector<HTMLElement>(`[data-testid="${idPrefix}-${m.which}-${m.row}"]`);
        const other = root.current?.querySelector<HTMLElement>(`[data-testid="${idPrefix}-${m.which === "up" ? "down" : "up"}-${m.row}"]`);
        (at && !(at as HTMLButtonElement).disabled ? at : other)?.focus();
      }
    } else if (f) {
      root.current?.querySelector<HTMLElement>(`[data-testid="${idPrefix}-cell-${f.row}-${f.col}"]`)?.focus();
    }
  });

  const width = columns.length;
  const set = (r: number, c: number, v: string) => onChange(rows.map((row, i) => (i === r ? Array.from({ length: width }, (_, j) => (j === c ? v : (row[j] ?? ""))) : row)));
  const swap = (r: number, by: -1 | 1) => {
    const j = r + by;
    if (j < 0 || j >= rows.length) return;
    const n = [...rows];
    [n[r], n[j]] = [n[j]!, n[r]!];
    moved.current = { row: j, which: by === -1 ? "up" : "down" };
    focusNext.current = "move";
    onChange(n);
  };

  return (
    <div className="stack" ref={root} data-testid={`${idPrefix}-editor`}>
      {rows.length === 0 ? (
        <p className="muted small" data-testid={`${idPrefix}-none`}>
          No rows yet. The document shows the column heads and one empty row to fill in.
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label={`Rows of ${name}`} tabIndex={0}>
          <table className="data rows-editor">
            <thead>
              <tr>
                <th scope="col">Row</th>
                {columns.map((c, i) => (
                  <th key={i} scope="col">
                    {c}
                  </th>
                ))}
                <th scope="col">Change row</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <th scope="row">{r + 1}</th>
                  {columns.map((c, j) => (
                    <td key={j}>
                      <input
                        value={row[j] ?? ""}
                        aria-label={`Row ${r + 1}, ${c}`}
                        data-testid={`${idPrefix}-cell-${r}-${j}`}
                        onChange={(e) => set(r, j, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <span className="row wrap">
                      <button type="button" className="btn small" aria-label={`Move row ${r + 1} up`} data-testid={`${idPrefix}-up-${r}`} disabled={r === 0} onClick={() => swap(r, -1)}>
                        Up
                      </button>
                      <button type="button" className="btn small" aria-label={`Move row ${r + 1} down`} data-testid={`${idPrefix}-down-${r}`} disabled={r === rows.length - 1} onClick={() => swap(r, 1)}>
                        Down
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        aria-label={`Remove row ${r + 1}`}
                        data-testid={`${idPrefix}-remove-${r}`}
                        onClick={() => {
                          focusNext.current = "add";
                          onChange(rows.filter((_, i) => i !== r));
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button
          ref={addBtn}
          type="button"
          className="btn small"
          data-testid={`${idPrefix}-add`}
          onClick={() => {
            focusNext.current = { row: rows.length, col: 0 };
            onChange([...rows, columns.map(() => "")]);
          }}
        >
          Add a row
        </button>
      </div>
    </div>
  );
}
