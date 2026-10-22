import { addSubsection, buildTrdSeed, moveSubsection, removeSubsection, updateSubsection } from "@gap/engine";
import { SAMPLING_TYPES, type CustomSubsection, type SamplingPlan } from "@gap/process-model";
import {
  FIXED_SECTION_KEYS,
  SUBSECTION_TOKENS,
  TAIL_SECTION_KEYS,
  TYPE_LABEL,
  isPlacement,
  libraryNote,
  parseSubsectionText,
  placementAfter,
  placementInPoint,
  placementInType,
  placementLabel,
  renderSubsection,
  subsectionText,
  tokenContext,
  typeSectionKey,
} from "@gap/sampling";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "../components";
import { itemOf, newLibraryId, useSubsectionLibrary } from "../subsections-library-store";
import { useContent, useStore } from "../store";

type Run = (fn: Parameters<ReturnType<typeof useStore.getState>["update"]>[0], status: string) => boolean;

const KINDS = [
  { kind: "appendix", label: "In an appendix" },
  { kind: "after_section", label: "After a section of the plan" },
  { kind: "in_study_type", label: "Inside a study-type section" },
  { kind: "in_point", label: "Inside a point" },
] as const;

/**
 * Chooses where a subsection goes. Nothing is preselected for a new subsection (value ""), so the person decides. `plan` is absent
 * on the library page, where a subsection is not tied to a point.
 */
