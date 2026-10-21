import { create } from "zustand";
import { download } from "../lib";
import * as api from "./api";
import type { FileMeta } from "./api";
import { ensureSaved } from "./sync";

/** Files attached to the open project's sources (stored on the server as real files). Server mode with server storage only. */

export interface Upload {
  name: string;
  /** 0 to 1 while the bytes are sent; 1 while the server is still checking and saving them. */
  fraction: number;
}

interface FilesState {
  /** Project the list belongs to. */
  projectId: string | null;
  files: FileMeta[];
  state: "idle" | "loading" | "ready" | "error";
  error: string;
  /** Uploads in progress, by slot: a source id, or "project" for a file added to the project itself. */
  uploads: Record<string, Upload>;
  /** The last problem of each slot, in the server's own words. */
  slotErrors: Record<string, string>;
  /** Polite status message ("Attached x"). */
  notice: string;
  load(): Promise<void>;
  upload(file: File, slot: string, sourceId?: string): Promise<void>;
  remove(f: FileMeta): Promise<void>;
  save(f: FileMeta): Promise<void>;
}

const empty = (): Pick<FilesState, "projectId" | "files" | "state" | "error" | "uploads" | "slotErrors" | "notice"> => ({ projectId: null, files: [], state: "idle", error: "", uploads: {}, slotErrors: {}, notice: "" });

export const useFiles = /* @__PURE__ */ create<FilesState>((set, get) => ({
  ...empty(),

  async load() {
    set({ state: "loading", error: "" });
    try {
      const projectId = await ensureSaved();
      const files = await api.listFiles({ projectId });
      set({ projectId, files, state: "ready" });
    } catch (e) {
      set({ state: "error", error: (e as Error).message });
    }
  },

  async upload(file, slot, sourceId) {
    set((s) => ({ uploads: { ...s.uploads, [slot]: { name: file.name, fraction: 0 } }, slotErrors: { ...s.slotErrors, [slot]: "" }, notice: `Uploading ${file.name}…` }));
    try {
      const projectId = await ensureSaved();
      const meta = await api.uploadFile(file, {
        projectId,
        ...(sourceId ? { sourceId } : {}),
        onProgress: (fraction) => set((s) => ({ uploads: { ...s.uploads, [slot]: { name: file.name, fraction } } })),
      });
      set((s) => ({ files: [...s.files, meta], notice: `${meta.fileName} was uploaded.` }));
    } catch (e) {
      set((s) => ({ slotErrors: { ...s.slotErrors, [slot]: `${file.name} was not uploaded. ${(e as Error).message}` }, notice: "" }));
    } finally {
      set((s) => {
        const { [slot]: _done, ...rest } = s.uploads;
        return { uploads: rest };
      });
    }
  },

  async remove(f) {
    await api.deleteFile(f.id);
    set((s) => ({ files: s.files.filter((x) => x.id !== f.id), notice: `${f.fileName} was removed.` }));
  },

  async save(f) {
    try {
      const bytes = await api.downloadFile(f.id);
      download(f.fileName, bytes, "application/octet-stream");
      set({ notice: `${f.fileName} was downloaded.` });
    } catch (e) {
      set((s) => ({ slotErrors: { ...s.slotErrors, [f.id]: `${f.fileName} could not be downloaded. ${(e as Error).message}` } }));
    }
  },
}));

export function resetFiles(): void {
  useFiles.setState(empty());
}


/** "1.4 MB", "820 KB", "12 bytes". */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} ${n === 1 ? "byte" : "bytes"}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;
  return `${(n / 1_000_000_000).toFixed(1)} GB`;
}
