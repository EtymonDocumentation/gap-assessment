import { addCheckedSteps, effectiveWriteupLibrary, setTrdTemplateChoice, type TrdTemplatePick } from "@gap/engine";
import type { TrdTemplateChoice } from "@gap/process-model";
import { useEffect, useState } from "react";
import { dateTime, MODE_HELP, MODE_LABEL } from "../lib";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";
import { createTrdForStartPath } from "../trd-start";
import { useTemplates } from "../templates-store";
import { trdWriteups } from "@gap/content";
import { useTrdWriteups } from "../trd-writeups-store";
import { GENERIC_MODES } from "./document-panels";
import { ProcessStepsBlock } from "./ScopeEditor";

/**
 * The start path of a new TRD: three numbered steps. Step 1 picks the Word template, step 2 says which process steps are in the project, step 3 is
 * the interview (the page it hands over to). Back works on every step, and nothing blocks leaving: the other pages are one click away, and a TRD
 * that was started stays in the project as it is. Nothing is chosen for the person: no option starts ticked, and "Decide later" is a real choice that
 * stays visible as open on the TRD.
 *
 * Part 2 (a template's own headings driving the interview) is not here. The stored choice already carries the template's id, name and version.
 */

type Kind = TrdTemplateChoice["kind"];

const STEPS = ["Pick the Word template", "Which steps are in your process?", "Answer the questions"];

