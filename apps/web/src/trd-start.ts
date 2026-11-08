import { trdWriteups } from "@gap/content";
import { createTrd, effectiveWriteupLibrary } from "@gap/engine";
import { navigate } from "./router";
import { useStore } from "./store";
import { useTrdWriteups } from "./trd-writeups-store";

/**
 * "Answer questions": a blank TRD in the open project, opened on its Interview tab, so the next thing on screen is the first question.
 *
 * It used to ask for the TRD's title on a form far down the TRD page, after asking for the project and asking again how the TRD should
 * start (about seven steps before the first question). The title is now made from the project's title, with the full name of the document,
 * and the person can rename the TRD on its Details tab. Nothing is filled in beyond that: every question starts unanswered.
 *
 * The person's own process descriptions are read first (they are only read when something shows them), so an edited one is never replaced by
 * the shipped one. Returns the sentence to show when the TRD could not be made (for example a save conflict), or null once the person has been
 * taken to it.
 */
export async function startTrdByQuestions(): Promise<string | null> {
  if (!useStore.getState().project) return "Open a project first.";
  await useTrdWriteups.getState().load();
  const library = effectiveWriteupLibrary(trdWriteups, useTrdWriteups.getState().items);
  let trdId = "";
  const err = useStore.getState().update((p, actor) => {
    const r = createTrd(p, { title: `${p.meta.title} technical requirements document`, start: { kind: "blank" }, library }, actor);
    trdId = r.trdId;
    return r.project;
  }, "TRD created");
  if (err) return err;
  navigate("/trd", { trd: trdId, tab: "interview" });
  return null;
}
