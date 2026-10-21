import { PageBanner } from "../art";
import { href } from "../router";
import { DocumentSectionsBlock, ProcessStepsBlock, useScopeSummary } from "./ScopeEditor";

/**
 * The Scope step: choose what the assessment covers BEFORE the interview, so nobody answers questions about steps the process
 * does not have. The same choices are shown at the top of the Document page; both read one stored choice.
 */
export function ScopePage() {
  const summary = useScopeSummary();
  return (
    <div className="stack-lg">
      <PageBanner art="page-interview">
        <h1>What does this assessment cover?</h1>
      </PageBanner>
      <p className="lede">
        Everything is included to start with. Untick the process steps your process does not have, and the document sections you do not need, so the interview and the document only
        cover what matters. You can change these choices at any time: values you already entered are kept, never deleted.
      </p>
      <p className="scope-summary" role="status" data-testid="scope-summary">
        <strong>{summary.text}</strong>
      </p>
      <section className="card stack" aria-labelledby="scope-steps-h">
        <h2 id="scope-steps-h">Process steps</h2>
        <ProcessStepsBlock idPrefix="scope" />
      </section>
      <section className="card stack" aria-labelledby="scope-sections-h">
        <h2 id="scope-sections-h">Document sections</h2>
        <DocumentSectionsBlock idPrefix="scope" />
      </section>
      <div className="row wrap">
        <a className="btn primary" href={href("/interview")}>
          Continue to the interview
        </a>
      </div>
    </div>
  );
}
