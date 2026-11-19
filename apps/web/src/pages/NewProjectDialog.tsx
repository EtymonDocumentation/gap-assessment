import { useState, type ReactNode } from "react";
import { Modal, ResponderForm } from "../components";
import { useStore } from "../store";
import { navigate } from "../router";
import { SERVER_MODE } from "../server/mode";

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
export function useProjectFirst(description: string): { proceed: (next: () => void, example?: boolean) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [example, setExample] = useState(false);
  // An example file is recorded in advance and no file of the person's is read, so the dialog says it makes a practice project.
  const proceed = (next: () => void, isExample = false) => {
    if (useStore.getState().project) next();
    else {
      setExample(isExample);
      setPending(() => next);
    }
  };
  const text = example ? "This is a practice example: it was recorded in advance and no file of yours is read. Name a practice project for this example and the person answering. You can delete the practice project afterwards." : description;
  const dialog = pending ? <NewProjectDialog open onOpenChange={(o) => !o && setPending(null)} description={text} onCreated={pending} /> : null;
  return { proceed, dialog };
}

/**
 * On the result page of an AI example: the example made a real (practice) project, so it can be removed again from here. Where projects live on
 * the server the person deletes it from the project list instead (a server project is removed only with its own confirmation).
 */
export function PracticeProjectDelete() {
  const [gone, setGone] = useState(false);
  if (SERVER_MODE) return <p className="muted small">This is a practice project. Delete it from the list of your projects on Home when you are done.</p>;
  if (gone) return null;
  return (
    <p>
      <button
        type="button"
        className="btn small"
        data-testid="delete-practice-project"
        onClick={() => {
          if (!window.confirm("Delete this practice project? It is removed from this browser and cannot be brought back.")) return;
          useStore.getState().setProject(null, "Practice project deleted");
          setGone(true);
          navigate("/");
        }}
      >
        Delete this practice project
      </button>
    </p>
  );
}