/** The three numbered steps. The current one is named in words as well as marked, so it never depends on colour. */
function StepBar({ step }: { step: 1 | 2 }) {
  return (
    <ol className="start-path-steps" data-testid="start-path-steps" aria-label="Steps to start a TRD">
      {STEPS.map((label, i) => (
        <li key={label} {...(i + 1 === step ? { "aria-current": "step" as const } : {})} className={i + 1 === step ? "current" : ""}>
          <span className="start-path-num">{i + 1}</span> {label}
          {i + 1 === step ? <span className="visually-hidden"> (you are here)</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function TrdStartPath({ step, trdId }: { step: 1 | 2; trdId: string | null }) {
  const project = useStore((s) => s.project)!;
  const d = trdId ? project.trd.documents.find((x) => x.id === trdId) : undefined;
  return (
    <div className="stack" data-testid="trd-start-path" data-step={step}>
      <StepBar step={step} />
      {trdId && !d ? (
        <section className="card stack">
          <p>This TRD is not in the open project any more.</p>
          <a className="btn" href={href("/trd", { step: "1" })}>
            Start a new TRD
          </a>
        </section>
      ) : step === 1 ? (
        <PickTemplate trdId={d?.id ?? null} stored={d?.templateChoice} />
      ) : d ? (
        <PickSteps trdId={d.id} />
      ) : (
        <section className="card stack">
          <p>Pick the Word template first, then choose the steps.</p>
          <a className="btn" href={href("/trd", { step: "1" })}>
            Go to step 1
          </a>
        </section>
      )}
    </div>
  );
}

function PickTemplate({ trdId, stored }: { trdId: string | null; stored: TrdTemplateChoice | undefined }) {
  const items = useTemplates((s) => s.items);
  const ready = useTemplates((s) => s.ready);
  const update = useStore((s) => s.update);
  useEffect(() => {
    void useTemplates.getState().load();
  }, []);
  // Nothing starts chosen. A TRD that is already started shows the choice stored on it.
  const [kind, setKind] = useState<Kind | "">(stored?.kind ?? "");
  const [templateId, setTemplateId] = useState(stored?.templateId ?? "");
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState(false);
  const wantsTemplate = kind === "their_look" || kind === "tags" || kind === "mapped";
  const candidates = wantsTemplate ? items.filter((t) => t.analysis.usableModes.includes(kind)) : [];
  const template = candidates.find((t) => t.id === templateId);
  const gone = !!stored?.templateId && kind === stored.kind && templateId === stored.templateId && ready && !items.some((t) => t.id === stored.templateId);

  async function next() {
    setSay("");
    if (!kind) return setSay("Pick one of the options, or choose Decide later.");
    if (wantsTemplate && !template) return setSay("Choose a template from the list, or choose another option.");
    const pick: TrdTemplatePick = wantsTemplate && template ? { kind, templateId: template.id, templateName: template.name, templateVersion: template.version } : { kind };
    setBusy(true);
    try {
      if (trdId) {
        const err = update((p, actor) => setTrdTemplateChoice(p, trdId, pick, actor), "Word template of the TRD saved");
        if (err) return setSay(err);
        navigate("/trd", { trd: trdId, step: "2" });
      } else {
        const r = await createTrdForStartPath(pick);
        if ("error" in r) return setSay(r.error);
        navigate("/trd", { trd: r.trdId, step: "2" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="sp1-h" data-testid="start-step-template">
      <h2 id="sp1-h">Step 1 of 3: Pick the Word template</h2>
      <p>The TRD ends up as a Word document. Say which kind of Word template you will use for it. You can change this later, on the Document tab.</p>
      <fieldset className="stack start-kinds">
        <legend>Kind of Word document</legend>
        {GENERIC_MODES.map((m) => (
          <label key={m} className="check top">
            <input type="radio" name="sp-kind" value={m} checked={kind === m} data-testid={`start-kind-${m}`} onChange={() => { setKind(m); setTemplateId(""); setSay(""); }} />
            <span>
              <strong>{MODE_LABEL[m]}</strong>
              <span className="block muted small">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
        <label className="check top">
          <input type="radio" name="sp-kind" value="later" checked={kind === "later"} data-testid="start-kind-later" onChange={() => { setKind("later"); setTemplateId(""); setSay(""); }} />
          <span>
            <strong>Decide later</strong>
            <span className="block muted small">Nothing is chosen now. The TRD shows the Word template as still open, and you can choose it at any time.</span>
          </span>
        </label>
      </fieldset>
      {wantsTemplate && (
        <div className="stack">
          {gone && (
            <p className="notice" role="status" data-testid="start-template-missing">
              The template chosen for this TRD, "{stored?.templateName}", is not in the library any more. Pick another one, or choose another option.
            </p>
          )}
          {candidates.length === 0 ? (
            <p className="notice" data-testid="start-no-templates">
              No template in the library works with "{MODE_LABEL[kind]}" yet. Add one on the <a href={href("/templates")}>Templates page</a>, or choose another option.
            </p>
          ) : (
            <label className="field">
              <span>Template from the library</span>
              <select value={template?.id ?? ""} data-testid="start-template-select" onChange={(e) => { setTemplateId(e.target.value); setSay(""); }}>
                <option value="">Choose a template</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (version {c.version}
                    {candidates.some((o) => o !== c && o.name === c.name && o.version === c.version) ? `, added ${dateTime(c.addedAt)} (local time)` : ""})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <p className="small">
        <a href={href("/templates")} data-testid="start-add-template">Add a Word template to the library</a>
      </p>
      {say && (
        <p role="status" className="start-path-say" data-testid="start-path-say">
          {say}
        </p>
      )}
      <div className="row wrap">
        <a className="btn" href={href("/trd")} data-testid="start-back">
          Back
        </a>
        <button type="button" className="btn primary" disabled={busy} data-testid="start-next" onClick={() => void next()}>
          Continue to step 2
        </button>
      </div>
    </section>
  );
}

function PickSteps({ trdId }: { trdId: string }) {
  const content = useContent();
  const update = useStore((s) => s.update);
  const [say, setSay] = useState("");
  return (
    <section className="card stack" aria-labelledby="sp2-h" data-testid="start-step-steps">
      <h2 id="sp2-h">Step 2 of 3: Which steps are in your process?</h2>
      <p>Untick the steps this project does not have. The questions then skip them, and the interview lists them as left out. Nothing is deleted: answers you gave for a step come back if you tick it again.</p>
      <p className="muted small">This is the same list as the Scope step of the gap assessment. A change here shows there too.</p>
      <ProcessStepsBlock idPrefix="trd-start" />
      {say && (
        <p role="status" className="start-path-say">
          {say}
        </p>
      )}
      <div className="row wrap">
        <a className="btn" href={href("/trd", { trd: trdId, step: "1" })} data-testid="start-back">
          Back
        </a>
        <button
          type="button"
          className="btn primary"
          data-testid="start-next"
          onClick={async () => {
            // The person's own process descriptions are read first, so an edited one is never replaced by the shipped one.
            await useTrdWriteups.getState().load();
            const library = effectiveWriteupLibrary(trdWriteups, useTrdWriteups.getState().items);
            const err = update((p, actor) => addCheckedSteps(p, trdId, actor, { content, library }), "Steps added to the TRD");
            if (err) return setSay(err);
            navigate("/trd", { trd: trdId, tab: "interview" });
          }}
        >
          Continue to the questions
        </button>
      </div>
    </section>
  );
}