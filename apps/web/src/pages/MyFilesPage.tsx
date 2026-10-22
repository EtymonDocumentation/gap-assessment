import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { dateTime } from "../lib";
import { href } from "../router";
import * as api from "../server/api";
import type { MyFile, MyFolder, MyListing, MyUpload } from "../server/api";
import { formatBytes } from "../server/files";
import { useIsRemote } from "../server/ServerUi";

/**
 * "My files": move any file between your own computers through the server. Server storage only, private to the account.
 * Nothing is kept in the browser; every action is a call to the server, which checks the account on its side too.
 */

const PARALLEL_UPLOADS = 3;
const MAX_DROPPED_FILES = 5000;

type Sort = "name" | "date" | "size";
type Dialog =
  | { kind: "new-folder" }
  | { kind: "rename-file"; file: MyFile }
  | { kind: "rename-folder"; folder: MyFolder }
  | { kind: "move-files"; files: MyFile[] }
  | { kind: "move-folder"; folder: MyFolder }
  | { kind: "delete-files"; files: MyFile[] }
  | { kind: "delete-folder"; folder: MyFolder }
  | { kind: "auto-delete"; file: MyFile }
  | null;

interface QueueItem {
  id: number;
  file: File;
  /** The folder it will land in, fixed when it was added (the person may browse elsewhere meanwhile). */
  folder: string;
  state: "queued" | "uploading" | "error";
  fraction: number;
  error: string;
}

const joinFolder = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The name a pasted screenshot gets: screenshot-2026-10-22-143005.png (local time, so it matches the person's clock). */
export function screenshotName(type: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  return `screenshot-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.${ext}`;
}

/** The files of a drop, with the folder each came from. Walks dropped folders; everything is read before the first await (the browser clears the drop afterwards). */
async function filesFromDrop(dt: DataTransfer): Promise<{ file: File; dir: string }[]> {
  const entries: { entry: FileSystemEntry | null; file: File | null }[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    entries.push({ entry: (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null, file: item.getAsFile() });
  }
  const plain = Array.from(dt.files);
  const out: { file: File; dir: string }[] = [];
  const walk = async (entry: FileSystemEntry, dir: string): Promise<void> => {
    if (out.length >= MAX_DROPPED_FILES) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((ok) => (entry as FileSystemFileEntry).file(ok, () => ok(null)));
      if (file) out.push({ file, dir });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const here = dir ? `${dir}/${entry.name}` : entry.name;
      // readEntries hands back at most about 100 at a time; ask again until it returns nothing.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok) => reader.readEntries(ok, () => ok([])));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, here);
      }
    }
  };
  if (entries.length === 0) return plain.map((file) => ({ file, dir: "" }));
  for (const { entry, file } of entries) {
    if (entry) await walk(entry, "");
    else if (file) out.push({ file, dir: "" });
  }
  return out;
}

export function MyFilesPage({ params }: { params: URLSearchParams }) {
  const remote = useIsRemote();
  if (!remote) {
    return (
      <section className="card stack" data-testid="myfiles-unavailable">
        <h1>My files</h1>
        <p>My files is available when you are signed in to a server that keeps your data on the server. This server keeps projects and files in your browser, so there is nothing to move between computers here.</p>
      </section>
    );
  }
  return <MyFilesView folder={params.get("folder") ?? ""} />;
}

