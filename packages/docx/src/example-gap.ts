import { p, packExampleDocx, table } from "./example-trd";

/**
 * The example finished gap assessment for "Try the AI reading on an example gap assessment" (job AI3): a FICTIONAL Word document for the
 * same lyophilized antibody as the example TRD and sampling plan (ORV-118, moved from the Riverside Pilot Plant to the Northfield Fill
 * Site), written the way a contract manufacturer writes a gap assessment by hand and NOT in this tool's layout: prose, one clean
 * comparison table, a note line and a second table with other headings. It has no hidden data part, so the site reads it as a document
 * from somewhere else (level 3, fixed rules).
 *
 * What it is for: the fixed rules read the comparison table (Table 1, 7 questions, each answered for the sending and the receiving site).
 * The other gap items sit in sentences and in a table whose headings the rules do not know; the pre-recorded AI reading
 * (content/ai-reading/example-gap-assessment.yaml) quotes those passages, one card per gap item (one question of the catalogue). Every
 * quote there must appear word for word in the text of THIS file (packages/docx/test/ai3-example.test.ts checks it), so change the text
 * here and the recording together.
 *
 * The assessment states what it found and nothing more: it gives no rating where it has none (the shipper "is qualified", without saying
 * which qualification), and one item is already closed. Those two are the traps a careful reviewer rejects.
 *
 * The file is shipped as apps/web/public/examples/example-finished-gap-assessment.docx. It is built the same way every time, and the test
 * compares the shipped file with this generator's output, part by part. To rewrite the shipped file after a change here:
 *   WRITE_EXAMPLE_GAP=1 npx vitest run packages/docx/test/ai3-example.test.ts
 */

export const EXAMPLE_GAP_FILE_NAME = "example-finished-gap-assessment.docx";

/** The paragraphs and tables of the example, in order. */
export function exampleGapBodyXml(): string {
  return [
    p("Gap Assessment: ORV-118 Lyophilized Drug Product (fictional)", "Title"),
    table([
      ["Document number", "ORV-GA-0118"],
      ["Transfer", "Riverside Pilot Plant (fictional) to Northfield Fill Site (fictional)"],
      ["Related documents", "ORV-TRD-0118 and ORV-SP-0118"],
    ]),

    p("1 Purpose", "Heading1"),
    p("This document compares the Riverside Pilot Plant and the Northfield Fill Site for the transfer of the ORV-118 drug product process. It lists where the two sites differ and what is still open."),

    p("2 Product and transfer", "Heading1"),
    p("ORV-118 is a humanized monoclonal antibody supplied as a lyophilized powder in a 10R glass vial."),
    p("This is a site to site transfer from the Riverside Pilot Plant to the Northfield Fill Site. The drug substance is received frozen at Northfield."),
    p("The formulated bulk is made by diluting the drug substance with a buffer at both sites."),
    p("ORV-118 needs no special containment (standard handling)."),
    p("ORV-118 is supplied to the United States and the European Union."),
    p("At both sites the drug substance is received and thawed, then pooled, compounded and diluted, sterile filtered, filled aseptically, freeze-dried and capped."),

    p("3 Site comparison", "Heading1"),
    p("Table 1 Facility and equipment compared"),
    table([
      ["Topic", "Sending site", "Receiving site", "Gap and action"],
      ["Site name", "Riverside Pilot Plant", "Northfield Fill Site", "None"],
      ["Filling line", "Pilot line 1", "Line 2", "Line 2 is larger; see section 6"],
      ["Aseptic barrier technology at the filling line", "Closed RABS", "Isolator", "Barrier differs; media fill covers it"],
      ["Batch record system", "Paper batch record", "Electronic batch record (MES)", "Recipe build at Northfield, action 3"],
      ["Filling pump operating principle", "Rotary piston pump", "Peristaltic pump", "Pump principle differs; see section 6"],
      ["Sterilizing filter membrane material", "Polyethersulfone (PES)", "Polyethersulfone (PES)", "None"],
      ["Maximum filling duration per batch", "4 h", "6 h", "Longer fill at Northfield; media fill covers it"],
    ]),
    p("Note a: Both sites keep their own quality oversight."),

    p("4 Drug substance shipping, thaw and compounding", "Heading1"),
    p("Drug substance is shipped frozen from Riverside to Northfield in a dry-ice shipper. The shipper is qualified."),
    p("Riverside thaws in a circulating water bath; Northfield uses a controlled-rate thaw system (plate or jacketed)."),
    p("After thawing, the drug substance may stay at ambient temperature for no more than 4 h at both sites."),
    p("At Northfield the thawed drug substance may be held at 2-8 °C for up to 72 h before pooling. A freeze-thaw study for the Northfield thaw method is planned but not yet available."),
    p("Riverside mixes the formulated bulk in a stainless-steel tank with a top-entry impeller; Northfield mixes it in a single-use bag with an impeller."),
    p("The formulated bulk is held for up to 24 h at 2-8 °C before filtration at both sites."),
    p("Northfield adds a bioburden-reduction (BBR) filtration of the formulated bulk; Riverside does not."),
    p("At Northfield the bioburden limit before the BBR filter is 10 CFU/100 mL."),

    p("5 Sterile filtration", "Heading1"),
    p("Northfield uses a redundant second sterilizing filter in series; Riverside uses a single filter."),
    p("Riverside does not perform PUPSIT, which is justified by a documented risk assessment; Northfield performs PUPSIT."),

    p("6 Filling, lyophilization and capping", "Heading1"),
    p("The last media fill on Line 2 covered 8 h of filling."),
    p("Table 2 Observations from the walk-through"),
    table([
      ["Area", "What we found"],
      ["PPQ", "Northfield will run a full PPQ at the receiving site with three new batches."],
      ["Lyophilization", "Riverside freezes with uncontrolled nucleation; Northfield uses controlled nucleation by pressure depression."],
      ["Lyophilization", "Verification of the cycle on the Northfield lyophilizer (engineering run) is planned; results are not yet available."],
      ["Capping", "CCI for the Northfield vial, stopper, seal and capping process was planned for Q3 (action 7, closed on 3 November)."],
    ]),

    p("Document status: Approved, version 1.0 (fictional example)", "Note"),
  ].join("");
}

/** The example Word file. Every part's content is the same on every run (fixed file dates, fixed compression). */
export function exampleGapDocx(): Uint8Array {
  return packExampleDocx(exampleGapBodyXml());
}
