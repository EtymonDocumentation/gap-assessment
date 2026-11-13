import { interviewMapExample, interviewMapWording } from "@gap/content";
import { confirmFacilityExampleArea, addFacilityArea, facilityStepKeys, removeFacilityArea, setFacilityAreaSteps, updateFacilityArea, useFacilityExample as copyFacilityExample } from "@gap/engine";
import { FACILITY_GRADES, FACILITY_GRADE_LABEL, FACILITY_UNITS, FACILITY_UNIT_LABEL, facilityAreas, type FacilityArea, type FacilityGrade, type FacilityUnit, type Project } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "../HelpTip";
import { PageHeader } from "../PageHeader";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";

/*
 * "Your areas" (M14 job 3): the one place where the rooms of a unit are named, graded, nested and given their steps. It is a plain page, not a
 * pop-up, so it works on a phone and with a keyboard. The areas are for NAVIGATION only: nothing here writes into a document, and nothing
 * here blocks anything. Every edit goes through the engine's facility functions (one change-log event each), so a browser-only project and a
 * server project save them the same way as any other edit.
 */

const W = interviewMapWording;
const E = W.editor;
const fill = (t: string, name: string) => t.replace("{name}", name);
const say = (status: string) => useStore.setState({ status });

/** Areas in reading order: each area, then the areas inside it, indented one level per nesting. */
function ordered(areas: readonly FacilityArea[]): { a: FacilityArea; depth: number }[] {
  const out: { a: FacilityArea; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number, seen: Set<string>) => {
    for (const a of areas.filter((x) => x.insideAreaId === parent)) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ a, depth });
      walk(a.id, depth + 1, seen);
    }
  };
  walk(undefined, 0, new Set());
  return out;
}

