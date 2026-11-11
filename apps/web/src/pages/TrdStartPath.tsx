import { addCheckedSteps, effectiveWriteupLibrary, setTrdTemplateChoice, type TrdTemplatePick } from "@gap/engine";
import type { TrdTemplateChoice } from "@gap/process-model";
import { useEffect, useState } from "react";
import { dateTime, MODE_HELP, MODE_LABEL } from "../lib";
import { HelpTip } from "../HelpTip";
import { addSampleHeadingsTemplate, sampleNotice, SAMPLE_BUTTON_TEXT } from "../sample-headings-template";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";
import { createTrdForStartPath } from "../trd-start";
import { useTemplates } from "../templates-store";
import { trdWriteups } from "@gap/content";
import { useTrdWriteups } from "../trd-writeups-store";
import { WORD_MODES } from "./document-panels";
import { noHeadingsText, TrdMatchPage } from "./TrdMatchPage";
import { ProcessStepsBlock } from "./ScopeEditor";

/**
 * The start path of a new TRD: numbered steps. Step 1 picks the Word template, step 2 says which process steps are in the project, the last step is
 * the interview (the page it hands over to). With "A template's headings" there is one more step between them: step 3, "Match your headings", the
 * match screen itself (TrdMatchPage) in the step bar, so the interview can follow the template's headings. The bar shows 3 steps for every other
 * choice and 4 for that one. Back works on every step, and nothing blocks leaving: the other pages are one click away, and a TRD that was started
 * stays in the project as it is. Nothing is chosen for the person: no option starts ticked, and "Decide later" is a real choice that stays visible as
 * open on the TRD.
 */

type Kind = TrdTemplateChoice["kind"];

/** The numbered steps. `matches` adds the match of the template's headings between the process steps and the questions. */
const stepsOf = (matches: boolean): string[] => ["Pick the Word template", "Which steps are in your process?", ...(matches ? ["Match your headings"] : []), "Answer the questions"];

