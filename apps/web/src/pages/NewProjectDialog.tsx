import { useState, type ReactNode } from "react";
import { Modal, ResponderForm } from "../components";
import { useStore } from "../store";

/**
 * The one "New project" dialog: the project title, who is answering, and a Cancel. Every start that has no project yet uses it (Home, the
 * "this page needs an open project" box, and an upload read before any project existed), so the words, the Cancel and the single error
 * line are the same wherever a person meets it.
 *
 * `onCreated` runs once the project exists. The caller decides where the person lands (the Scope step, a document page, a review page).
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  description = "Name the project and the person answering.",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  description?: string;
  onCreated: () => void;
}) {
  const newProject = useStore((s) => s.newProject);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New project" description={description}>
      <ResponderForm
        withTitle
        submitLabel="Create project"
        onCancel={() => onOpenChange(false)}
        onSubmit={async (v) => {
          // Refused while the open project's save has failed or has a conflict: the reason shows in the form, which stays as typed.
          const refused = await newProject(v.title!, { name: v.name, ...(v.role ? { role: v.role } : {}) });
          if (refused) return refused;
          onOpenChange(false);
          onCreated();
        }}
      />
    </Modal>
  );
}

/**
 * For a button that reads a file first and only then needs a project. With a project open `proceed` just runs what it is given; with none it
 * opens the New project dialog and runs it once the project exists. The file stays held while the dialog is open, so Cancel loses nothing.
 */
export function useProjectFirst(description: string): { proceed: (next: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const proceed = (next: () => void) => {
    if (useStore.getState().project) next();
    else setPending(() => next);
  };
  const dialog = pending ? <NewProjectDialog open onOpenChange={(o) => !o && setPending(null)} description={description} onCreated={pending} /> : null;
  return { proceed, dialog };
}
