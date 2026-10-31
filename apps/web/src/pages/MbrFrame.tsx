import type { MbrRecord } from "@gap/process-model";
import type { ReactNode } from "react";
import { PageBanner } from "../art";
import { href, navigate } from "../router";
import { Tabs, type TabDef } from "../Tabs";
import { WhatThisIs } from "../WhatThisIs";

export type MbrTab = "edit" | "view" | "word";

const TABS: TabDef<MbrTab>[] = [
  {
    id: "edit",
    label: "Edit",
    testId: "mbr-tab-edit",
    purpose: "Write the batch record: details, open items and the sections of step blocks.",
    help: "This is where the record itself is written. Add sections and step blocks, fill the rows, and clear the open items. Everything you change here shows in the other two tabs.",
  },
  {
    id: "view",
    label: "Process view",
    testId: "mbr-tab-view",
    purpose: "The batch record drawn as an equipment train; follow the fluid step by step.",
    help: "A picture of the record, not a second place to edit. Move a slider through the steps to see where the product is, which clocks are running and which samples are taken. Use it to spot gaps in the record before it goes to review.",
  },
  {
    id: "word",
    label: "Word document",
    testId: "mbr-tab-word",
    purpose: "Download the batch record as a Word or HTML draft, with a preview.",
    help: "Makes the draft document from the record as it stands. Open items and \"to be completed\" placeholders stay in the draft; you are shown the count before a download. Each download is written to the export history.",
  },
];

/**
 * One batch record with real tabs: Edit, Process view, Word document. The tabs are routes (the Process view is still /mbr/view,
 * Word is /mbr?tab=word), so every existing link keeps working, a tab is a link a person can share, and the browser Back button
 * walks back through the tabs they visited. Arrow keys only move focus here; Enter or Space opens the tab, so a run of arrow
 * presses does not push a run of history entries.
 */
export function MbrFrame({ rec, tab, children }: { rec: MbrRecord; tab: MbrTab; children: ReactNode }) {
  const go = (t: MbrTab) => {
    if (t === "view") navigate("/mbr/view", { mbr: rec.id });
    else if (t === "word") navigate("/mbr", { mbr: rec.id, tab: "word" });
    else navigate("/mbr", { mbr: rec.id });
  };
  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>
          {rec.id}: {rec.title}
        </h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/mbr")} data-testid="pv-back">
          All batch records
        </a>
      </p>
      {/* The Process view has its own "What this shows" card; a second card there would push its slider off the first phone screen. */}
      {tab !== "view" && (
      <WhatThisIs id="mbr">
        <p>
          A master batch record is the step-by-step instruction for making one batch. It is built from step blocks, and it can start from a TRD record (the parameter values) and a sampling plan (the sample rows), or from neither.
        </p>
        <p>Next in the chain: the Process view draws the record as an equipment train, and the Word document tab produces the draft for review.</p>
      </WhatThisIs>
      )}
      <Tabs label="Batch record views" tabs={TABS} selected={tab} onSelect={go} activation="manual" testId="mbr-tabs">
        {children}
      </Tabs>
    </div>
  );
}
