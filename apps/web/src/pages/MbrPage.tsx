import { createMbr, mbrOpenItems, projectScopeSteps, proposeBlocks, type BlockProposal } from "@gap/engine";
import { useMemo, useRef, useState } from "react";
import { StartArt } from "../art";
import { Empty } from "../components";
import { dateTime } from "../lib";
import { useMbrLibrary } from "../mbr-blocks-store";
import { PageHeader } from "../PageHeader";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";
import { MbrEditor } from "./MbrEditor";
import { mbrPurpose, mbrScopeText } from "./mbr-text";

/** The batch record list and the "New batch record" form (no `mbr` parameter), or the editor of one record. */
export function MbrPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const id = params.get("mbr");
  const rec = id ? project.mbr.records.find((x) => x.id === id) : undefined;
  return rec ? <MbrEditor rec={rec} tab={params.get("tab") === "word" ? "word" : "edit"} /> : <List missing={id ?? undefined} />;
}

interface UnitOpOffer {
  key: string;
  unitOp: string | undefined;
  label: string;
  proposals: BlockProposal[];
}

/**
 * Where the "can't create yet" message goes. Tester D row 1: it used to sit under 59 tick-boxes, about 3,000 px from the
 * dropdown that needed fixing, so it went unseen. Now it sits beside the control to fix, and the cursor goes there.
 */
type StartError = { field: "title" | "trd" | "plan" | "form"; text: string };

/** A block belongs under a unit operation when it names it, or when it is a sample block that applies to any of them. Other general blocks go under "General". */
const forOp = (unitOp: string) => (p: BlockProposal) => p.block.unitOps.includes(unitOp) || (p.block.unitOps.length === 0 && p.block.sampleTypes.length > 0);

