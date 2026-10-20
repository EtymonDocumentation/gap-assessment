import {
  addCustomItem,
  attachableSources,
  attachToCell,
  detachFromCell,
  needsSelfVerification,
  planSectionVerification,
  previewDetach,
  unverifyCell,
  verifyCell,
  verifySection,
  addCustomUnitOperation,
  applyAnswer,
  buildModelView,
  CUSTOM_KIND_LABELS,
  filterModelView,
  removeCustomItem,
  removeCustomUnitOperation,
  renameCustomItem,
  renameCustomUnitOperation,
  setResponder,
  sourceLabel,
  unitDimensions,
  type AnswerInput,
  type AttributeSide,
  type BuilderAttribute,
  type CustomDefinitionRow,
} from "@gap/engine";
import { addSource, CUSTOM_ITEM_KINDS, type Actor, type CustomItemKind } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryChip, Empty, Modal, ResponderForm, VerificationBadge, VerifierFields } from "../components";
import { useRoute } from "../router";
import { useAssessment, useContent, useStageWording, useStore } from "../store";
import { QuestionInput, initialForm, toAnswer, type FormState } from "./question-inputs";

type SideKey = "source" | "target" | "shared";
const SIDE_NAME: Record<SideKey, string> = { source: "SU", target: "RU", shared: "Value" };

interface EditTarget {
  attr: BuilderAttribute;
  sideKey: SideKey;
  cell: AttributeSide;
}

type SourceLink = { id: string; label: string; refs: string[] };
type CellAction = "edit" | "verify" | "unverify" | "attach" | "detach";
type Who = { name: string; role?: string };

/** The named verifier acts at the current time; they are not necessarily the responder. */
const asVerifier = (actor: Actor, who: Who): Actor => ({ name: who.name, at: actor.at, ...(who.role ? { role: who.role } : {}) });

type Dialogs =
  | { kind: "edit"; target: EditTarget }
  | { kind: "verify"; target: EditTarget }
  | { kind: "unverify"; target: EditTarget }
  | { kind: "attach"; target: EditTarget }
  | { kind: "detach"; target: EditTarget; link: SourceLink }
  | { kind: "verify-section"; sectionId: string; title: string }
  | { kind: "add-uo" }
  | { kind: "add-item"; uo?: string }
  | { kind: "rename"; def: CustomDefinitionRow }
  | { kind: "remove"; def: CustomDefinitionRow }
  | null;

const cellButtonId = (action: string, attrId: string, side: SideKey) => `${action}-${attrId}-${side}`;
const editButtonId = (attrId: string, side: SideKey) => cellButtonId("edit", attrId, side);

