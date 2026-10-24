import type { SamplingPlan } from "@gap/process-model";
import { buildFigures, figureCaption, FIGURE_STYLE_LABEL, type FigureStyle } from "@gap/sampling";
import { useEffect, useMemo, useRef, useState } from "react";

/*
 * The PPQ flow figure on the sampling page: the same drawing the Word and HTML exports use (one pure function in @gap/sampling),
 * switched to its interactive form. Pointing at or focusing a sample in the drawing highlights its row in the sampling table, and
 * the other way round. The highlight is an outline and a thicker line, not colour alone, and a keyboard user reaches every sample
 * with Tab; Enter or Space on one selects the point.
 *
 * The SVG string comes from the figure function, which escapes every plan text it writes, so it is safe to insert as markup.
 */

const idsOf = (el: Element | null): string[] => (el?.getAttribute("data-sp") ?? "").split(" ").filter(Boolean);

export function FigureView({
  plan,
  highlightId,
  onHighlight,
  onSelect,
}: {
  plan: SamplingPlan;
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const [style, setStyle] = useState<Exclude<FigureStyle, "none">>("time_scale");
  const figures = useMemo(() => buildFigures(plan, { style, interactive: true }), [plan, style]);
  const root = useRef<HTMLDivElement>(null);

  // Mirror the highlighted id onto the drawing (outside React, because the SVG is inserted as markup).
  useEffect(() => {
    root.current?.querySelectorAll(".fig-hl").forEach((n) => n.classList.remove("fig-hl"));
    if (!highlightId) return;
    root.current?.querySelectorAll("[data-sp]").forEach((n) => {
      if (idsOf(n).includes(highlightId)) n.classList.add("fig-hl");
    });
  }, [highlightId, figures]);

  const mark = (e: { target: EventTarget }) => (e.target as Element).closest?.("[data-sp]") ?? null;
  const first = (el: Element | null) => idsOf(el)[0] ?? null;

  if (!plan.steps.length) return null;
  return (
    <section className="card stack" aria-labelledby="sp-figure-h" data-testid="plan-figure">
      <h2 id="sp-figure-h">PPQ flow figure</h2>
      <p className="muted small">
        The same figure goes into the Word and HTML documents. Point at or focus a sample to see its row in the table below; the table is the full record. Times that are not given are drawn as narrow blocks and listed under the figure.
      </p>
      <div role="group" aria-label="Figure style" className="row wrap seg">
        {(["time_scale", "step_cards"] as const).map((s) => (
          <button key={s} type="button" className={style === s ? "btn primary" : "btn"} aria-pressed={style === s} onClick={() => setStyle(s)} data-testid={`figure-style-${s}`}>
            {FIGURE_STYLE_LABEL[s]}
          </button>
        ))}
      </div>
      <div
        ref={root}
        className="stack"
        onMouseOver={(e) => onHighlight(first(mark(e)))}
        onMouseOut={(e) => {
          if (mark(e)) onHighlight(null);
        }}
        onFocus={(e) => onHighlight(first(mark(e)))}
        onBlur={(e) => {
          if (mark(e)) onHighlight(null);
        }}
        onClick={(e) => {
          const id = first(mark(e));
          if (id) onSelect(id);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          const id = first(mark(e));
          if (id) {
            e.preventDefault();
            onSelect(id);
          }
        }}
      >
        {figures.map((f) => (
          <figure key={f.number} className="figure" data-testid={`figure-${f.number}`}>
            <p className="small muted fig-scroll-hint" data-testid={`figure-hint-${f.number}`}>
              Scroll sideways to see the whole figure.
            </p>
            {f.pages.map((pg, i) => (
              <div key={i} className="table-scroll figure-sheet" role="region" aria-label={figureCaption(f, i)} tabIndex={0} dangerouslySetInnerHTML={{ __html: pg.svg }} />
            ))}
            <figcaption className="small">
              Figure {f.number}: {f.caption}
            </figcaption>
            {f.hoursNotGiven.length > 0 && (
              <p className="small muted" data-testid={`figure-nohours-${f.number}`}>
                Hours not given: {f.hoursNotGiven.join(", ")}.
              </p>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}
