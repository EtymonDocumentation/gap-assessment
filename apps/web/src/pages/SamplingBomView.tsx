import type { Block, DocModel } from "@gap/engine";

/**
 * The sampling bill of materials on screen. It is drawn from the same document model as the Word and HTML downloads, so the words,
 * the numbers and the order are the same everywhere. Only the look differs: on a phone each table row becomes a labelled card, so
 * nothing needs sideways scrolling.
 */
const NUMERIC = /^\d+( mL)?$/;

function BomTable({ block, label }: { block: Extract<Block, { type: "table" }>; label: string }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="data bom-table">
        {block.caption && <caption className="small muted">{block.caption}</caption>}
        <thead>
          <tr>
            {block.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" data-label={block.columns[j]}>
                    {cell}
                  </th>
                ) : (
                  <td key={j} data-label={block.columns[j]} className={NUMERIC.test(cell) ? "num" : undefined}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BomBlock({ block, label }: { block: Block; label: string }) {
  switch (block.type) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "note":
      // "Note:" in words, so the cue is not a colour alone.
      return (
        <p className="notice small">
          <strong>Note: </strong>
          {block.text}
        </p>
      );
    case "list":
      return (
        <ul>
          {block.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case "table":
      return <BomTable block={block} label={label} />;
    default:
      return null;
  }
}

export function SamplingBomView({ doc }: { doc: DocModel }) {
  return (
    <section className="card stack" aria-labelledby="bom-view" data-testid="bom-view">
      <h2 id="bom-view">{doc.title.replace(/ — draft$/, "")}</h2>
      {doc.sections.map((s, i) => (
        <div key={s.id} className="stack" data-testid={`bom-section-${s.id}`}>
          {/* The first section is the plain intro of the page, so it needs no heading of its own. */}
          {i > 0 && <h3>{s.title}</h3>}
          {s.blocks.map((b, k) => (
            <BomBlock key={k} block={b} label={`${s.title}, table ${k + 1}`} />
          ))}
        </div>
      ))}
    </section>
  );
}