/** Editable view of the process model: every attribute of every in-scope section, source beside target. */
export function BuilderPage() {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const a = useAssessment()!;
  const view = useMemo(() => buildModelView(content, project, a), [content, project, a]);
  const wording = useStageWording();

  const [text, setText] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyUnverified, setOnlyUnverified] = useState(false);
  const shown = useMemo(
    () => filterModelView(view, { text, onlyDifferences, onlyOpen, onlyUnverified }),
    [view, text, onlyDifferences, onlyOpen, onlyUnverified],
  );
  const attrCount = shown.sections.reduce((n, s) => n + s.attributes.length, 0);

  const [dialog, setDialog] = useState<Dialogs>(null);
  const [pendingOpen, setPendingOpen] = useState<Dialogs>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // After a change, move focus to the element that was affected, or to the page heading.
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(focusId) ?? headingRef.current;
    el?.focus();
    setFocusId(null);
  }, [focusId, project]);

  // A link from the Sources page names the question to show (?q=...): scroll to its row and focus it.
  const targetQ = useRoute().params.get("q");
  useEffect(() => {
    if (!targetQ) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`attr-${targetQ}`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [targetQ]);

  const needsResponder = !project.interview.responder;
  /** Opens a dialog, asking who is making the change first when no responder is recorded yet. */
  const open = (d: Dialogs) => (needsResponder ? setPendingOpen(d) : setDialog(d));

  const returnFocus = useRef<string | null>(null);
  const restoreFocus = () => (returnFocus.current ? document.getElementById(returnFocus.current) : null) ?? headingRef.current;

  const activeUos = content.catalog.unitOperations;

  /** Opens the dialog for a button inside an attribute cell, asking for a responder first when needed. */
  const act = (kind: CellAction, target: EditTarget, link?: SourceLink) => {
    returnFocus.current = cellButtonId(kind === "detach" ? `detach-${link!.id}` : kind, target.attr.id, target.sideKey);
    if (kind === "edit") return open({ kind: "edit", target });
    if (kind === "verify") return setDialog({ kind: "verify", target }); // the verifier is named in the dialog itself
    if (kind === "unverify") return open({ kind: "unverify", target });
    if (kind === "attach") return open({ kind: "attach", target });
    return open({ kind: "detach", target, link: link! });
  };

  return (
    <div className="stack-lg">
      <div>
        <h1 ref={headingRef} tabIndex={-1} id="builder-title">
          Builder
        </h1>
        <p className="muted">
          Every attribute of the process model, SU beside RU, with its status, sources, verification state and revision. Edit a value in place,
          or add your own unit operations and items. Nothing is filled in by default: every value has a source.
        </p>
      </div>

      <div className="row wrap">
        <button
          type="button"
          id="add-uo-button"
          className="btn primary"
          onClick={() => {
            returnFocus.current = "add-uo-button";
            open({ kind: "add-uo" });
          }}
        >
          Add unit operation
        </button>
        <button
          type="button"
          id="add-item-button"
          className="btn"
          onClick={() => {
            returnFocus.current = "add-item-button";
            open({ kind: "add-item" });
          }}
        >
          Add parameter, equipment, material or control
        </button>
      </div>

      <div className="filters" role="search" aria-label="Filter the builder">
        <label className="field">
          <span>Filter by text or path</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. filter, mixing, uo.compounding" />
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
          <span>Only differences</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          <span>Only open items</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyUnverified} onChange={(e) => setOnlyUnverified(e.target.checked)} />
          <span>Only unverified or withdrawn</span>
        </label>
        <p className="small muted filter-count" aria-live="polite" role="status">
          {attrCount} {attrCount === 1 ? "attribute" : "attributes"} shown
        </p>
      </div>

      {shown.sections.length === 0 ? (
        <Empty>No attributes match the filter.</Empty>
      ) : (
        shown.sections.map((s) => {
          const headingId = `sec-${s.section.id}`;
          return (
            <section key={s.section.id} aria-labelledby={headingId} className="stack builder-section">
              <div className="section-head">
                <h2 id={headingId} tabIndex={-1}>
                  {s.section.title}
                  {s.custom && <span className="tag tag-custom">Custom unit operation</span>}
                </h2>
                <button
                  type="button"
                  id={`verify-section-${s.section.id}`}
                  className="btn small"
                  aria-label={`Verify all in this section: ${s.section.title}`}
                  onClick={() => {
                    returnFocus.current = `verify-section-${s.section.id}`;
                    setDialog({ kind: "verify-section", sectionId: s.section.id, title: s.section.title });
                  }}
                >
                  Verify all in this section
                </button>
              </div>
              <div className="table-scroll" role="region" aria-label={`${s.section.title} attributes`} tabIndex={0}>
                <table className="data builder-table">
                  <thead>
                    <tr>
                      <th scope="col">Attribute</th>
                      <th scope="col">{wording.sourceValidated ? "SU (validated)" : "SU (current)"}</th>
                      <th scope="col">RU (planned)</th>
                      <th scope="col">Comparison</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.attributes.map((attr) => (
                      <tr key={attr.id} id={`attr-${attr.id}`} tabIndex={-1} className={attr.differs ? "row-diff" : undefined}>
                        <th scope="row" className={attr.depth > 0 ? "indent" : undefined}>
                          {attr.label}
                          {attr.custom && <span className="tag tag-custom">Custom</span>}
                          {attr.open && <span className="tag">Open</span>}
                        </th>
                        {attr.shared ? (
                          <td colSpan={2}>
                            <Cell attr={attr} sideKey="shared" cell={attr.shared} act={act} />
                          </td>
                        ) : (
                          <>
                            <td>{attr.source ? <Cell attr={attr} sideKey="source" cell={attr.source} act={act} /> : <span className="muted">Not asked</span>}</td>
                            <td>{attr.target ? <Cell attr={attr} sideKey="target" cell={attr.target} act={act} /> : <span className="muted">Not asked</span>}</td>
                          </>
                        )}
                        <td>
                          {attr.gaps.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            <span className="chips">
                              {attr.gaps.map((g) => (
                                <CategoryChip key={g.key} category={g.category} compact />
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <section aria-labelledby="defs-title" className="stack">
        <h2 id="defs-title">Custom definitions</h2>
        {view.definitions.length === 0 ? (
          <Empty>No custom unit operations or items yet.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Custom definitions table" tabIndex={0}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Unit operation</th>
                  <th scope="col">Added by</th>
                  <th scope="col">Recorded values</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.definitions.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">
                      {d.label}
                      {d.why && <div className="small muted">{d.why}</div>}
                    </th>
                    <td>{d.typeText}</td>
                    <td>{d.kind === "uo" ? "—" : d.uoLabel}</td>
                    <td className="small">
                      {d.createdBy}, {d.createdAt.slice(0, 10)}
                    </td>
                    <td>{d.recorded}</td>
                    <td>
                      <div className="row wrap">
                        <button
                          type="button"
                          id={`rename-${d.id}`}
                          className="btn small"
                          aria-label={`Rename ${d.label}`}
                          onClick={() => {
                            returnFocus.current = `rename-${d.id}`;
                            open({ kind: "rename", def: d });
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          id={`remove-${d.id}`}
                          className="btn small danger"
                          aria-label={`Remove ${d.label}`}
                          onClick={() => {
                            returnFocus.current = `remove-${d.id}`;
                            open({ kind: "remove", def: d });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="inactive-title" className="stack">
        <h2 id="inactive-title" tabIndex={-1}>
          Inactive values <span className="tag">{shown.inactive.length}</span>
        </h2>
        <p className="muted small">
          Values that are kept but no longer count: a later answer closed their question, or their custom definition was removed. They are excluded from the
          comparison and the document.
        </p>
        {shown.inactive.length === 0 ? (
          <Empty>No inactive values.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Inactive values table" tabIndex={0}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Where</th>
                  <th scope="col">Attribute</th>
                  <th scope="col">Side</th>
                  <th scope="col">Value</th>
                  <th scope="col">Why inactive</th>
                  <th scope="col">Sources</th>
                  <th scope="col">Verification</th>
                  <th scope="col">Revision</th>
                </tr>
              </thead>
              <tbody>
                {shown.inactive.map((r) => (
                  <tr key={r.ref}>
                    <td>{r.where}</td>
                    <th scope="row">
                      {r.name} <span className="tag">Inactive</span>
                    </th>
                    <td>{SIDE_NAME[r.side]}</td>
                    <td>{r.display}</td>
                    <td className="small">{r.reason}</td>
                    <td className="small">{r.sources.join("; ") || "—"}</td>
                    <td className="small">{r.verification}</td>
                    <td className="small">{r.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={pendingOpen !== null}
        onOpenChange={(o) => !o && setPendingOpen(null)}
        title="Who is making this change?"
        description="The name and role are recorded on every change as its source."
        restoreFocus={restoreFocus}
      >
        <ResponderForm
          submitLabel="Save responder and continue"
          onSubmit={(v) => {
            update((p, actor) => setResponder(p, { name: v.name, ...(v.role ? { role: v.role } : {}) }, actor.at), "Responder saved");
            const next = pendingOpen;
            setPendingOpen(null);
            setDialog(next);
          }}
        />
      </Modal>

      {dialog?.kind === "edit" && (
        <EditDialog
          target={dialog.target}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSave={(input) => {
            const err = update((p, actor) => applyAnswer(p, content, dialog.target.cell.inst, input, actor), `${dialog.target.attr.label} saved`);
            if (!err) {
              returnFocus.current = editButtonId(dialog.target.attr.id, dialog.target.sideKey);
              setDialog(null);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "verify" && (
        <VerifyDialog
          target={dialog.target}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onVerify={(who, opts) => {
            const refs = dialog.target.cell.verification.verifiable;
            const err = update((p, actor) => verifyCell(p, refs, asVerifier(actor, who), opts), `${dialog.target.attr.label} verified by ${who.name}`);
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "unverify" && (
        <UnverifyDialog
          target={dialog.target}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onWithdraw={(reason) => {
            const err = update(
              (p, actor) => unverifyCell(p, dialog.target.cell.verification.withdrawable, actor, reason),
              `Verification withdrawn for ${dialog.target.attr.label}`,
            );
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "attach" && (
        <AttachDialog
          target={dialog.target}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onAttach={(choice) => {
            const refs = dialog.target.cell.refs;
            const err = update(
              (p, actor) => {
                if (choice.kind === "existing") return attachToCell(p, refs, choice.sourceId, actor);
                const added = addSource(p, { type: "document_reference", docRef: choice.docRef }, actor);
                return attachToCell(added.project, refs, added.source.id, actor);
              },
              `Source attached to ${dialog.target.attr.label}`,
            );
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "detach" && (
        <DetachDialog
          target={dialog.target}
          link={dialog.link}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onDetach={() => {
            const link = dialog.link;
            let reverted = 0;
            const err = update(
              (p, actor) => {
                const r = detachFromCell(p, link.refs, link.id, actor);
                reverted = r.reverted;
                return r.project;
              },
              `Source detached from ${dialog.target.attr.label}`,
            );
            if (!err) {
              if (reverted) useStore.setState({ status: `Source detached. ${dialog.target.attr.label} is now Not established.` });
              setDialog(null);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "verify-section" && (
        <VerifySectionDialog
          sectionId={dialog.sectionId}
          title={dialog.title}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onVerify={(who, opts) => {
            let n = 0;
            const err = update(
              (p, actor) => {
                const r = verifySection(content, p, dialog.sectionId, "all", asVerifier(actor, who), opts);
                n = r.verified.length;
                return r.project;
              },
              `Section verified by ${who.name}`,
            );
            if (!err) {
              useStore.setState({ status: `${n} ${n === 1 ? "entry" : "entries"} verified in ${dialog.title}` });
              setDialog(null);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "add-uo" && (
        <AddUoDialog
          uos={activeUos.map((u) => ({ key: u.key, label: u.label }))}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onAdd={(v) => {
            const err = update((p, actor) => addCustomUnitOperation(p, content, v, actor), `${v.label} added`);
            if (!err) {
              const key = useStore.getState().project!.custom.unitOperations.at(-1)!.key;
              returnFocus.current = `sec-uo.${key}`;
              setDialog(null);
              setFocusId(`sec-uo.${key}`);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "add-item" && (
        <AddItemDialog
          uos={activeUos.map((u) => ({ key: u.key, label: u.label }))}
          initialUo={dialog.uo}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onAdd={(v) => {
            const err = update((p, actor) => addCustomItem(p, content, v, actor), `${v.label} added`);
            if (!err) {
              returnFocus.current = "add-item-button";
              setDialog(null);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "rename" && (
        <RenameDialog
          def={dialog.def}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onRename={(label) => {
            const d = dialog.def;
            const err = update(
              (p, actor) =>
                d.kind === "uo"
                  ? renameCustomUnitOperation(p, d.key, label, actor)
                  : renameCustomItem(p, { uo: d.uo, coll: d.coll!, key: d.key }, label, actor),
              `Renamed to ${label}`,
            );
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "remove" && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Remove ${dialog.def.label}?`}
          description="This removes the definition, not the recorded values."
          restoreFocus={() => document.getElementById("inactive-title") ?? headingRef.current}
        >
          <div className="stack">
            <p>
              {dialog.def.recorded === 0
                ? "No values have been recorded for it yet."
                : `${dialog.def.recorded} recorded ${dialog.def.recorded === 1 ? "value becomes" : "values become"} inactive.`}{" "}
              Inactive values are kept and listed under Inactive values, but they are excluded from the comparison, the gap register and the document.
              {dialog.def.kind === "uo" && " Custom items of this unit operation are removed too, with the same effect on their values."}
            </p>
            <div className="row end">
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const d = dialog.def;
                  const err = update(
                    (p, actor) => (d.kind === "uo" ? removeCustomUnitOperation(p, d.key, actor) : removeCustomItem(p, { uo: d.uo, coll: d.coll!, key: d.key }, actor)),
                    `${d.label} removed`,
                  );
                  if (!err) {
                    setDialog(null);
                    setFocusId("inactive-title");
                  }
                }}
              >
                Remove and keep values as inactive
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Cell({
  attr,
  sideKey,
  cell,
  act,
}: {
  attr: BuilderAttribute;
  sideKey: SideKey;
  cell: AttributeSide;
  act: (kind: CellAction, t: EditTarget, link?: SourceLink) => void;
}) {
  const statusClass = `status-${cell.status}`;
  const target: EditTarget = { attr, sideKey, cell };
  const sideLabel = sideKey === "shared" ? "" : `, ${SIDE_NAME[sideKey]}`;
  const v = cell.verification;
  return (
    <div className="b-cell">
      <div className="b-value">{cell.display}</div>
      <div className="small">
        <span className={`tag status ${statusClass}`}>{cell.statusText}</span>
        <span className="muted"> Revision {cell.revision}</span>
      </div>
      <div className="small">
        <span className="muted">Sources: </span>
        {cell.sourceLinks.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul className="b-sources">
            {cell.sourceLinks.map((l) => (
              <li key={l.id}>
                <span>{l.label}</span>
                <button
                  type="button"
                  id={cellButtonId(`detach-${l.id}`, attr.id, sideKey)}
                  className="btn small ghost"
                  aria-label={`Detach source ${l.label} from ${attr.label}${sideLabel}`}
                  onClick={() => act("detach", target, l)}
                >
                  Detach
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cell.hiddenSources > 0 && (
        <div className="small muted">
          {cell.hiddenSources} other {cell.hiddenSources === 1 ? "source is" : "sources are"} also recorded (shown in the Source register).
        </div>
      )}
      <div className="small">
        <VerificationBadge state={v.state} text={v.text} />
      </div>
      {v.hint && v.state !== "verified" && v.verifiable.length === 0 && <div className="small muted">{v.hint}</div>}
      <div className="b-actions">
        <button
          type="button"
          id={editButtonId(attr.id, sideKey)}
          className="btn small"
          aria-label={`Edit ${attr.label}${sideLabel}`}
          onClick={() => act("edit", target)}
        >
          Edit
        </button>
        {v.verifiable.length > 0 && (
          <button
            type="button"
            id={cellButtonId("verify", attr.id, sideKey)}
            className="btn small"
            aria-label={`Verify ${attr.label}${sideLabel}`}
            onClick={() => act("verify", target)}
          >
            Verify
          </button>
        )}
        {v.withdrawable.length > 0 && (
          <button
            type="button"
            id={cellButtonId("unverify", attr.id, sideKey)}
            className="btn small"
            aria-label={`Withdraw verification of ${attr.label}${sideLabel}`}
            onClick={() => act("unverify", target)}
          >
            Withdraw verification
          </button>
        )}
        {cell.status !== "not_established" && (
          <button
            type="button"
            id={cellButtonId("attach", attr.id, sideKey)}
            className="btn small"
            aria-label={`Attach source to ${attr.label}${sideLabel}`}
            onClick={() => act("attach", target)}
          >
            Attach source
          </button>
        )}
      </div>
    </div>
  );
}

function VerifyDialog({
  target,
  onVerify,
  onClose,
  restoreFocus,
}: {
  target: EditTarget;
  onVerify: (who: Who, opts: { selfVerification?: boolean }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const resp = project.interview.responder;
  const [name, setName] = useState(resp?.name ?? "");
  const [role, setRole] = useState(resp?.role ?? "");
  const [self, setSelf] = useState(false);
  const [error, setError] = useState("");
  const refs = target.cell.verification.verifiable;
  const selfNeeded = needsSelfVerification(project, refs, name);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Verify: ${target.attr.label}`}
      description={`${SIDE_NAME[target.sideKey]}${target.sideKey === "shared" ? "" : " side"}: ${target.cell.display}`}
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Enter the name of the person verifying.");
          if (selfNeeded && !self) return setError("Confirm that you are verifying your own entry, or ask another person to verify it.");
          setError(onVerify({ name: name.trim(), ...(role.trim() ? { role: role.trim() } : {}) }, selfNeeded ? { selfVerification: true } : {}) ?? "");
        }}
      >
        <p className="small">Verifying confirms that the value shown is correct and supported by its sources. Changing the value later withdraws the verification.</p>
        <VerifierFields name={name} role={role} onName={setName} onRole={setRole} selfNeeded={selfNeeded} self={self} onSelf={setSelf} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Verify
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UnverifyDialog({
  target,
  onWithdraw,
  onClose,
  restoreFocus,
}: {
  target: EditTarget;
  onWithdraw: (reason: string) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Withdraw verification: ${target.attr.label}`}
      description={target.cell.verification.text}
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return setError("Enter the reason for withdrawing the verification.");
          setError(onWithdraw(reason) ?? "");
        }}
      >
        <label className="field">
          <span>Reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger">
            Withdraw verification
          </button>
        </div>
      </form>
    </Modal>
  );
}

type AttachChoice = { kind: "existing"; sourceId: string } | { kind: "new"; docRef: { docType: string; identifier: string; title?: string; version?: string } };

function AttachDialog({
  target,
  onAttach,
  onClose,
  restoreFocus,
}: {
  target: EditTarget;
  onAttach: (c: AttachChoice) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const options = useMemo(() => attachableSources(project, target.cell.refs), [project, target.cell.refs]);
  const [mode, setMode] = useState<"existing" | "new">(options.length ? "existing" : "new");
  const [sourceId, setSourceId] = useState(options[0]?.id ?? "");
  const [docType, setDocType] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Attach a source: ${target.attr.label}`}
      description="A source says where the value comes from. Attaching one does not change the value or its verification."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "existing") {
            if (!sourceId) return setError("Choose a source.");
            return setError(onAttach({ kind: "existing", sourceId }) ?? "");
          }
          setError(onAttach({ kind: "new", docRef: { docType, identifier, ...(title.trim() ? { title } : {}), ...(version.trim() ? { version } : {}) } }) ?? "");
        }}
      >
        <fieldset className="stack">
          <legend>Which source?</legend>
          <label className="check">
            <input type="radio" name="attach-mode" checked={mode === "existing"} disabled={options.length === 0} onChange={() => setMode("existing")} />
            <span>An existing source{options.length === 0 ? " (none available)" : ""}</span>
          </label>
          <label className="check">
            <input type="radio" name="attach-mode" checked={mode === "new"} onChange={() => setMode("new")} />
            <span>A new document reference</span>
          </label>
        </fieldset>
        {mode === "existing" ? (
          <label className="field">
            <span>Source</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Document type</span>
              <input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="e.g. PPQ report" autoFocus />
            </label>
            <label className="field">
              <span>Identifier</span>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. DEMO-PPQ-217-02" />
            </label>
            <label className="field">
              <span>
                Title <span className="muted">(optional)</span>
              </span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>
                Version <span className="muted">(optional)</span>
              </span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Attach source
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetachDialog({
  target,
  link,
  onDetach,
  onClose,
  restoreFocus,
}: {
  target: EditTarget;
  link: SourceLink;
  onDetach: () => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const preview = previewDetach(project, link.refs, link.id);
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Detach source from ${target.attr.label}?`}
      description={link.label}
      restoreFocus={restoreFocus}
    >
      <div className="stack">
        {preview.warning ? (
          <p role="alert">
            <strong>Warning.</strong> {preview.warning}
          </p>
        ) : (
          <p>The value stays as it is. It keeps its other sources.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={preview.warning ? "btn danger" : "btn primary"} onClick={() => setError(onDetach() ?? "")}>
            {preview.warning ? "Detach and make Not established" : "Detach source"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function VerifySectionDialog({
  sectionId,
  title,
  onVerify,
  onClose,
  restoreFocus,
}: {
  sectionId: string;
  title: string;
  onVerify: (who: Who, opts: { selfVerification?: boolean }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const resp = project.interview.responder;
  const [name, setName] = useState(resp?.name ?? "");
  const [role, setRole] = useState(resp?.role ?? "");
  const [self, setSelf] = useState(false);
  const [error, setError] = useState("");
  const plan = useMemo(
    () => planSectionVerification(content, project, sectionId, "all", name, self ? { selfVerification: true } : {}),
    [content, project, sectionId, name, self],
  );
  const recordedByVerifier = plan.skip.some((s) => s.reason.startsWith("Recorded by the verifier"));
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`Verify all in ${title}`}
      description="Only entries that hold a value are verified. Unknown and Not established entries are skipped."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Enter the name of the person verifying.");
          setError(onVerify({ name: name.trim(), ...(role.trim() ? { role: role.trim() } : {}) }, self ? { selfVerification: true } : {}) ?? "");
        }}
      >
        <VerifierFields
          name={name}
          role={role}
          onName={setName}
          onRole={setRole}
          selfNeeded={recordedByVerifier || self}
          self={self}
          onSelf={setSelf}
          selfLabel="I am verifying my own entries"
        />
        <section aria-labelledby="plan-verify" className="stack">
          <h3 id="plan-verify">Will be verified ({plan.verify.length})</h3>
          {plan.verify.length === 0 ? (
            <p className="muted small">Nothing to verify.</p>
          ) : (
            <ul className="plan-list">
              {plan.verify.map((l) => (
                <li key={l.ref}>{l.text}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="plan-skip" className="stack">
          <h3 id="plan-skip">Will be skipped ({plan.skip.length})</h3>
          {plan.skip.length === 0 ? (
            <p className="muted small">Nothing is skipped.</p>
          ) : (
            <ul className="plan-list">
              {plan.skip.map((l) => (
                <li key={l.ref}>
                  {l.text}: {l.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={plan.verify.length === 0}>
            Verify {plan.verify.length} {plan.verify.length === 1 ? "entry" : "entries"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditDialog({
  target,
  onSave,
  onClose,
  restoreFocus,
}: {
  target: EditTarget;
  onSave: (input: AnswerInput) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const inst = target.cell.inst;
  const q = inst.question;
  const side = inst.side;
  const [form, setForm] = useState<FormState>(() => initialForm(content, project, inst));
  const [error, setError] = useState("");
  const [naOpen, setNaOpen] = useState(false);
  const [naText, setNaText] = useState("");
  const sameAllowed = side === "target" && q.sides === "paired" && q.sameAsSource !== false;
  const submit = (input: AnswerInput) => setError(onSave(input) ?? "");

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit: ${target.attr.label}`}
      description={`${SIDE_NAME[side]}${side === "shared" ? "" : " side"} · ${inst.section.title}`}
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const r = toAnswer(q, form);
          if ("error" in r) setError(r.error);
          else submit(r.input);
        }}
      >
        <p className="small">{q.prompt}</p>
        {q.why && <p className="small muted">Why it is asked: {q.why}</p>}
        <QuestionInput q={q} side={side} form={form} setForm={setForm} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap">
          <button type="submit" className="btn primary">
            Save value
          </button>
          <button type="button" className="btn" onClick={() => submit({ kind: "unknown" })}>
            Mark unknown
          </button>
          {sameAllowed && (
            <button type="button" className="btn" onClick={() => submit({ kind: "same_as_source" })}>
              Same as SU
            </button>
          )}
          <button type="button" className="btn ghost" aria-expanded={naOpen} onClick={() => setNaOpen((o) => !o)}>
            Not applicable…
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        {naOpen && (
          <div className="na-box">
            <label className="field">
              <span>Why does this not apply? (required)</span>
              <textarea value={naText} onChange={(e) => setNaText(e.target.value)} rows={2} />
            </label>
            <button type="button" className="btn" onClick={() => submit({ kind: "not_applicable", justification: naText })}>
              Record as not applicable
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function AddUoDialog({
  uos,
  onAdd,
  onClose,
  restoreFocus,
}: {
  uos: { key: string; label: string }[];
  onAdd: (v: { label: string; description?: string; after?: string }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [after, setAfter] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a unit operation"
      description="A custom unit operation gets its own section with a presence question. Add its parameters, equipment, materials and controls afterwards."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onAdd({ label, ...(description.trim() ? { description: description.trim() } : {}), ...(after ? { after } : {}) }) ?? "");
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Position</span>
          <select value={after} onChange={(e) => setAfter(e.target.value)}>
            <option value="">At the end</option>
            {uos.map((u) => (
              <option key={u.key} value={u.key}>
                After {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Description <span className="muted">(optional, shown as the reason for asking)</span>
          </span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Add unit operation
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddItemDialog({
  uos,
  initialUo,
  onAdd,
  onClose,
  restoreFocus,
}: {
  uos: { key: string; label: string }[];
  initialUo?: string;
  onAdd: (v: { uo: string; coll: CustomItemKind; label: string; dimension?: string; why?: string }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const dims = useMemo(() => unitDimensions(), []);
  const [uo, setUo] = useState(initialUo ?? uos[0]?.key ?? "");
  const [coll, setColl] = useState<CustomItemKind>("param");
  const [label, setLabel] = useState("");
  const [dimension, setDimension] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const hasDim = coll === "param" || coll === "equip";
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a parameter, equipment, material or control"
      description="The item is asked on both the sending unit (SU) and the receiving unit (RU) and compared like a built-in item."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(
            onAdd({
              uo,
              coll,
              label,
              ...(hasDim && dimension ? { dimension } : {}),
              ...(why.trim() ? { why: why.trim() } : {}),
            }) ?? "",
          );
        }}
      >
        <label className="field">
          <span>Unit operation</span>
          <select value={uo} onChange={(e) => setUo(e.target.value)}>
            {uos.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kind</span>
          <select value={coll} onChange={(e) => setColl(e.target.value as CustomItemKind)}>
            {CUSTOM_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {CUSTOM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        {hasDim && (
          <label className="field">
            <span>{coll === "param" ? "Unit dimension" : "Capacity unit dimension (optional)"}</span>
            <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
              <option value="">{coll === "param" ? "Choose a dimension" : "No capacity question"}</option>
              {dims.map((d) => (
                <option key={d.dimension} value={d.dimension}>
                  {d.label} ({d.units.join(", ")})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>
            Why is this asked? <span className="muted">(optional)</span>
          </span>
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Add item
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog({
  def,
  onRename,
  onClose,
  restoreFocus,
}: {
  def: CustomDefinitionRow;
  onRename: (label: string) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [label, setLabel] = useState(def.label);
  const [error, setError] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Rename ${def.label}`} description="The key and all recorded values stay the same." restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onRename(label) ?? "");
        }}
      >
        <label className="field">
          <span>New name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}