function List({ missing }: { missing?: string | undefined }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const library = useMbrLibrary();
  const [title, setTitle] = useState("");
  const [docRef, setDocRef] = useState("");
  const [useTrd, setUseTrd] = useState(false);
  const [trdId, setTrdId] = useState("");
  const [usePlan, setUsePlan] = useState(false);
  const [planId, setPlanId] = useState("");
  // Blocks the author ticked; absent from the map = the offer's own suggestion (ticked only when a chosen source backs it).
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<StartError | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const trdRef = useRef<HTMLSelectElement>(null);
  const planRef = useRef<HTMLSelectElement>(null);
  const list = project.mbr.records;
  const trds = project.trd.documents;
  const plans = project.sampling.plans;

  const trd = useTrd ? trds.find((d) => d.id === trdId) : undefined;
  const plan = usePlan ? plans.find((p) => p.id === planId) : undefined;

  // Unit operations come from the sources the author chose: the TRD steps, else the plan steps, else the project's scope.
  const offers = useMemo<UnitOpOffer[]>(() => {
    const unitOps: { unitOp: string | undefined; label: string }[] = trd
      ? trd.steps.filter((s) => s.key).map((s) => ({ unitOp: s.key, label: s.label }))
      : plan
        ? plan.steps.map((s) => ({ unitOp: s.unitOp, label: s.label }))
        : projectScopeSteps(content, project).map((s) => ({ unitOp: s.unitOp, label: s.label }));
    const seen = new Set<string>();
    const out: UnitOpOffer[] = [];
    for (const u of unitOps) {
      const key = u.unitOp ?? `custom:${u.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, unitOp: u.unitOp, label: u.label, proposals: u.unitOp ? proposeBlocks(library, u.unitOp, trd, plan).filter(forOp(u.unitOp)) : [] });
    }
    out.push({ key: "general", unitOp: undefined, label: "General", proposals: proposeBlocks(library, undefined, trd, plan).filter((p) => p.block.unitOps.length === 0 && p.block.sampleTypes.length === 0) });
    return out;
  }, [trd, plan, library, content, project]);

  const tickKey = (offerKey: string, blockId: string) => `${offerKey}|${blockId}`;
  const isTicked = (offerKey: string, p: BlockProposal) => ticks[tickKey(offerKey, p.block.id)] ?? p.ticked;

  const blockCount = offers.reduce((n, o) => n + o.proposals.length, 0);
  const tickedCount = offers.reduce((n, o) => n + o.proposals.filter((p) => isTicked(o.key, p)).length, 0);

  /** Show the message beside the control that needs fixing and put the cursor there, so the fix is one step away. */
  function fail(field: StartError["field"], text: string) {
    setError({ field, text });
    if (field === "title") titleRef.current?.focus();
    if (field === "trd") trdRef.current?.focus();
    if (field === "plan") planRef.current?.focus();
  }
  /** A message about a control goes away as soon as that control is changed. */
  const clearError = (field: StartError["field"]) => setError((e) => (e?.field === field ? null : e));

  function create() {
    if (!title.trim()) return fail("title", "Enter a title for the batch record.");
    if (useTrd && !trd) return fail("trd", trds.length === 0 ? "This project has no TRD record to start from. Untick it, or add one on the TRD page first." : "Choose which TRD record to start from, or untick it.");
    if (usePlan && !plan) return fail("plan", plans.length === 0 ? "This project has no sampling plan to start from. Untick it, or add one on the Sampling page first." : "Choose which sampling plan to start from, or untick it.");
    const sections = offers
      .map((o) => ({ ...(o.unitOp ? { unitOp: o.unitOp } : {}), title: o.label, blocks: o.proposals.filter((p) => isTicked(o.key, p)).map((p) => p.block) }))
      .filter((s) => s.blocks.length > 0);
    let newId = "";
    const err = update((p, actor) => {
      const r = createMbr(p, { title: title.trim(), ...(docRef.trim() ? { docRef: docRef.trim() } : {}), ...(trd ? { trdId: trd.id } : {}), ...(plan ? { planId: plan.id } : {}), sections }, actor);
      newId = r.recordId;
      return r.project;
    }, "Batch record created");
    if (err) return fail("form", err);
    setTitle("");
    setDocRef("");
    setError(null);
    navigate("/mbr", { mbr: newId });
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Batch record"
        purpose={mbrPurpose}
        about={{
          art: "page-document",
          children: (
            <>
              <p data-testid="mbr-scope-text">{mbrScopeText}</p>
              <ul className="plain-list">
                <li>A batch record can start from a TRD record, from a sampling plan, from both, or blank.</li>
                <li>It is built from step blocks. The blocks come from a library you can edit; an edit makes a new version, and records already made keep their own copy until you choose to update them.</li>
                <li>When the TRD or the sampling plan changes, the rows concerned show a notice and an Update button. Nothing is rewritten for you.</li>
                <li>
                  The step blocks are on the <a href={href("/mbr/library")}>step blocks library</a> page.
                </li>
              </ul>
            </>
          ),
        }}
      />
      {list.length === 0 && <StartArt art="page-document" />}

      {missing && (
        <p className="notice" role="alert">
          There is no batch record {missing} in this project.
        </p>
      )}

      <section className="card stack" aria-labelledby="mbr-list">
        <h2 id="mbr-list">Batch records in this project</h2>
        {list.length === 0 ? (
          <Empty>No batch record yet. Start one below.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Batch records table" tabIndex={0}>
            <table className="data" data-testid="mbr-list-table">
              <thead>
                <tr>
                  <th scope="col">Batch record</th>
                  <th scope="col">Started from</th>
                  <th scope="col">Sections</th>
                  <th scope="col">Open items</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <a href={href("/mbr", { mbr: r.id })}>
                        {r.id}: {r.title}
                      </a>
                    </th>
                    <td className="small">{[r.trdId ? `TRD ${r.trdId}` : "", r.planId ? `plan ${r.planId}` : ""].filter(Boolean).join(" and ") || "Blank"}</td>
                    <td className="num">{r.sections.length}</td>
                    <td className="num">{mbrOpenItems(project, r, library).length}</td>
                    <td className="small">{dateTime(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="mbr-new">
        <h2 id="mbr-new">New batch record</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="row wrap">
            <label className="field grow">
              <span>Title</span>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearError("title");
                }}
                placeholder="e.g. ARX-217 batch record (fictional)"
                aria-invalid={error?.field === "title" || undefined}
                aria-describedby={error?.field === "title" ? "mbr-title-error" : undefined}
                data-testid="mbr-title-input"
              />
            </label>
            <label className="field">
              <span>Document reference (optional)</span>
              <input value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="mbr-docref-input" />
            </label>
          </div>
          {error?.field === "title" && (
            <p className="error" role="alert" id="mbr-title-error" data-testid="mbr-create-error">
              {error.text}
            </p>
          )}
          <fieldset className="fs stack" data-testid="mbr-start-options">
            <legend>What does the batch record start from? (any combination, or neither for a blank record)</legend>
            <div className="stack">
              <label className="check top">
                <input
                  type="checkbox"
                  checked={useTrd}
                  onChange={(e) => {
                    setUseTrd(e.target.checked);
                    clearError("trd");
                  }}
                  data-testid="mbr-start-trd"
                />
                <span>
                  <strong>A TRD record</strong>
                  <span className="block muted small">Parameter rows take the TRD value with its source. Unit operations come from the TRD steps.</span>
                </span>
              </label>
              {useTrd &&
                (trds.length === 0 ? (
                  <p className="notice small">This project has no TRD record yet. Add one on the TRD page, or untick this.</p>
                ) : (
                  <label className="field">
                    <span>TRD record</span>
                    <select
                      ref={trdRef}
                      value={trdId}
                      onChange={(e) => {
                        setTrdId(e.target.value);
                        clearError("trd");
                      }}
                      aria-invalid={error?.field === "trd" || undefined}
                      aria-describedby={error?.field === "trd" ? "mbr-start-trd-error" : undefined}
                      data-testid="mbr-start-trd-select"
                    >
                      <option value="">Choose a TRD record</option>
                      {trds.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id}: {d.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {error?.field === "trd" && (
                <p className="error" role="alert" id="mbr-start-trd-error" data-testid="mbr-create-error">
                  {error.text}
                </p>
              )}
              <label className="check top">
                <input
                  type="checkbox"
                  checked={usePlan}
                  onChange={(e) => {
                    setUsePlan(e.target.checked);
                    clearError("plan");
                  }}
                  data-testid="mbr-start-plan"
                />
                <span>
                  <strong>A sampling plan</strong>
                  <span className="block muted small">Sample rows come from the plan, and a notice tells you when the plan changes.</span>
                </span>
              </label>
              {usePlan &&
                (plans.length === 0 ? (
                  <p className="notice small">This project has no sampling plan yet. Add one on the Sampling page, or untick this.</p>
                ) : (
                  <label className="field">
                    <span>Sampling plan</span>
                    <select
                      ref={planRef}
                      value={planId}
                      onChange={(e) => {
                        setPlanId(e.target.value);
                        clearError("plan");
                      }}
                      aria-invalid={error?.field === "plan" || undefined}
                      aria-describedby={error?.field === "plan" ? "mbr-start-plan-error" : undefined}
                      data-testid="mbr-start-plan-select"
                    >
                      <option value="">Choose a sampling plan</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id}: {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {error?.field === "plan" && (
                <p className="error" role="alert" id="mbr-start-plan-error" data-testid="mbr-create-error">
                  {error.text}
                </p>
              )}
            </div>
          </fieldset>

          {blockCount > 0 && (
            <details className="mbr-blocks-details" data-testid="mbr-blocks-details">
              <summary>
                Step blocks to include (optional): {tickedCount} of {blockCount} ticked
              </summary>
              <fieldset className="fs stack" data-testid="mbr-blocks-offer">
                <legend>Proposed step blocks</legend>
                <p className="muted small">
                  These are offers. A block is ticked only when a source you chose backs it (the TRD holds its values, or the sampling plan has sample points). You can tick or untick any of them, and add more later.
                </p>
                {offers
                  .filter((o) => o.proposals.length > 0)
                  .map((o) => (
                    <fieldset key={o.key} className="fs stack">
                      <legend>{o.label}</legend>
                      {o.proposals.map((p) => (
                        <label key={p.block.id} className="check top">
                          <input type="checkbox" checked={isTicked(o.key, p)} onChange={(e) => setTicks((t) => ({ ...t, [tickKey(o.key, p.block.id)]: e.target.checked }))} data-testid={`mbr-offer-${o.key}-${p.block.id}`} />
                          <span>
                            <strong>{p.block.title}</strong>
                            <span className="block muted small">{p.reason}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
              </fieldset>
            </details>
          )}

          {error?.field === "form" && (
            <p className="error" role="alert" data-testid="mbr-create-error">
              {error.text}
            </p>
          )}
          <div>
            <button type="submit" className="btn primary" data-testid="mbr-create">
              Create batch record
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
