import {
  addBlockForRequirement,
  addBlockFromLibrary,
  addCustomBlock,
  addSection,
  blocksForUnitOp,
  deleteMbr,
  mbrOpenItems,
  moveSection,
  numberSteps,
  removeBlock,
  removeSection,
  sampleNotices,
  trdNotices,
  trdRequirementsWithoutStep,
  updateMbr,
  updateSection,
  type TrdRequirement,
} from "@gap/engine";
import type { MbrRecord, MbrSection } from "@gap/process-model";
import { useMemo, useRef, useState } from "react";
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
          <SectionView
            key={s.id}
            rec={rec}
            section={s}
            index={si}
            count={rec.sections.length}
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