/** The numbered steps. The current one is named in words as well as marked, so it never depends on colour. */
function StepBar({ step, matches }: { step: 1 | 2 | 3; matches: boolean }) {
  return (
    <ol className="start-path-steps" data-testid="start-path-steps" aria-label="Steps to start a TRD">
      {stepsOf(matches).map((label, i) => (
        <li key={label} {...(i + 1 === step ? { "aria-current": "step" as const } : {})} className={i + 1 === step ? "current" : ""}>
          <span className="start-path-num">{i + 1}</span> {label}
          {i + 1 === step ? <span className="visually-hidden"> (you are here)</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function TrdStartPath({ step, trdId }: { step: 1 | 2 | 3; trdId: string | null }) {
  const project = useStore((s) => s.project)!;
  const d = trdId ? project.trd.documents.find((x) => x.id === trdId) : undefined;
  // Step 1 shows the bar for the kind the person has picked so far (3 steps, or 4 for a template's headings); later steps read the stored choice.
  const [picked, setPicked] = useState<Kind | "">(d?.templateChoice?.kind ?? "");
  const matches = (step === 1 ? picked : d?.templateChoice?.kind) === "mapped";
  const choice = d?.templateChoice;
  return (
    <div className="stack" data-testid="trd-start-path" data-step={step}>
      <StepBar step={step} matches={matches} />
      {trdId && !d ? (
        <section className="card stack">
          <p>This TRD is not in the open project any more.</p>
          <a className="btn" href={href("/trd", { step: "1" })}>
            Start a new TRD
          </a>
        </section>
      ) : step === 1 ? (
        <PickTemplate trdId={d?.id ?? null} stored={d?.templateChoice} onKind={setPicked} total={matches ? 4 : 3} />
      ) : d && step === 3 ? (
        choice?.kind === "mapped" && choice.templateId ? (
          <TrdMatchPage
            id={choice.templateId}
            params={new URLSearchParams({ trd: d.id })}
            start={{ backHref: href("/trd", { trd: d.id, step: "2" }), onDone: () => navigate("/trd", { trd: d.id, tab: "interview" }) }}
          />
        ) : (
          <section className="card stack" data-testid="start-step-match-none">
            <p>This TRD does not use "A template's headings", so there are no headings to match.</p>
            <div className="row wrap">
              <a className="btn" href={href("/trd", { trd: d.id, step: "1" })}>
                Go to step 1
              </a>
              <a className="btn primary" href={href("/trd", { trd: d.id, tab: "interview" })}>
                Go to the questions
              </a>
            </div>
          </section>
        )
      ) : d ? (
        <PickSteps trdId={d.id} matches={matches} total={matches ? 4 : 3} />
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

function PickTemplate({ trdId, stored, onKind, total }: { trdId: string | null; stored: TrdTemplateChoice | undefined; onKind: (k: Kind | "") => void; total: number }) {
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

  async function addSample() {
    setSay("");
    setBusy(true);
    try {
      // Only added to the library: the person still picks it in the list below, so nothing is chosen for them.
      setSay(sampleNotice(await addSampleHeadingsTemplate()));
    } catch (e) {
      setSay(`The sample template could not be added. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

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
      <div className="row wrap">
        <h2 id="sp1-h">Step 1 of {total}: Pick the Word template</h2>
        <HelpTip
          label="the Word template choice"
          text={`Choose how the Word file of the TRD will look. Choose "A template's headings" to use your own Word template: the questions then follow its headings, in its order, and each answer goes under its heading. Nothing is chosen for you.`}
        />
      </div>
      <p>The TRD ends up as a Word document. Say which kind of Word template you will use for it. You can change this later, on the Document tab.</p>
      <fieldset className="stack start-kinds">
        <legend>Kind of Word document</legend>
        {/* The same four kinds, in the same order and words, as the Document page (WORD_MODES, MODE_LABEL and MODE_HELP are their one source). */}
        {WORD_MODES.map((m) => (
          <label key={m} className="check top">
            <input type="radio" name="sp-kind" value={m} checked={kind === m} data-testid={`start-kind-${m}`} onChange={() => { setKind(m); onKind(m); setTemplateId(""); setSay(""); }} />
            <span>
              <strong>{MODE_LABEL[m]}</strong>
              <span className="block muted small">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
        <label className="check top">
          <input type="radio" name="sp-kind" value="later" checked={kind === "later"} data-testid="start-kind-later" onChange={() => { setKind("later"); onKind("later"); setTemplateId(""); setSay(""); }} />
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
            <div className="notice stack" data-testid="start-no-templates">
              <p>
                No template in the library works with "{MODE_LABEL[kind]}" yet. Add one on the <a href={href("/templates")}>Templates page</a>, or choose another option.
              </p>
              {kind === "mapped" && (
                <div className="row wrap">
                  <button type="button" className="btn small" disabled={busy} data-testid="start-add-sample" onClick={() => void addSample()}>
                    {SAMPLE_BUTTON_TEXT}
                  </button>
                  <span className="small muted">To try it without a file of your own. You still pick it in the list.</span>
                </div>
              )}
            </div>
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
          {kind === "mapped" && template && template.analysis.outline.length === 0 && (
            <p className="notice" data-testid="start-no-headings">
              {noHeadingsText(template.name)}
            </p>
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

function PickSteps({ trdId, matches, total }: { trdId: string; matches: boolean; total: number }) {
  const content = useContent();
  const update = useStore((s) => s.update);
  const [say, setSay] = useState("");
  return (
    <section className="card stack" aria-labelledby="sp2-h" data-testid="start-step-steps">
      <h2 id="sp2-h">Step 2 of {total}: Which steps are in your process?</h2>
      {/* One short paragraph: the list below used to repeat it in a second and third one. It is the same list as the gap assessment's Scope step, so a change shows there too. */}
      <p>Untick the steps this project does not have. The questions skip them and the interview lists them as left out. Answers you gave come back if you tick a step again. This is the same list as the Scope step of the gap assessment.</p>
      <ProcessStepsBlock idPrefix="trd-start" hint={false} />
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
            // With a template's headings the match comes next: it needs these steps in the TRD, because their process descriptions are what gets placed.
            if (matches) navigate("/trd", { trd: trdId, step: "3" });
            else navigate("/trd", { trd: trdId, tab: "interview" });
          }}
        >
          {matches ? "Continue to match your headings" : "Continue to the questions"}
        </button>
      </div>
    </section>
  );
}