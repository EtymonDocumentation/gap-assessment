import { type SubsectionLibraryItem } from "@gap/process-model";
import { isPlacement, parseSubsectionText, placementLabel, subsectionText } from "@gap/sampling";
import { useEffect, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { href } from "../router";
import { itemOf, newLibraryId, useSubsectionLibrary, type StoredSubsection } from "../subsections-library-store";
import { PlacementPicker, TEXT_FORMAT_HELP, TokenHelp } from "./SamplingSubsections";

/**
 * The Plan subsections library: reusable text a plan copies in. A plan keeps its own copy and the version it came from, so editing
 * an item here never changes an issued plan silently. Every edit keeps what the item said before (version history).
 */
export function SamplingSubsectionsPage() {
  const items = useSubsectionLibrary((s) => s.items);
  const error = useSubsectionLibrary((s) => s.error);
  const ready = useSubsectionLibrary((s) => s.ready);
  const load = useSubsectionLibrary((s) => s.load);
  const save = useSubsectionLibrary((s) => s.save);
  useEffect(() => void load(), [load]);

  const [name, setName] = useState("");
  const [ver, setVer] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Plan subsections</h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/sampling")}>Back to the sampling plans</a>
      </p>
      <section className="card stack" aria-labelledby="lib-about">
        <h2 id="lib-about">What this is</h2>
        <p className="small">
          Reusable text for sampling plans, for example a sample-handling paragraph. A plan copies an item in and keeps its own text and the version it came from. If you change an item here, plans that used it show a note that the library has moved on; they are not changed.
        </p>
        <TokenHelp />
        {error && (
          <p className="notice" role="alert" data-testid="lib-error">
            {error}
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="lib-add">
        <h2 id="lib-add">Add an item</h2>
        <form
          className="row wrap end-align"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            // The version label is the person's to name and the text starts empty, so nothing is assumed.
            save({ id: newLibraryId(), name: name.trim(), version: ver.trim(), blocks: [] }).then(
              (s) => {
                setMsg(`Added "${s.name}". Fill in its text below.`);
                setName("");
                setVer("");
              },
              () => setMsg(""),
            );
          }}
        >
          <label className="field grow">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="lib-new-name" />
          </label>
          <label className="field">
            <span>Version</span>
            <input value={ver} onChange={(e) => setVer(e.target.value)} data-testid="lib-new-version" />
          </label>
          <button type="submit" className="btn primary" disabled={!name.trim()} data-testid="lib-add">
            Add item
          </button>
        </form>
        <div role="status" aria-live="polite">
          {msg && <p className="small">{msg}</p>}
        </div>
      </section>

      <section className="stack" aria-labelledby="lib-items">
        <h2 id="lib-items">Items ({items.length})</h2>
        {!ready ? (
          <p className="muted">Loading the library.</p>
        ) : items.length === 0 ? (
          <Empty>The library is empty.</Empty>
        ) : (
          items.map((i) => <ItemCard key={i.id} item={i} />)
        )}
      </section>
    </div>
  );
}

function ItemCard({ item }: { item: StoredSubsection }) {
  const save = useSubsectionLibrary((s) => s.save);
  const remove = useSubsectionLibrary((s) => s.remove);
  const [name, setName] = useState(item.name);
  const [version, setVersion] = useState(item.version);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [text, setText] = useState(subsectionText(item.blocks));
  const [placement, setPlacement] = useState(item.suggestedPlacement ?? "");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const dirty =
    name !== item.name || version !== item.version || owner !== (item.owner ?? "") || note !== (item.note ?? "") || text !== subsectionText(item.blocks) || placement !== (item.suggestedPlacement ?? "");
  const bad = placement !== "" && !isPlacement(placement);

  const edited: SubsectionLibraryItem = {
    ...itemOf(item),
    name: name.trim(),
    version: version.trim(),
    blocks: parseSubsectionText(text),
    ...(owner.trim() ? { owner: owner.trim() } : { owner: undefined }),
    ...(note.trim() ? { note: note.trim() } : { note: undefined }),
    ...(placement ? { suggestedPlacement: placement } : { suggestedPlacement: undefined }),
  };

  return (
    <article className="card stack" aria-labelledby={`lib-${item.id}`} data-testid={`lib-item-${item.name}`}>
      <h3 id={`lib-${item.id}`}>
        {item.name} <span className="muted small">(version {item.version})</span>
      </h3>
      <div className="row wrap">
        <label className="field grow">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid={`lib-name-${item.id}`} />
        </label>
        <label className="field">
          <span>Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} data-testid={`lib-version-${item.id}`} />
        </label>
        <label className="field">
          <span>
            Owner <span className="muted">(optional)</span>
          </span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>
          Note <span className="muted">(optional)</span>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} data-testid={`lib-text-${item.id}`} />
        <span className="muted small">{TEXT_FORMAT_HELP}</span>
      </label>
      <PlacementPicker value={placement} onChange={setPlacement} idPrefix={`lib-${item.id}`} />
      <p className="muted small">
        Suggested place (not binding): {placement ? placementLabel(placement) : "none"}. {bad && "Finish choosing the place or clear the first choice."}
      </p>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || !name.trim() || bad}
          data-testid={`lib-save-${item.id}`}
          onClick={() =>
            save(edited).then(
              () => setMsg("Saved. The earlier text is kept in the version history."),
              () => setMsg(""),
            )
          }
        >
          Save item
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={(e) => {
            opener.current = e.currentTarget;
            setConfirm(true);
          }}
        >
          Delete item
        </button>
      </div>
      <div role="status" aria-live="polite">
        {msg && <p className="small">{msg}</p>}
      </div>
      <details>
        <summary>Version history ({item.history.length})</summary>
        <ul className="plain-list small" data-testid={`lib-history-${item.id}`}>
          {[...item.history].reverse().map((h) => (
            <li key={h.at}>
              {dateTime(h.at)}: {h.action === "created" ? "Created" : `Edited. Before: "${h.before?.name ?? ""}", version ${h.before?.version ?? ""}, ${h.before ? subsectionText(h.before.blocks).length : 0} characters of text.`}
            </li>
          ))}
        </ul>
      </details>
      {confirm && (
        <Modal open onOpenChange={(o) => !o && setConfirm(false)} title="Delete this library item?" description="Plans that copied it keep their own text." restoreFocus={() => opener.current}>
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid={`lib-delete-confirm-${item.id}`}
              onClick={() => {
                setConfirm(false);
                remove(item.id).catch(() => undefined);
              }}
            >
              Delete item
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