function MyFilesView({ folder }: { folder: string }) {
  const [listing, setListing] = useState<MyListing | null>(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>("name");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const folderHeading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const running = useRef(new Map<number, MyUpload>());
  const nextId = useRef(1);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const l = await api.listMyFiles(folder);
      setListing(l);
      setProblem("");
      // Forget selections of files that are gone.
      setSelected((s) => new Set([...s].filter((id) => l.files.some((f) => f.id === id))));
    } catch (e) {
      const err = e as api.ApiError;
      setProblem(err.code === "folder-not-found" ? "That folder was not found. It may have been renamed, moved or deleted." : err.message);
      if (err.code === "folder-not-found") setListing(null);
    }
  }, [folder]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Moving into another folder: put focus on the folder heading, so keyboard and screen reader users land at the new list.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    folderHeading.current?.focus();
  }, [folder]);

  // Stop uploads and timers when the page is left.
  useEffect(() => {
    const live = running.current;
    return () => {
      for (const u of live.values()) u.cancel();
      clearTimeout(refreshTimer.current);
    };
  }, []);

  const restoreFocus = () => (trigger.current?.isConnected ? trigger.current : (heading.current ?? null));
  const open = (d: Dialog, e?: { currentTarget: HTMLElement }) => {
    trigger.current = e?.currentTarget ?? (document.activeElement as HTMLElement | null);
    setDialog(d);
  };

  /* ----- uploads ----- */

  const enqueue = useCallback(
    (items: { file: File; dir: string }[]) => {
      if (items.length === 0) return;
      const added: QueueItem[] = items.map(({ file, dir }) => {
        const target = joinFolder(folder, dir);
        let error = "";
        // The server checks everything again; these checks only save sending a file that cannot be accepted.
        if (listing && file.size > listing.maxFileBytes) error = `That is larger than the ${formatBytes(listing.maxFileBytes)} allowed for one file.`;
        else if (listing?.usage.quotaBytes != null && file.size > listing.usage.quotaBytes - listing.usage.usedBytes) error = "There is not enough space left in your My files quota.";
        return { id: nextId.current++, file, folder: target, state: error ? "error" : "queued", fraction: 0, error };
      });
      setQueue((q) => [...q, ...added]);
      setNotice(`${plural(items.length, "file")} added to the upload list.`);
    },
    [folder, listing],
  );

  // Start queued uploads, a few at a time. `running` is the guard against starting one twice.
  useEffect(() => {
    let slots = PARALLEL_UPLOADS - queue.filter((i) => i.state === "uploading").length;
    for (const item of queue) {
      if (slots <= 0) break;
      if (item.state !== "queued" || running.current.has(item.id)) continue;
      slots--;
      const upload = api.uploadMyFile(item.file, item.folder, (fraction) => setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, fraction } : x))));
      running.current.set(item.id, upload);
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, state: "uploading" } : x)));
      upload.done.then(
        (saved) => {
          running.current.delete(item.id);
          setQueue((q) => q.filter((x) => x.id !== item.id));
          setNotice(`${saved.name} was uploaded.`);
          clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => void refresh(), 150);
        },
        (e: api.ApiError) => {
          running.current.delete(item.id);
          if (e.code === "cancelled") setQueue((q) => q.filter((x) => x.id !== item.id));
          else setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, state: "error", error: e.message } : x)));
        },
      );
    }
  }, [queue, refresh]);

  const cancel = (item: QueueItem) => {
    const live = running.current.get(item.id);
    if (live) live.cancel();
    else setQueue((q) => q.filter((x) => x.id !== item.id));
    setNotice(`${item.file.name} was cancelled.`);
  };
  const dismiss = (item: QueueItem) => setQueue((q) => q.filter((x) => x.id !== item.id));

  // Ctrl+V anywhere on the page: a screenshot (or copied files) on the clipboard is uploaded.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      const now = new Date();
      enqueue(
        files.map((f, i) => {
          // A screenshot arrives as "image.png"; give it a name that says when it was taken.
          const generic = f.type.startsWith("image/") && /^image\.[a-z]+$/i.test(f.name);
          const name = generic ? screenshotName(f.type, new Date(now.getTime() + i * 1000)) : f.name;
          return { file: generic ? new File([f], name, { type: f.type }) : f, dir: "" };
        }),
      );
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enqueue]);

  // A file dropped beside the drop zone must not make the browser open it and leave the app.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void filesFromDrop(e.dataTransfer).then(enqueue);
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    enqueue(
      picked.map((file) => {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
        return { file, dir: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "" };
      }),
    );
  };

  /* ----- the list ----- */

  const files = useMemo(() => {
    const list = [...(listing?.files ?? [])];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    else if (sort === "date") list.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    else list.sort((a, b) => b.size - a.size);
    return list;
  }, [listing, sort]);
  const folders = listing?.folders ?? [];
  const chosen = files.filter((f) => selected.has(f.id));
  const crumbs = folder ? folder.split("/") : [];

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const run = async (what: () => Promise<string>) => {
    try {
      setNotice(await what());
      setProblem("");
      await refresh();
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  return (
    <section className="stack-lg" aria-labelledby="myfiles-h">
      <div className="stack">
        <h1 id="myfiles-h" ref={heading} tabIndex={-1}>
          My files
        </h1>
        <p className="lede">
          Move files between your own computers. Upload here on one computer, sign in on another and download. Files are private to your account and are kept on the server, as they are, with no scan.
        </p>
        <p className="small muted" role="status" aria-live="polite">
          {notice}
        </p>
      </div>

      <div
        className={dragging ? "dropzone active" : "dropzone"}
        role="group"
        aria-label="Add files"
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        data-testid="dropzone"
      >
        <p className="dropzone-text">{dragging ? "Drop to upload" : "Drag files or folders here, or paste a screenshot with Ctrl+V."}</p>
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={() => fileInput.current?.click()}>
            Choose files
          </button>
          <button type="button" className="btn" onClick={() => folderInput.current?.click()}>
            Choose a folder
          </button>
        </div>
        <p className="small muted">
          {listing ? `Largest single file: ${formatBytes(listing.maxFileBytes)}. ` : ""}
          Uploading to {folder ? `“${folder}”` : "the top level"}.
        </p>
        <input ref={fileInput} type="file" multiple className="visually-hidden" tabIndex={-1} aria-label="Files to upload" onChange={onPicked} />
        <input ref={folderInput} type="file" multiple className="visually-hidden" tabIndex={-1} aria-label="Folder to upload" onChange={onPicked} {...({ webkitdirectory: "" } as object)} />
      </div>

      {queue.length > 0 && (
        <section className="card stack" aria-labelledby="queue-h">
          <h2 id="queue-h" className="h-small">
            Uploads ({queue.length})
          </h2>
          <ul className="upload-list">
            {queue.map((item) => (
              <li key={item.id} className="upload-item">
                <div className="row between wrap">
                  <span className="upload-name">{item.file.name}</span>
                  <span className="small muted">{formatBytes(item.file.size)}</span>
                </div>
                {item.state === "error" ? (
                  <p className="error small" role="alert">
                    {item.file.name} was not uploaded. {item.error}
                  </p>
                ) : (
                  <p className="small">
                    <progress max={100} value={Math.round(item.fraction * 100)} aria-label={`Uploading ${item.file.name}`} />{" "}
                    {item.state === "queued" ? "Waiting" : `${Math.round(item.fraction * 100)}%`}
                  </p>
                )}
                {item.state === "error" ? (
                  <button type="button" className="btn small" aria-label={`Dismiss the error for ${item.file.name}`} onClick={() => dismiss(item)}>
                    Dismiss
                  </button>
                ) : (
                  <button type="button" className="btn small" aria-label={`Cancel the upload of ${item.file.name}`} onClick={() => cancel(item)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {problem && (
        <p className="error" role="alert">
          {problem}{" "}
          <button type="button" className="link-btn" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}

      {listing && (
        <section className="stack" aria-labelledby="folder-h">
          <nav aria-label="Folder path">
            <ol className="crumbs">
              <li>{folder ? <a href={href("/myfiles")}>My files</a> : <span aria-current="page">My files</span>}</li>
              {crumbs.map((name, i) => {
                const path = crumbs.slice(0, i + 1).join("/");
                const last = i === crumbs.length - 1;
                return (
                  <li key={path}>
                    {last ? (
                      <span aria-current="page">{name}</span>
                    ) : (
                      <a href={href("/myfiles", { folder: path })}>{name}</a>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <h2 id="folder-h" ref={folderHeading} tabIndex={-1}>
            {folder ? `Folder: ${crumbs[crumbs.length - 1]}` : "All files"}
          </h2>

          <div className="row wrap">
            <button type="button" className="btn" onClick={(e) => open({ kind: "new-folder" }, e)}>
              New folder…
            </button>
            <label className="row inline">
              <span>Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="name">Name</option>
                <option value="date">Date, newest first</option>
                <option value="size">Size, largest first</option>
              </select>
            </label>
            <button type="button" className="btn" disabled={chosen.length === 0} onClick={(e) => open({ kind: "move-files", files: chosen }, e)}>
              Move selected…
            </button>
            <button type="button" className="btn danger" disabled={chosen.length === 0} onClick={(e) => open({ kind: "delete-files", files: chosen }, e)}>
              Delete selected…
            </button>
            <span className="small muted">{chosen.length > 0 ? `${plural(chosen.length, "file")} selected` : ""}</span>
          </div>

          {folders.length === 0 && files.length === 0 ? (
            <p className="empty">{folder ? "This folder is empty." : "You have no files yet. Drag a file onto the box above, paste a screenshot, or choose files."}</p>
          ) : (
            <div className="table-scroll" role="region" aria-label="Files table" tabIndex={0}>
              <table className="data myfiles-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="Select all files in this folder"
                        checked={files.length > 0 && chosen.length === files.length}
                        disabled={files.length === 0}
                        onChange={(e) => setSelected(e.target.checked ? new Set(files.map((f) => f.id)) : new Set())}
                      />
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Size</th>
                    <th scope="col">Uploaded</th>
                    <th scope="col">From</th>
                    <th scope="col">Auto-delete</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {folders.map((f) => (
                    <tr key={`d:${f.path}`}>
                      <td />
                      <th scope="row">
                        <span className="tag">Folder</span>{" "}
                        <a href={href("/myfiles", { folder: f.path })}>{f.name}</a>
                      </th>
                      <td className="nowrap">{plural(f.files, "file")}</td>
                      <td />
                      <td />
                      <td />
                      <td>
                        <span className="row wrap">
                          <button type="button" className="btn small" aria-label={`Rename folder ${f.name}`} onClick={(e) => open({ kind: "rename-folder", folder: f }, e)}>
                            Rename
                          </button>
                          <button type="button" className="btn small" aria-label={`Move folder ${f.name}`} onClick={(e) => open({ kind: "move-folder", folder: f }, e)}>
                            Move
                          </button>
                          <button type="button" className="btn small danger" aria-label={`Delete folder ${f.name}`} onClick={(e) => open({ kind: "delete-folder", folder: f }, e)}>
                            Delete
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {files.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <input type="checkbox" aria-label={`Select ${f.name}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                      </td>
                      <th scope="row">
                        <span className="myfiles-name">
                          {f.previewable && <img className="myfiles-thumb" src={api.myPreviewUrl(f.id)} alt="" loading="lazy" width={40} height={40} />}
                          <span>{f.name}</span>
                        </span>
                      </th>
                      <td className="nowrap">{formatBytes(f.size)}</td>
                      <td className="nowrap">{dateTime(f.uploadedAt)}</td>
                      <td>{f.uploadedFrom}</td>
                      <td className="nowrap">{f.expiresAt ? `Deletes on ${dateTime(f.expiresAt).slice(0, 10)}` : "Never"}</td>
                      <td>
                        <span className="row wrap">
                          <a className="btn small" href={api.myDownloadUrl(f.id)} download={f.name} aria-label={`Download ${f.name}`}>
                            Download
                          </a>
                          <button type="button" className="btn small" aria-label={`Rename ${f.name}`} onClick={(e) => open({ kind: "rename-file", file: f }, e)}>
                            Rename
                          </button>
                          <button type="button" className="btn small" aria-label={`Move ${f.name}`} onClick={(e) => open({ kind: "move-files", files: [f] }, e)}>
                            Move
                          </button>
                          <button type="button" className="btn small" aria-label={`Auto-delete for ${f.name}`} onClick={(e) => open({ kind: "auto-delete", file: f }, e)}>
                            Auto-delete
                          </button>
                          <button type="button" className="btn small danger" aria-label={`Delete ${f.name}`} onClick={(e) => open({ kind: "delete-files", files: [f] }, e)}>
                            Delete
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {listing && <SettingsPanel listing={listing} onSaved={(m) => { setNotice(m); void refresh(); }} onError={setProblem} />}

      {dialog?.kind === "new-folder" && (
        <NameDialog
          title="New folder"
          label="Folder name"
          action="Create folder"
          initial=""
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(async () => {
              await api.createMyFolder(folder, name);
              return `Folder ${name} was created.`;
            })
          }
        />
      )}
      {dialog?.kind === "rename-file" && (
        <NameDialog
          title={`Rename ${dialog.file.name}`}
          label="File name"
          action="Rename"
          initial={dialog.file.name}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(async () => {
              await api.patchMyFile((dialog as { file: MyFile }).file.id, { name });
              return `Renamed to ${name}.`;
            })
          }
        />
      )}
      {dialog?.kind === "rename-folder" && (
        <NameDialog
          title={`Rename folder ${dialog.folder.name}`}
          label="Folder name"
          action="Rename"
          initial={dialog.folder.name}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(async () => {
              await api.renameMyFolder((dialog as { folder: MyFolder }).folder.path, name);
              return `Folder renamed to ${name}.`;
            })
          }
        />
      )}
      {dialog?.kind === "move-files" && listing && (
        <MoveDialog
          title={dialog.files.length === 1 ? `Move ${dialog.files[0]?.name}` : `Move ${plural(dialog.files.length, "file")}`}
          folders={listing.allFolders}
          current={folder}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(target) =>
            run(async () => {
              const ids = (dialog as { files: MyFile[] }).files.map((f) => f.id);
              await api.bulkMyFiles({ action: "move", ids, folder: target });
              setSelected(new Set());
              return `${plural(ids.length, "file")} moved to ${target || "the top level"}.`;
            })
          }
        />
      )}
      {dialog?.kind === "move-folder" && listing && (
        <MoveDialog
          title={`Move folder ${dialog.folder.name}`}
          // A folder cannot go into itself or into something inside it.
          folders={listing.allFolders.filter((p) => p !== dialog.folder.path && !p.startsWith(`${dialog.folder.path}/`))}
          current={folder}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(target) =>
            run(async () => {
              await api.moveMyFolder((dialog as { folder: MyFolder }).folder.path, target);
              return `Folder moved to ${target || "the top level"}.`;
            })
          }
        />
      )}
      {dialog?.kind === "delete-files" && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog.files.length === 1 ? `Delete ${dialog.files[0]?.name}?` : `Delete ${plural(dialog.files.length, "file")}?`}
          description="Deleted files are removed from the server for good. They cannot be brought back."
          restoreFocus={restoreFocus}
        >
          {dialog.files.length > 1 && (
            <ul className="plain-list small">
              {dialog.files.slice(0, 8).map((f) => (
                <li key={f.id}>{f.name}</li>
              ))}
              {dialog.files.length > 8 && <li>and {dialog.files.length - 8} more</li>}
            </ul>
          )}
          <div className="row end">
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const list = dialog.files;
                setDialog(null);
                void run(async () => {
                  await api.bulkMyFiles({ action: "delete", ids: list.map((f) => f.id) });
                  setSelected(new Set());
                  return list.length === 1 ? `${list[0]?.name} was deleted.` : `${plural(list.length, "file")} were deleted.`;
                });
              }}
            >
              {dialog.files.length === 1 ? "Delete file" : "Delete files"}
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "delete-folder" && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Delete folder ${dialog.folder.name}?`}
          description={
            dialog.folder.files > 0 || dialog.folder.folders > 0
              ? `It holds ${plural(dialog.folder.files, "file")} and ${plural(dialog.folder.folders, "folder")}. Everything inside is removed from the server for good.`
              : "The folder is empty."
          }
          restoreFocus={restoreFocus}
        >
          <div className="row end">
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const target = dialog.folder;
                setDialog(null);
                // Pressing the button in this dialog is the person's explicit confirmation of a non-empty delete.
                void run(async () => {
                  await api.deleteMyFolder(target.path, true);
                  return `Folder ${target.name} was deleted.`;
                });
              }}
            >
              Delete folder
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "auto-delete" && (
        <AutoDeleteDialog
          file={dialog.file}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(days) =>
            run(async () => {
              const f = (dialog as { file: MyFile }).file;
              await api.patchMyFile(f.id, { autoDeleteDays: days });
              return days === null ? `${f.name} will not be deleted automatically.` : `${f.name} will be deleted in ${plural(days, "day")}.`;
            })
          }
        />
      )}
    </section>
  );
}

/* ---------- dialogs ---------- */

function NameDialog({
  title,
  label,
  action,
  initial,
  onSubmit,
  onClose,
  restoreFocus,
}: {
  title: string;
  label: string;
  action: string;
  initial: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError(`Give the ${label.toLowerCase()}.`);
          onClose();
          void onSubmit(name.trim());
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} aria-invalid={!!error} />
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
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveDialog({
  title,
  folders,
  current,
  onSubmit,
  onClose,
  restoreFocus,
}: {
  title: string;
  folders: string[];
  current: string;
  onSubmit: (target: string) => Promise<void>;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [target, setTarget] = useState(current);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          void onSubmit(target);
        }}
      >
        <label className="field">
          <span>Move to</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Top level (My files)</option>
            {folders.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Move
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AutoDeleteDialog({
  file,
  onSubmit,
  onClose,
  restoreFocus,
}: {
  file: MyFile;
  onSubmit: (days: number | null) => Promise<void>;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [days, setDays] = useState("");
  const [error, setError] = useState("");
  const n = Number(days);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Auto-delete for ${file.name}`}
      description={file.expiresAt ? `Now: deletes on ${dateTime(file.expiresAt).slice(0, 10)}.` : "Now: never deleted automatically."}
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!Number.isInteger(n) || n < 1 || n > 3650) return setError("Give a whole number of days from 1 to 3650.");
          onClose();
          void onSubmit(n);
        }}
      >
        <label className="field">
          <span>Delete this file after (days from now)</span>
          <input className="num" type="number" min={1} max={3650} step={1} value={days} autoFocus onChange={(e) => setDays(e.target.value)} aria-invalid={!!error} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end wrap">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onClose();
              void onSubmit(null);
            }}
          >
            Never delete this file
          </button>
          <button type="submit" className="btn primary">
            Set the date
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- settings ---------- */

function SettingsPanel({ listing, onSaved, onError }: { listing: MyListing; onSaved: (message: string) => void; onError: (message: string) => void }) {
  const current = listing.settings.autoDeleteDays;
  const [days, setDays] = useState(current === null ? "" : String(current));
  const [error, setError] = useState("");
  const { usedBytes, quotaBytes } = listing.usage;

  useEffect(() => setDays(current === null ? "" : String(current)), [current]);

  const save = async (value: number | null) => {
    try {
      await api.saveMyFilesSettings(value);
      onSaved(value === null ? "Auto-delete is off." : `New files will be deleted ${plural(value, "day")} after they are uploaded.`);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <section className="card stack" aria-labelledby="mf-settings-h">
      <h2 id="mf-settings-h">Settings</h2>
      <p>
        {quotaBytes === null
          ? `Space used: ${formatBytes(usedBytes)} in ${plural(listing.usage.fileCount, "file")} (no quota set, only the single-file limit applies).`
          : `Space used: ${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} in ${plural(listing.usage.fileCount, "file")}.`}
      </p>
      <p>{current === null ? "Auto-delete is off: files stay until you delete them." : `Auto-delete is on: new files are deleted ${plural(current, "day")} after upload.`}</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(days);
          if (!Number.isInteger(n) || n < 1 || n > 3650) return setError("Give a whole number of days from 1 to 3650.");
          setError("");
          void save(n);
        }}
      >
        <div className="row wrap">
          <label className="field compact">
            <span>Delete new files after (days)</span>
            <input className="num" type="number" min={1} max={3650} step={1} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!!error} />
          </label>
          <button type="submit" className="btn primary">
            Save
          </button>
          <button type="button" className="btn" disabled={current === null} onClick={() => void save(null)}>
            Turn auto-delete off
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small muted">This applies to files uploaded from now on. Files already here keep their own date; change a single file with its Auto-delete button.</p>
      </form>
    </section>
  );
}
