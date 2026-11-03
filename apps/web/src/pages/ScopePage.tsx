import { PageHeader } from "../PageHeader";
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
      <PageHeader
        title="What does this assessment cover?"
        purpose="Untick the process steps your process does not have, and the document sections you do not need, so the interview and the document only cover what matters."
        about={{
          art: "page-interview",
          children: (
            <>
              <p>
                A gap assessment compares how a product is made and tested at the sending unit with the receiving unit, question by question, and lists every difference with its source. Nothing is assumed: an unanswered question stays visible.
              </p>
              <p>Everything is included to start with. You can change these choices at any time: values you already entered are kept, never deleted.</p>
              <p>Next in the chain: the TRD, the sampling plan and the batch record can start from this project. Every stage is optional.</p>
            </>
          ),
        }}
      />
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