export function PlacementPicker({ value, onChange, plan, idPrefix }: { value: string; onChange: (v: string) => void; plan?: SamplingPlan | undefined; idPrefix: string }) {
  const [kind, rest = ""] = value.split(":");
  const kinds = KINDS.filter((k) => plan || k.kind !== "in_point");
  const sectionOptions = [...FIXED_SECTION_KEYS, ...SAMPLING_TYPES.map((t) => ({ key: typeSectionKey(t), title: TYPE_LABEL[t] })), ...TAIL_SECTION_KEYS];
  return (
    <div className="row wrap end-align">
      <label className="field">
        <span>Where it goes</span>
        <select
          value={kind ?? ""}
          data-testid={`${idPrefix}-placement-kind`}
          onChange={(e) => {
            const k = e.target.value;
            onChange(k === "appendix" ? "appendix" : k ? `${k}:` : "");
          }}
        >
          <option value="">Choose</option>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {kind === "after_section" && (
        <label className="field">
          <span>Section</span>
          <select value={rest} onChange={(e) => onChange(e.target.value ? placementAfter(e.target.value) : "after_section:")} data-testid={`${idPrefix}-placement-section`}>
            <option value="">Choose</option>
            {sectionOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "in_study_type" && (
        <label className="field">
          <span>Study type</span>
          <select value={rest} onChange={(e) => onChange(e.target.value ? placementInType(e.target.value) : "in_study_type:")} data-testid={`${idPrefix}-placement-type`}>
            <option value="">Choose</option>
            {SAMPLING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "in_point" && plan && (
        <label className="field">
          <span>Point</span>
          <select value={rest} onChange={(e) => onChange(e.target.value ? placementInPoint(e.target.value) : "in_point:")} data-testid={`${idPrefix}-placement-point`}>
            <option value="">Choose</option>
            {plan.points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
                {p.attribute.trim() ? `: ${p.attribute.trim()}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function TokenHelp() {
  return (
    <details>
      <summary>Tokens you can use in the title and text</summary>
      <dl className="working-list" data-testid="token-help">
        {SUBSECTION_TOKENS.map((t) => (
          <div key={t.token}>
            <dt>
              <code>{t.token}</code>
            </dt>
            <dd>{t.help}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">A token with no value yet, or one the tool does not know, stays in the text as typed and is listed as an open item.</p>
    </details>
  );
}

export const TEXT_FORMAT_HELP = "Separate paragraphs with a blank line. Start each line of a bullet list with \"- \". Write a table as lines with \" | \" between the cells; the first line is the header.";

/** The custom subsections of a plan: add, edit, reorder, choose the place, copy to and from the library. */
export function SubsectionsEditor({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const items = useSubsectionLibrary((s) => s.items);
  const load = useSubsectionLibrary((s) => s.load);
  useEffect(() => void load(), [load]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [placement, setPlacement] = useState("");
  const [cmo, setCmo] = useState(false);
  const [libId, setLibId] = useState("");
  const [libPlacement, setLibPlacement] = useState("");
  const chosen = items.find((i) => i.id === libId);

  // Show them in the order they print: by placement, then by their order.
  const ordered = useMemo(() => [...plan.subsections].sort((a, b) => a.placement.localeCompare(b.placement) || a.order - b.order || a.id.localeCompare(b.id)), [plan.subsections]);

  return (
    <div className="stack-lg" data-testid="subsections-editor">
      <section className="card stack" aria-labelledby="sub-intro">
        <h2 id="sub-intro">Plan subsections ({plan.subsections.length})</h2>
        <p className="muted small">
          Your own text for the plan, placed where you choose: after a section, inside a study-type section, inside a point, or in an appendix. Tick "also in the CMO instructions" to print a subsection in the CMO reporting instructions. Reusable text lives in the <a href="#/sampling/subsections">Plan subsections library</a>.
        </p>
        <TokenHelp />
      </section>

      {ordered.length === 0 ? (
        <Empty>No subsections yet. Add one below.</Empty>
      ) : (
        ordered.map((s) => <SubsectionCard key={`${s.id}-${s.updatedAt}-${s.order}`} plan={plan} sub={s} run={run} />)
      )}

      <section className="card stack" aria-labelledby="sub-add">
        <h2 id="sub-add">Add a subsection</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isPlacement(placement)) return;
            if (run((p, actor) => addSubsection(p, plan.id, { title, blocks: parseSubsectionText(text), placement, includeInCmo: cmo }, actor).project, "Subsection added")) {
              setTitle("");
              setText("");
              setPlacement("");
              setCmo(false);
            }
          }}
        >
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="sub-new-title" />
          </label>
          <label className="field">
            <span>Text</span>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} data-testid="sub-new-text" />
            <span className="muted small">{TEXT_FORMAT_HELP}</span>
          </label>
          <PlacementPicker value={placement} onChange={setPlacement} plan={plan} idPrefix="sub-new" />
          <label className="check">
            <input type="checkbox" checked={cmo} onChange={(e) => setCmo(e.target.checked)} data-testid="sub-new-cmo" />
            <span>Also print this in the CMO reporting instructions</span>
          </label>
          <div>
            <button type="submit" className="btn primary" disabled={!isPlacement(placement) || !title.trim()} data-testid="sub-add">
              Add subsection
            </button>
          </div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="sub-lib">
        <h2 id="sub-lib">Insert from the library</h2>
        {items.length === 0 ? (
          <Empty>The library is empty. Save a subsection to the library from its card above, or add items on the Plan subsections page.</Empty>
        ) : (
          <div className="stack">
            <label className="field">
              <span>Library item</span>
              <select value={libId} onChange={(e) => setLibId(e.target.value)} data-testid="lib-select">
                <option value="">Choose</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} (version {i.version})
                  </option>
                ))}
              </select>
            </label>
            <PlacementPicker value={libPlacement} onChange={setLibPlacement} plan={plan} idPrefix="lib" />
            {chosen?.suggestedPlacement && <p className="muted small">The owner suggests: {placementLabel(chosen.suggestedPlacement, plan)}. Your choice above is what counts.</p>}
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={!chosen || !isPlacement(libPlacement)}
                data-testid="lib-insert"
                onClick={() => {
                  if (!chosen) return;
                  run(
                    (p, actor) => addSubsection(p, plan.id, { title: chosen.name, blocks: structuredClone(chosen.blocks), placement: libPlacement, origin: { kind: "library", itemId: chosen.id, version: chosen.version, name: chosen.name } }, actor).project,
                    "Subsection inserted from the library",
                  );
                  setLibId("");
                  setLibPlacement("");
                }}
              >
                Insert into the plan
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SubsectionCard({ plan, sub, run }: { plan: SamplingPlan; sub: CustomSubsection; run: Run }) {
  const project = useStore((s) => s.project)!;
  const items = useSubsectionLibrary((s) => s.items);
  const save = useSubsectionLibrary((s) => s.save);
  const [title, setTitle] = useState(sub.title);
  const [text, setText] = useState(subsectionText(sub.blocks));
  const [placement, setPlacement] = useState(sub.placement);
  const [cmo, setCmo] = useState(sub.includeInCmo);
  const [saved, setSaved] = useState("");
  const dirty = title !== sub.title || text !== subsectionText(sub.blocks) || placement !== sub.placement || cmo !== sub.includeInCmo;
  const content = useContent();
  const seed = useMemo(() => buildTrdSeed(content, project), [content, project]);
  const ctx = tokenContext(plan, {
    ...(seed.meta.product.program.display ? { productName: seed.meta.product.program.display } : {}),
    ...(seed.meta.receivingSite.name.display ? { ruSite: seed.meta.receivingSite.name.display } : {}),
  });
  const point = placement.startsWith("in_point:") ? plan.points.find((p) => p.id === placement.slice("in_point:".length)) : undefined;
  // The live problems follow the draft, so a typo in a token shows up before saving.
  const preview = renderSubsection({ ...sub, title, blocks: parseSubsectionText(text), placement: isPlacement(placement) ? placement : sub.placement }, ctx, point ? { id: point.id, attribute: point.attribute } : undefined);
  const note = libraryNote(sub, sub.origin.kind === "library" ? items.find((i) => i.id === (sub.origin as { itemId: string }).itemId) : undefined);
  return (
    <section className="card stack" aria-labelledby={`sub-${sub.id}`} data-testid={`sub-${sub.id}`}>
      <h3 id={`sub-${sub.id}`}>
        {sub.id}: {sub.title || "No title"}
      </h3>
      <p className="muted small">{placementLabel(sub.placement, plan)}</p>
      {note && (
        <p className="notice" data-testid={`sub-${sub.id}-library-note`}>
          {note}
        </p>
      )}
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid={`sub-${sub.id}-title`} />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} data-testid={`sub-${sub.id}-text`} />
        <span className="muted small">{TEXT_FORMAT_HELP}</span>
      </label>
      <PlacementPicker value={placement} onChange={setPlacement} plan={plan} idPrefix={`sub-${sub.id}`} />
      <label className="check">
        <input type="checkbox" checked={cmo} onChange={(e) => setCmo(e.target.checked)} data-testid={`sub-${sub.id}-cmo`} />
        <span>Also print this in the CMO reporting instructions</span>
      </label>
      {preview.problems.length > 0 && (
        <ul className="plain-list small" data-testid={`sub-${sub.id}-problems`} aria-label={`Open items for ${sub.id}`}>
          {preview.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || !isPlacement(placement)}
          data-testid={`sub-${sub.id}-save`}
          onClick={() => run((p, actor) => updateSubsection(p, plan.id, sub.id, { title, blocks: parseSubsectionText(text), placement, includeInCmo: cmo }, actor), `Subsection ${sub.id} saved`)}
        >
          Save subsection
        </button>
        <button type="button" className="btn" onClick={() => run((p, actor) => moveSubsection(p, plan.id, sub.id, "up", actor), `Subsection ${sub.id} moved up`)} aria-label={`Move up ${sub.id}`}>
          Move up
        </button>
        <button type="button" className="btn" onClick={() => run((p, actor) => moveSubsection(p, plan.id, sub.id, "down", actor), `Subsection ${sub.id} moved down`)} aria-label={`Move down ${sub.id}`}>
          Move down
        </button>
        <button
          type="button"
          className="btn"
          data-testid={`sub-${sub.id}-to-library`}
          onClick={() => {
            const base = { id: newLibraryId(), name: sub.title || sub.id, version: "1.0", blocks: structuredClone(sub.blocks), suggestedPlacement: sub.placement.startsWith("in_point:") ? "appendix" : sub.placement };
            save(itemOf(base)).then(
              (s) => setSaved(`Saved to the library as "${s.name}", version ${s.version}.`),
              () => setSaved("The library could not be saved. See the Plan subsections page."),
            );
          }}
        >
          Save to library
        </button>
        <button type="button" className="btn danger" onClick={() => run((p, actor) => removeSubsection(p, plan.id, sub.id, actor), `Subsection ${sub.id} removed`)}>
          Remove
        </button>
      </div>
      <div role="status" aria-live="polite">
        {saved && <p className="small">{saved}</p>}
      </div>
    </section>
  );
}
