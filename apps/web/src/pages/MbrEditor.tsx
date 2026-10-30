import {
  addBlockForRequirement,
  addBlockFromLibrary,
  addCustomBlock,
  addSection,
  blocksForUnitOp,
  deleteMbr,
  holdEntryInfo,
  mbrHoldSuggestions,
  mbrOpenItems,
  mergeMbr,
  moveSection,
  numberSteps,
  removeBlock,
  removeSection,
  sampleNotices,
  splitIndex,
  splitMbr,
  trdNotices,
  trdRequirementsWithoutStep,
  updateMbr,
  updateSection,
  updateSplit,
  type TrdRequirement,
} from "@gap/engine";
import type { MbrRecord, MbrSection, SamplingPlan } from "@gap/process-model";
import { Fragment, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal } from "../components";
import { dateTime } from "../lib";
import { mbrScopeText } from "./mbr-text";
import { href, navigate } from "../router";
import { useStore } from "../store";
import { useMbrLibrary } from "../mbr-blocks-store";
import { BlockCard, type BlockEnv } from "./MbrBlocks";
import { MbrOutput } from "./MbrOutput";
import type { Run } from "./SamplingFlow";

/** One batch record: details, sections with their blocks, what is still open, and the output. */
export function MbrEditor({ rec }: { rec: MbrRecord }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const library = useMbrLibrary();
  const [error, setError] = useState("");
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: "record" } | { kind: "section"; section: MbrSection } | { kind: "block"; blockId: string; title: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const run: Run = (fn, status) => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };
  const numbers = useMemo(() => numberSteps(rec), [rec]);
  const trdN = useMemo(() => trdNotices(project, rec), [project, rec]);
  const sampleN = useMemo(() => sampleNotices(project, rec), [project, rec]);
  const trd = project.trd.documents.find((d) => d.id === rec.trdId);
  const plan = project.sampling.plans.find((p) => p.id === rec.planId);
  const open = useMemo(() => mbrOpenItems(project, rec, library), [project, rec, library]);
  const requirements = useMemo(() => trdRequirementsWithoutStep(rec, trd, library), [rec, trd, library]);
  const cut = splitIndex(rec);
  // Only a pointer: the author decides whether to split there. Nothing is split or preselected from this.
  const suggestions = useMemo(() => mbrHoldSuggestions(plan, rec), [plan, rec]);

  const toggle = (id: string) =>
    setOpenBlocks((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const goToRow = (blockId: string, rowId: string) => {
    setOpenBlocks((s) => new Set(s).add(blockId));
    // The block opens first; focus follows once the row exists.
    setTimeout(() => {
      const el = document.getElementById(`mbr-row-${rowId}`);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    }, 50);
  };

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>
          {rec.id}: {rec.title}
        </h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/mbr")}>All batch records</a>
        {" | "}
        <a className="btn small" href={href("/mbr/view", { mbr: rec.id })} data-testid="mbr-process-view-link">
          Process view
        </a>
      </p>
      <p className="muted" data-testid="mbr-scope-text">
        {mbrScopeText}
      </p>
      {error && (
        <p className="notice" role="alert" data-testid="mbr-error">
          {error}
        </p>
      )}

      <Details rec={rec} run={run} trdTitle={trd ? `${trd.id}: ${trd.title}` : undefined} planTitle={plan ? `${plan.id}: ${plan.title}` : undefined} />

      {rec.trdId && !trd && <p className="notice small">The TRD this record started from ({rec.trdId}) is no longer in this project. The values keep their copy.</p>}
      {(trdN.length > 0 || sampleN.length > 0) && (
        <section className="card stack" aria-labelledby="mbr-changes-h" data-testid="mbr-changes">
          <h2 id="mbr-changes-h">Changed since this record was set</h2>
          <p className="small">
            {trdN.length > 0 && `${trdN.length} TRD ${trdN.length === 1 ? "value" : "values"} changed. `}
            {sampleN.length > 0 && `${sampleN.length} sample ${sampleN.length === 1 ? "row" : "rows"} changed in the sampling plan. `}
            Nothing is rewritten for you: open the block and press the Update button on the row you want to bring up to date.
          </p>
        </section>
      )}

      <OpenItems rec={rec} open={open} requirements={requirements} library={library} run={run} goToRow={goToRow} />

      <section className="stack" aria-labelledby="mbr-sections-h">
        <div className="row wrap between">
          <h2 id="mbr-sections-h">Sections</h2>
          <button
            type="button"
            className="btn small"
            data-testid="mbr-blocks-toggle-all"
            onClick={() => {
              const all = rec.sections.flatMap((s) => s.blocks.map((b) => b.id));
              setOpenBlocks((s) => (all.every((id) => s.has(id)) ? new Set() : new Set(all)));
            }}
          >
            Open or close all blocks
          </button>
        </div>
        {rec.sections.length === 0 && <p className="muted">No sections yet. Add one below.</p>}
        {rec.sections.map((s, si) => (
          <Fragment key={s.id}>
          <SectionView
            rec={rec}
            section={s}
            index={si}
            count={rec.sections.length}
            part={cut < 0 ? undefined : si <= cut ? 1 : 2}
            env={{ rec, section: s, numbers, library, trdNotices: trdN, sampleNotices: sampleN, run }}
            openBlocks={openBlocks}
            toggle={toggle}
            run={run}
            library={library}
            askRemoveSection={(el) => {
              opener.current = el;
              setConfirm({ kind: "section", section: s });
            }}
            askRemoveBlock={(el, blockId, title) => {
              opener.current = el;
              setConfirm({ kind: "block", blockId, title });
            }}
          />
          {si < rec.sections.length - 1 && <SplitGap rec={rec} section={s} plan={plan} suggestions={suggestions.filter((x) => x.afterSectionId === s.id)} run={run} />}
          </Fragment>
        ))}
        <AddSection rec={rec} run={run} />
      </section>

      <MbrOutput rec={rec} />

      <section className="card stack no-print" aria-labelledby="mbr-delete-h">
        <h2 id="mbr-delete-h">Delete this batch record</h2>
        <p className="muted small">The record leaves the project. The change log keeps what it said.</p>
        <div>
          <button
            type="button"
            className="btn danger"
            data-testid="mbr-delete"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setConfirm({ kind: "record" });
            }}
          >
            Delete batch record
          </button>
        </div>
      </section>

      {confirm && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm.kind === "record" ? "Delete this batch record?" : confirm.kind === "section" ? "Remove this section?" : "Remove this block?"}
          description={confirm.kind === "record" ? `${rec.id}: ${rec.title}` : confirm.kind === "section" ? `${confirm.section.title}, with ${confirm.section.blocks.length} blocks.` : confirm.title}
          restoreFocus={() => opener.current}
        >
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="mbr-confirm-remove"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c.kind === "record") {
                  if (run((p, a) => deleteMbr(p, rec.id, a), "Batch record deleted")) navigate("/mbr");
                } else if (c.kind === "section") run((p, a) => removeSection(p, rec.id, c.section.id, a), "Section removed");
                else run((p, a) => removeBlock(p, rec.id, c.blockId, a), "Block removed");
              }}
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Details({ rec, run, trdTitle, planTitle }: { rec: MbrRecord; run: Run; trdTitle: string | undefined; planTitle: string | undefined }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(rec.title);
  const [docRef, setDocRef] = useState(rec.docRef ?? "");
  const [version, setVersion] = useState(rec.version ?? "");
  const [purpose, setPurpose] = useState(rec.purpose ?? "");
  const editBtn = useRef<HTMLButtonElement>(null);
  const done = () => {
    setEditing(false);
    setTimeout(() => editBtn.current?.focus(), 0);
  };
  return (
    <section className="card stack" aria-labelledby="mbr-details-h">
      <h2 id="mbr-details-h">Document details</h2>
      {!editing ? (
        <div className="batch-summary" role="group" aria-label="Document details summary" data-testid="mbr-details-summary">
          <dl>
            <div>
              <dt>Title:</dt>
              <dd>
                <strong>{rec.title}</strong>
              </dd>
            </div>
            <div>
              <dt>Document reference:</dt>
              <dd>{rec.docRef?.trim() || "not given"}</dd>
            </div>
            <div>
              <dt>Version:</dt>
              <dd>{rec.version?.trim() || "not given"}</dd>
            </div>
            <div>
              <dt>Purpose:</dt>
              <dd>{rec.purpose?.trim() || "not written yet"}</dd>
            </div>
            <div>
              <dt>TRD record:</dt>
              <dd>{trdTitle ?? "none"}</dd>
            </div>
            <div>
              <dt>Sampling plan:</dt>
              <dd>{planTitle ?? "none"}</dd>
            </div>
            <div>
              <dt>Last changed:</dt>
              <dd>{dateTime(rec.updatedAt)}</dd>
            </div>
          </dl>
          <div className="batch-actions">
            <button
              ref={editBtn}
              type="button"
              className="btn"
              aria-label="Edit document details"
              data-testid="mbr-details-edit"
              onClick={() => {
                setTitle(rec.title);
                setDocRef(rec.docRef ?? "");
                setVersion(rec.version ?? "");
                setPurpose(rec.purpose ?? "");
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="mbr-title" />
          </label>
          <div className="row wrap">
            <label className="field">
              <span>Document reference (optional)</span>
              <input value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="mbr-docref" />
            </label>
            <label className="field">
              <span>Version (optional)</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} data-testid="mbr-version" />
            </label>
          </div>
          <label className="field">
            <span>Purpose (optional)</span>
            <textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} data-testid="mbr-purpose" />
          </label>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              data-testid="mbr-details-save"
              onClick={() => {
                if (run((p, a) => updateMbr(p, rec.id, { title, docRef, version, purpose }, a), "Details saved")) done();
              }}
            >
              Save details
            </button>
            <button type="button" className="btn" onClick={done}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function OpenItems({
  rec,
  open,
  requirements,
  library,
  run,
  goToRow,
}: {
  rec: MbrRecord;
  open: ReturnType<typeof mbrOpenItems>;
  requirements: TrdRequirement[];
  library: ReturnType<typeof useMbrLibrary>;
  run: Run;
  goToRow: (blockId: string, rowId: string) => void;
}) {
  const rest = open.filter((o) => o.kind !== "no_step");
  return (
    <section className="card stack" aria-labelledby="mbr-open-h" data-testid="mbr-open-items">
      <h2 id="mbr-open-h">Open items ({open.length})</h2>
      <p className="muted small">For information. Nothing here blocks you; it is what the record still leaves open.</p>
      {open.length === 0 && <p>Nothing open.</p>}
      {rest.length > 0 && (
        <ul className="plain-list">
          {rest.map((o, i) => (
            <li key={i} className="row wrap">
              <span>
                <strong>{o.text}</strong>: {o.where}
              </span>
              {o.blockId && o.rowId && (
                <button type="button" className="btn small" aria-label={`Go to row: ${o.where}`} onClick={() => goToRow(o.blockId!, o.rowId!)}>
                  Go to row
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {requirements.length > 0 && (
        <div className="stack" data-testid="mbr-requirements">
          <h3>TRD requirement without an MBR step ({requirements.length})</h3>
          <ul className="plain-list">
            {requirements.map((q) => {
              const lib = q.suggestedBlockIds.map((id) => library.find((b) => b.id === id)).filter((b) => b !== undefined);
              return (
                <li key={`${q.unitOp}.${q.collection}.${q.itemKey}`} className="row wrap" data-testid={`mbr-req-${q.unitOp}-${q.itemKey}`}>
                  <span>
                    {q.stepLabel}: {q.label}
                  </span>
                  {lib.map((b) => (
                    <button key={b.id} type="button" className="btn small" aria-label={`Add block: ${b.title} for ${q.label}`} data-testid={`mbr-req-add-${q.itemKey}`} onClick={() => run((p, a) => addBlockForRequirement(p, rec.id, q, b, a).project, "Block added")}>
                      Add block: {b.title}
                    </button>
                  ))}
                  <button type="button" className="btn small" aria-label={`Add a block of my own for ${q.label}`} onClick={() => run((p, a) => addBlockForRequirement(p, rec.id, q, undefined, a).project, "Block added")}>
                    Add a block of my own
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function SectionView({
  rec,
  section,
  index,
  count,
  part,
  env,
  openBlocks,
  toggle,
  run,
  library,
  askRemoveSection,
  askRemoveBlock,
}: {
  rec: MbrRecord;
  section: MbrSection;
  index: number;
  count: number;
  /** Which part of a split record the section is in. Absent for a record that is not split. */
  part: 1 | 2 | undefined;
  env: BlockEnv;
  openBlocks: Set<string>;
  toggle: (id: string) => void;
  run: Run;
  library: ReturnType<typeof useMbrLibrary>;
  askRemoveSection: (el: HTMLElement) => void;
  askRemoveBlock: (el: HTMLElement, blockId: string, title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const renameBtn = useRef<HTMLButtonElement>(null);
  const offered = section.unitOp ? blocksForUnitOp(library, section.unitOp) : library;
  return (
    <section className="card stack" aria-labelledby={`mbr-sec-${section.id}`} data-testid={`mbr-section-${section.id}`}>
      <div className="row wrap between">
        {!renaming ? (
          <h3 id={`mbr-sec-${section.id}`}>
            {index + 1}. {section.title}
            {part && (
              <span className="guide-badge split-part" data-testid={`mbr-part-label-${section.id}`}>
                Part {part}
              </span>
            )}
          </h3>
        ) : (
          <label className="field grow">
            <span>Section title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid={`mbr-section-title-${section.id}`} />
          </label>
        )}
        <span className="row wrap">
          {!renaming ? (
            <button ref={renameBtn} type="button" className="btn small" aria-label={`Rename section ${section.title}`} onClick={() => { setTitle(section.title); setRenaming(true); }}>
              Rename
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn primary small"
                onClick={() => {
                  if (run((p, a) => updateSection(p, rec.id, section.id, { title }, a), "Section renamed")) {
                    setRenaming(false);
                    setTimeout(() => renameBtn.current?.focus(), 0);
                  }
                }}
              >
                Save title
              </button>
              <button type="button" className="btn small" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </>
          )}
          <button type="button" className="btn small" aria-label={`Move section ${section.title} up`} disabled={index === 0} onClick={() => run((p, a) => moveSection(p, rec.id, section.id, -1, a), "Section moved")}>
            Up
          </button>
          <button type="button" className="btn small" aria-label={`Move section ${section.title} down`} disabled={index === count - 1} onClick={() => run((p, a) => moveSection(p, rec.id, section.id, 1, a), "Section moved")}>
            Down
          </button>
          <button type="button" className="btn small" aria-label={`Remove section ${section.title}`} data-testid={`mbr-section-remove-${section.id}`} onClick={(e) => askRemoveSection(e.currentTarget)}>
            Remove
          </button>
        </span>
      </div>
      {section.blocks.length === 0 && <p className="muted small">No blocks in this section yet.</p>}
      {section.blocks.map((b, bi) => (
        <BlockCard key={b.id} env={env} block={b} index={bi} count={section.blocks.length} open={openBlocks.has(b.id)} onToggle={() => toggle(b.id)} onRemove={(el) => askRemoveBlock(el, b.id, b.title)} />
      ))}
      <div className="row wrap end-align">
        <label className="field">
          <span>Add a block from the library</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid={`mbr-add-lib-${section.id}`}>
            <option value="">Choose a block</option>
            {offered.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn small"
          disabled={!pick}
          data-testid={`mbr-add-lib-btn-${section.id}`}
          onClick={() => {
            const lib = library.find((b) => b.id === pick);
            if (lib && run((p, a) => addBlockFromLibrary(p, rec.id, section.id, lib, a).project, "Block added")) setPick("");
          }}
        >
          Add block
        </button>
        <label className="field grow">
          <span>Or a block of my own</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} data-testid={`mbr-add-custom-${section.id}`} />
        </label>
        <button
          type="button"
          className="btn small"
          disabled={!custom.trim()}
          data-testid={`mbr-add-custom-btn-${section.id}`}
          onClick={() => {
            if (run((p, a) => addCustomBlock(p, rec.id, section.id, { title: custom }, a).project, "Block added")) setCustom("");
          }}
        >
          Add my block
        </button>
      </div>
    </section>
  );
}

function AddSection({ rec, run }: { rec: MbrRecord; run: Run }) {
  const [title, setTitle] = useState("");
  return (
    <div className="row wrap end-align card">
      <label className="field grow">
        <span>New section</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="mbr-section-new" />
      </label>
      <button
        type="button"
        className="btn"
        disabled={!title.trim()}
        data-testid="mbr-section-add"
        onClick={() => {
          if (run((p, a) => addSection(p, rec.id, { title }, a).project, "Section added")) setTitle("");
        }}
      >
        Add section
      </button>
    </div>
  );
}

/**
 * The gap after a section. An unsplit record offers "Split here" (and, when the sampling plan has a hold at this gap, says so: the hint is
 * only a pointer, the author chooses). The gap where the record is split shows the two hold entries and the settings of the split.
 */
function SplitGap({ rec, section, plan, suggestions, run }: { rec: MbrRecord; section: MbrSection; plan: SamplingPlan | undefined; suggestions: ReturnType<typeof mbrHoldSuggestions>; run: Run }) {
  const project = useStore((s) => s.project)!;
  const split = rec.split;
  if (split) return split.afterSectionId === section.id ? <SplitPanel rec={rec} plan={plan} run={run} info={holdEntryInfo(project, rec)} /> : null;
  return (
    <div className="split-gap no-print" data-testid={`mbr-gap-${section.id}`}>
      {suggestions.map((x) => (
        <p key={x.hold.id} className="notice small" data-testid={`mbr-split-hint-${section.id}`}>
          The sampling plan has a hold here: {x.hold.label}
        </p>
      ))}
      <div className="row wrap">
        <button
          type="button"
          className="btn small"
          data-testid={`mbr-split-${section.id}`}
          aria-label={`Split here, after section ${section.title}`}
          onClick={() => run((p, a) => splitMbr(p, rec.id, { afterSectionId: section.id }, a), "Record split into two parts")}
        >
          Split here
        </button>
        {suggestions.map((x) => (
          <button
            key={x.hold.id}
            type="button"
            className="btn small"
            data-testid={`mbr-split-with-${x.hold.id}`}
            onClick={() => run((p, a) => splitMbr(p, rec.id, { afterSectionId: section.id, planHoldId: x.hold.id }, a), "Record split into two parts")}
          >
            Split here and use the hold {x.hold.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SplitPanel({ rec, plan, run, info }: { rec: MbrRecord; plan: SamplingPlan | undefined; run: Run; info: ReturnType<typeof holdEntryInfo> }) {
  const split = rec.split!;
  const [ref1, setRef1] = useState(split.part1DocRef ?? "");
  const [ref2, setRef2] = useState(split.part2DocRef ?? "");
  const limits = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.timeLimits));
  const patch = (p: Parameters<typeof updateSplit>[2], status: string) => run((pr, a) => updateSplit(pr, rec.id, p, a), status);
  return (
    <section className="card stack split-panel" aria-labelledby="mbr-split-h" data-testid="mbr-split-panel">
      <div className="row wrap between">
        <h3 id="mbr-split-h">Split of the record: Part 1 ends here, Part 2 starts after the hold</h3>
        <button type="button" className="btn small" data-testid="mbr-merge" onClick={() => run((p, a) => mergeMbr(p, rec.id, a), "Parts merged back into one record")}>
          Merge the parts
        </button>
      </div>
      <p className="small muted">
        Both parts are one record: they share the TRD links, notices and time limits, and the section and step numbers run on from Part 1 into Part 2. Each part has its own document number and its own Word export.
      </p>
      <div className="row wrap end-align">
        <label className="field grow">
          <span>Part 1 document number</span>
          <input value={ref1} onChange={(e) => setRef1(e.target.value)} data-testid="mbr-split-ref1" />
        </label>
        <label className="field grow">
          <span>Part 2 document number</span>
          <input value={ref2} onChange={(e) => setRef2(e.target.value)} data-testid="mbr-split-ref2" />
        </label>
        <button type="button" className="btn small" data-testid="mbr-split-refs-save" onClick={() => patch({ part1DocRef: ref1, part2DocRef: ref2 }, "Document numbers saved")}>
          Save document numbers
        </button>
      </div>
      <div className="row wrap end-align">
        <label className="field grow">
          <span>Hold of the sampling plan at this gap</span>
          <select value={split.planHoldId ?? ""} onChange={(e) => patch({ planHoldId: e.target.value || null }, "Hold changed")} data-testid="mbr-split-hold">
            <option value="">No hold chosen</option>
            {(plan?.holds ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Hold time limit the elapsed time is compared with</span>
          <select value={split.holdLimitId ?? ""} onChange={(e) => patch({ holdLimitId: e.target.value || null }, "Hold time limit changed")} data-testid="mbr-split-limit">
            <option value="">No limit stated</option>
            {limits.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.value ? `: ${t.value}${t.unit ? ` ${t.unit}` : ""}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {info.holdMissing && <p className="notice small">The hold named earlier is no longer in the sampling plan. Choose another or none.</p>}
      <div className="table-scroll" role="region" aria-label="Hold entries where the parts meet" tabIndex={0}>
        <table data-testid="mbr-split-entries">
          <caption>Hold entries where the parts meet</caption>
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">Part</th>
              <th scope="col">Samples from the sampling plan</th>
            </tr>
          </thead>
          <tbody>
            {info.entries.map((e) => (
              <tr key={e.edge} data-testid={`mbr-split-entry-${e.edge}`}>
                <th scope="row">{e.edge === "start" ? "Hold start (end of Part 1)" : "Hold end (start of Part 2)"}</th>
                <td>Part {e.part}</td>
                <td>{e.samples.length ? e.samples.map((x) => `${x.pointId} ${x.test}`).join(", ") : info.hold ? "none in the plan" : "no hold chosen"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Each entry has write-in lines for date and time, done by, checked by, vessel or bag ID, storage temperature and room. The hold-end entry also has the elapsed hold time, written by the operator next to{" "}
        {info.limit ? `the limit "${info.limit.label}"` : 'the words "No limit stated"'}.
      </p>
    </section>
  );
}
