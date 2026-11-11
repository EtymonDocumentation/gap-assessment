import { trdWriteups } from "@gap/content";
import { createTrd, effectiveWriteupLibrary, setTrdTemplateChoice, type TrdTemplatePick } from "@gap/engine";
import { navigate } from "./router";
import { useStore } from "./store";
import { useTrdWriteups } from "./trd-writeups-store";

/**
 * "Start a TRD". A new TRD goes through the start path of three steps on the TRD page: step 1 picks the Word template, step 2 says which process
 * steps are in the project, step 3 is the interview. With "A template's headings" there are four: the match of those headings comes
 * between the process steps and the interview. Home, the TRD page and the "Start the TRD" links all use it, so a first-time reader is
 * always taken through the same steps in the same order.
 *
 * A project that already has a TRD does not start another one by accident: with one TRD the person is taken straight to where it was (its interview),
 * with several to the list. `startNew` is for the button that is plainly "make another one".
 */
export function openTrdStart(opts: { startNew?: boolean } = {}): void {
  const docs = useStore.getState().project?.trd.documents ?? [];
  if (!opts.startNew && docs.length === 1) return navigate("/trd", { trd: docs[0]!.id, tab: "interview" });
  if (!opts.startNew && docs.length > 1) return navigate("/trd");
  navigate("/trd", { step: "1" });
}

/**
 * Makes the blank TRD at step 1 of the start path, with the Word template choice the person made (also "Decide later"). The TRD is named from the
 * project's title, with the full name of the document; it can be renamed on its Details tab. Nothing else is filled in: every question starts open.
 * The person's own process descriptions are read first, so an edited one is never replaced by the shipped one.
 * Returns the new TRD's id, or the sentence to show when it could not be made (for example a save conflict).
 */
export async function createTrdForStartPath(pick: TrdTemplatePick): Promise<{ trdId: string } | { error: string }> {
  if (!useStore.getState().project) return { error: "Open a project first." };
  await useTrdWriteups.getState().load();
  const library = effectiveWriteupLibrary(trdWriteups, useTrdWriteups.getState().items);
  let trdId = "";
  const err = useStore.getState().update((p, actor) => {
    const r = createTrd(p, { title: `${p.meta.title} technical requirements document`, start: { kind: "blank" }, library }, actor);
    trdId = r.trdId;
    return setTrdTemplateChoice(r.project, r.trdId, pick, actor);
  }, "TRD created");
  return err ? { error: err } : { trdId };
}