import { mbrOpenItems } from "@gap/engine";
import type { MbrRecord } from "@gap/process-model";
import { useMemo, type ReactNode } from "react";
import { dateTime } from "../lib";
import { useMbrLibrary } from "../mbr-blocks-store";
import { focusWhenReady, PageHeader, type PageAbout, type PagePill } from "../PageHeader";
import { navigate } from "../router";
import { useStore } from "../store";
import { Tabs, type TabDef } from "../Tabs";
import { mbrPurpose, mbrScopeText } from "./mbr-text";

export type MbrTab = "edit" | "view" | "word";

const TABS: TabDef<MbrTab>[] = [
  {
    id: "edit",
    label: "Edit",
    testId: "mbr-tab-edit",
    purpose: "Write the batch record: details, open items and the sections of ready-made steps.",
    help: "This is where the record itself is written. Add sections and ready-made steps, fill the rows, and clear the open items. Everything you change here shows in the other two tabs. The optional \"Excipients used\" table lists the excipients the excipient assessment links to this record's TRD, as a copy you add yourself.",
  },
  {
    id: "view",
    label: "Process view",
    testId: "mbr-tab-view",
    tour: "mbr-view-tab",
    purpose: "The batch record drawn as an equipment train; follow the fluid step by step.",
    help: "A picture of the record, not a second place to edit. Move a slider through the steps to see where the product is, which clocks are running and which samples are taken. Use it to spot gaps in the record before it goes to review.",
  },
  {
    id: "word",
    label: "Document",
    testId: "mbr-tab-word",
    purpose: "Download the batch record as a Word or HTML draft, with a preview.",
    help: "Makes the draft document from the record as it stands. Open items and \"to be completed\" placeholders stay in the draft; you are shown the count before a download. Each download is written to the export history.",
  },
];

/**
 * One batch record with real tabs: Edit, Process view, Document. The tabs are routes (the Process view is still /mbr/view,
 * Word is /mbr?tab=word), so every existing link keeps working, a tab is a link a person can share, and the browser Back button
 * walks back through the tabs they visited. Arrow keys only move focus here; Enter or Space opens the tab, so a run of arrow
 * presses does not push a run of history entries.
 */
export function MbrFrame({ rec, tab, children }: { rec: MbrRecord; tab: MbrTab; children: ReactNode }) {
  const project = useStore((s) => s.project)!;
  const library = useMbrLibrary();
  const open = useMemo(() => mbrOpenItems(project, rec, library).length, [project, rec, library]);
  const go = (t: MbrTab) => {
    if (t === "view") navigate("/mbr/view", { mbr: rec.id });
    else if (t === "word") navigate("/mbr", { mbr: rec.id, tab: "word" });
    else navigate("/mbr", { mbr: rec.id });
  };
  // Facts the page already knows (the same counts the batch record list shows).
  const pills: PagePill[] = [
    { label: `${rec.sections.length} ${rec.sections.length === 1 ? "section" : "sections"}`, testId: "mbr-pill-sections" },
    { label: `${open} open ${open === 1 ? "item" : "items"}`, warning: open > 0, testId: "mbr-pill-open" },
  ];
  const started = [rec.trdId ? `TRD ${rec.trdId}` : "", rec.planId ? `plan ${rec.planId}` : ""].filter(Boolean).join(" and ");
  // The downloads are in the Document tab (the part choice, the Word kind and the pre-download check are there); the menu opens that
  // tab and puts focus on the matching button.
  const toDownload = (testId: string) => () => {
    go("word");
    focusWhenReady(testId);
  };
  // The Process view has its own "What this shows" card, open on a wide screen; a second explanation there would only repeat it.
  const about: { about?: PageAbout } =
    tab === "view"
      ? {}
      : {
          about: {
            art: "page-document",
            children: (
              <>
                <p>
                  A batch record is the step-by-step instruction for making one batch. It is built from ready-made steps, and it can start from a technical requirements document (the parameter values) and a sampling plan (the sample rows), or from neither.
                </p>
                <p>Next in the chain: the Process view draws the record as an equipment train, and the Document tab produces the draft for review.</p>
                <p data-testid="mbr-scope-text">{mbrScopeText}</p>
              </>
            ),
          },
        };
  return (
    <div className="stack-lg">
      <PageHeader
        title={`${rec.id}: ${rec.title}`}
        crumb={rec.id}
        purpose={mbrPurpose}
        pills={pills}
        meta={`${started ? `Started from ${started}` : "Started blank"} · Last changed ${dateTime(rec.updatedAt)}`}
        {...about}
        exports={[
          { label: "Download batch record (Word)", onSelect: toDownload("mbr-download-word") },
          { label: "Download batch record (HTML)", onSelect: toDownload("mbr-download-html") },
        ]}
      />
      <Tabs label="Batch record views" tabs={TABS} selected={tab} onSelect={go} activation="manual" testId="mbr-tabs" tour="mbr-tabs">
        {children}
      </Tabs>
    </div>
  );
}