/** The ids of the areas inside `id`, at any depth: an area cannot be moved inside one of these. */
function descendants(areas: readonly FacilityArea[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (p: string) => {
    for (const a of areas) if (a.insideAreaId === p && !out.has(a.id)) {
      out.add(a.id);
      walk(a.id);
    }
  };
  walk(id);
  return out;
}

function useStepLabels(project: Project): { keys: string[]; label: (k: string) => string } {
  const content = useContent();
  return useMemo(() => {
    const labels = new Map<string, string>([...content.catalog.unitOperations.map((u) => [u.key, u.label] as const), ...(project.custom?.unitOperations ?? []).map((u) => [u.key, u.label] as const)]);
    return { keys: facilityStepKeys(content, project), label: (k: string) => labels.get(k) ?? k };
  }, [content, project]);
}

export function AreasPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const unit: FacilityUnit = params.get("unit") === "su" ? "su" : "ru";
  const fromTrd = params.get("from") === "trd" ? params.get("trd") : null;
  const areas = facilityAreas(project, unit);
  const rows = useMemo(() => ordered(areas), [areas]);
  const steps = useStepLabels(project);
  const [showExample, setShowExample] = useState(params.get("example") === "1");
  const [newName, setNewName] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  // A link from the empty state's "Add the first area" lands with the cursor in the name box.
  useEffect(() => {
    if (params.get("add") === "1") nameRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const back = fromTrd ? href("/trd", { trd: fromTrd, tab: "interview", view: "areas", unit }) : href("/interview", { view: "areas", unit });
  const here = (u: FacilityUnit) => {
    const p: Record<string, string> = { unit: u };
    if (fromTrd) {
      p.from = "trd";
      p.trd = fromTrd;
    } else p.from = "gap";
    navigate("/interview/areas", p);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) {
      setAddMsg(E.nameMissing);
      nameRef.current?.focus();
      return;
    }
    const err = update((p, actor) => addFacilityArea(content, p, unit, { name }, actor).project, "Area added");
    if (err) {
      setAddMsg(err);
      return;
    }
    setAddMsg("");
    setNewName("");
    say(fill(E.added, name));
    nameRef.current?.focus();
  };

  const copyExample = () => {
    const err = update((p, actor) => copyFacilityExample(content, p, unit, interviewMapExample, actor), "Example layout copied");
    if (err) {
      setAddMsg(err);
      return;
    }
    setShowExample(false);
    setAddMsg("");
    say(E.exampleUsed);
    headRef.current?.focus();
  };

  const exampleNested = (parent: string | undefined): React.ReactNode => {
    const list = interviewMapExample.areas.filter((x) => x.inside === parent);
    if (list.length === 0) return null;
    return (
      <ul className="areas-example-list">
        {list.map((x) => (
          <li key={x.name}>
            <strong>{x.name}</strong>
            {x.steps.length > 0 && <span className="muted small"> ({x.steps.map(steps.label).join(", ")})</span>}
            {exampleNested(x.name)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="stack areas-page" data-testid="areas-page">
      <PageHeader title={E.title} purpose={E.purpose} />
      <p>
        <a className="btn" href={back} data-testid="areas-back">
          {E.back}
        </a>
      </p>

      <fieldset className="fs stack" data-testid="areas-unit-switch">
        <legend>
          {E.unitLabel} <HelpTip label="Your areas" text={E.help} />
        </legend>
        <div className="row wrap">
          {[...FACILITY_UNITS].reverse().map((u) => (
            <label key={u} className="check">
              <input type="radio" name="areas-unit" checked={unit === u} onChange={() => here(u)} data-testid={`areas-unit-${u}`} /> <span>{FACILITY_UNIT_LABEL[u]}</span>
            </label>
          ))}
        </div>
        <p className="muted small">{E.otherUnitHint}</p>
      </fieldset>

      <section className="card stack" aria-labelledby="areas-list-h">
        <h2 id="areas-list-h" ref={headRef} tabIndex={-1}>
          {FACILITY_UNIT_LABEL[unit]}
        </h2>
        {areas.length === 0 && !showExample && (
          <div className="stack" data-testid="areas-empty">
            <p>{W.explain.emptyAreas}</p>
            <div className="row wrap">
              <button type="button" className="btn primary" data-testid="areas-add-first" onClick={() => nameRef.current?.focus()}>
                {W.explain.addFirst}
              </button>
              <button type="button" className="btn" data-testid="areas-start-example" onClick={() => setShowExample(true)}>
                {W.explain.startExample}
              </button>
            </div>
          </div>
        )}

        {showExample && (
          <div className="stack areas-example" role="region" aria-label={E.exampleTitle} data-testid="areas-example">
            <h3>{E.exampleTitle}</h3>
            <p className="muted small">{interviewMapExample.note}</p>
            <p className="small">{E.exampleIntro}</p>
            {exampleNested(undefined)}
            <div className="row wrap">
              {areas.length === 0 ? (
                <button type="button" className="btn primary" data-testid="areas-use-example" onClick={copyExample}>
                  {W.explain.useExample}
                </button>
              ) : (
                <p className="small" data-testid="areas-example-only-empty">
                  {E.exampleOnlyEmpty}
                </p>
              )}
              <button type="button" className="btn" data-testid="areas-close-example" onClick={() => setShowExample(false)}>
                {E.exampleClose}
              </button>
            </div>
          </div>
        )}

        {areas.length > 0 && (
          <ul className="areas-list" aria-label={FACILITY_UNIT_LABEL[unit]}>
            {rows.map(({ a, depth }) => (
              <li key={a.id} className="areas-item" style={{ marginInlineStart: `${depth * 1.25}rem` }}>
                <AreaCard area={a} all={areas} steps={steps} onGone={() => headRef.current?.focus()} />
              </li>
            ))}
          </ul>
        )}

        <form
          className="stack areas-add"
          aria-labelledby="areas-add-h"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <h3 id="areas-add-h">{E.addTitle}</h3>
          <div className="row wrap end-align">
            <label className="field">
              <span>{E.nameLabel}</span>
              <input ref={nameRef} value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="areas-add-name" autoComplete="off" />
            </label>
            <button type="submit" className="btn primary" data-testid="areas-add-button">
              {E.addButton}
            </button>
          </div>
          {addMsg && (
            <p role="status" className="small" data-testid="areas-add-msg">
              {addMsg}
            </p>
          )}
        </form>
        {areas.length === 0 && !showExample && <p className="muted small">{E.noAreas}</p>}
      </section>
    </div>
  );
}

/** One area: its name, grade, parent, note and steps in one form, with "Looks right" for an area copied from the example and a removal that asks for a reason. */
function AreaCard({ area: a, all, steps, onGone }: { area: FacilityArea; all: readonly FacilityArea[]; steps: { keys: string[]; label: (k: string) => string }; onGone: () => void }) {
  const update = useStore((s) => s.update);
  const content = useContent();
  const [name, setName] = useState(a.name);
  const [grade, setGrade] = useState<FacilityGrade | "">(a.grade ?? "");
  const [inside, setInside] = useState(a.insideAreaId ?? "");
  const [note, setNote] = useState(a.note ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(a.stepKeys));
  const [msg, setMsg] = useState("");
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonMsg, setReasonMsg] = useState("");
  const reasonRef = useRef<HTMLInputElement>(null);

  // Another edit (a confirm, the example, a removal of the parent) changes the stored area: the form shows what is stored.
  useEffect(() => {
    setName(a.name);
    setGrade(a.grade ?? "");
    setInside(a.insideAreaId ?? "");
    setNote(a.note ?? "");
    setPicked(new Set(a.stepKeys));
  }, [a.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = useMemo(() => new Set([a.id, ...descendants(all, a.id)]), [all, a.id]);
  const parents = all.filter((x) => !blocked.has(x.id));

  const save = () => {
    if (!name.trim()) {
      setMsg(E.nameMissing);
      return;
    }
    const keys = steps.keys.filter((k) => picked.has(k));
    const err = update((p, actor) => {
      const next = updateFacilityArea(p, a.id, { name, grade: grade === "" ? null : grade, insideAreaId: inside === "" ? null : inside, note: note.trim() ? note : null }, actor);
      return setFacilityAreaSteps(content, next, a.id, keys, actor);
    }, "Area saved");
    if (err) {
      setMsg(err);
      return;
    }
    setMsg("");
    say(fill(E.saved, name.trim()));
  };

  const confirm = () => {
    const err = update((p, actor) => confirmFacilityExampleArea(p, a.id, actor), "Area checked");
    if (err) setMsg(err);
    else say(fill(E.saved, a.name));
  };

  const remove = () => {
    if (!reason.trim()) {
      setReasonMsg(E.reasonMissing);
      reasonRef.current?.focus();
      return;
    }
    const err = update((p, actor) => removeFacilityArea(p, a.id, reason, actor), "Area removed");
    if (err) {
      setReasonMsg(err);
      return;
    }
    say(fill(E.removed, a.name));
    onGone();
  };

  const id = `area-${a.id}`;
  return (
    <form
      className="card tight stack area-card"
      aria-label={a.name}
      data-testid={id}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3 className="area-card-name">{a.name}</h3>
      <p className="small muted" data-testid={`${id}-summary`}>
        <strong>{a.grade ? FACILITY_GRADE_LABEL[a.grade] : W.areas.gradeNotStated}</strong>
        {a.insideAreaId && <span> · {W.areas.inside.replace("{area}", all.find((x) => x.id === a.insideAreaId)?.name ?? "")}</span>}
        {a.fromExample && (
          <span data-testid={`${id}-from-example`}>
            {" "}
            · <strong>{W.areas.fromExample}</strong>
          </span>
        )}
      </p>
      <div className="row wrap end-align">
        <label className="field">
          <span>{E.nameLabel}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid={`${id}-name`} autoComplete="off" />
        </label>
        <label className="field">
          <span>{E.gradeLabel}</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value as FacilityGrade | "")} data-testid={`${id}-grade`}>
            <option value="">{E.gradeChoose}</option>
            {FACILITY_GRADES.map((g) => (
              <option key={g} value={g}>
                {FACILITY_GRADE_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{E.insideLabel}</span>
          <select value={inside} onChange={(e) => setInside(e.target.value)} data-testid={`${id}-inside`}>
            <option value="">{E.insideNone}</option>
            {parents.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{E.noteLabel}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} data-testid={`${id}-note`} autoComplete="off" />
      </label>
      <fieldset className="fs stack area-steps" data-testid={`${id}-steps`}>
        <legend>{fill(E.stepsIn, a.name)}</legend>
        <p className="muted small">{E.stepsHint}</p>
        <ul className="area-step-list">
          {steps.keys.map((k, n) => (
            <li key={k}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={picked.has(k)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(k);
                      else next.delete(k);
                      return next;
                    })
                  }
                  data-testid={`${id}-step-${k}`}
                />{" "}
                <span>
                  {n + 1}. {steps.label(k)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {msg && (
        <p role="status" className="small" data-testid={`${id}-msg`}>
          {msg}
        </p>
      )}
      <div className="row wrap">
        <button type="submit" className="btn primary" data-testid={`${id}-save`}>
          {E.save}
        </button>
        {a.fromExample && (
          <button type="button" className="btn" data-testid={`${id}-looks-right`} onClick={confirm}>
            {E.looksRight}
          </button>
        )}
        <button type="button" className="btn danger" aria-expanded={removing} data-testid={`${id}-remove`} onClick={() => setRemoving((r) => !r)}>
          {E.removeButton}
        </button>
      </div>
      {removing && (
        <div className="stack area-remove" role="group" aria-label={fill(E.removeAsk, a.name)} data-testid={`${id}-remove-panel`}>
          <p>{fill(E.removeAsk, a.name)}</p>
          <label className="field">
            <span>{E.reasonLabel}</span>
            <input ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${id}-reason`} autoComplete="off" />
          </label>
          {reasonMsg && (
            <p role="status" className="small" data-testid={`${id}-reason-msg`}>
              {reasonMsg}
            </p>
          )}
          <div className="row wrap">
            <button type="button" className="btn danger" data-testid={`${id}-remove-confirm`} onClick={remove}>
              {E.removeConfirm}
            </button>
            <button
              type="button"
              className="btn"
              data-testid={`${id}-keep`}
              onClick={() => {
                setRemoving(false);
                setReason("");
                setReasonMsg("");
              }}
            >
              {E.keep}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
