import { useEffect, useState } from "react";

export type DocxModule = typeof import("@gap/docx");

let loading: Promise<DocxModule> | undefined;

/**
 * Loads the Word package on first use. It is a separate download (the Word writer, the template reader and the
 * PDF reader), so pages that never touch Word do not pay for it.
 */
export function loadDocx(): Promise<DocxModule> {
  loading ??= import("@gap/docx");
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

/** The Word package once it has loaded (null until then). Pass `enabled = false` to postpone loading. */
export function useDocx(enabled = true): { docx: DocxModule | null; error: string | null } {
  const [docx, setDocx] = useState<DocxModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || docx) return;
    let live = true;
    loadDocx().then(
      (m) => live && setDocx(m),
      (e: Error) => live && setError(`The Word tools could not be loaded: ${e.message}. Check your connection and reload the page.`),
    );
    return () => {
      live = false;
    };
  }, [enabled, docx]);
  return { docx, error };
}
