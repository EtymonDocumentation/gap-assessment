import { p, packExampleDocx, table } from "./example-trd";

/**
 * The example finished sampling plan for "Try the AI reading on an example sampling plan" (job AI2): a FICTIONAL Word document for the
 * same lyophilized antibody as the example TRD (ORV-118, the Northfield Fill Site), written the way a contract manufacturer writes a
 * PPQ sampling plan by hand and NOT in this tool's layout: prose, one clean table, a note line and a second table laid out oddly.
 * It has no hidden data part, so the site reads it as a document from somewhere else (level 3, fixed rules).
 *
 * What it is for: the fixed rules read the points table (Table 1, 5 points). The other sampling points sit in sentences, a note and
 * a two-column table the rules do not recognise; the pre-recorded AI reading (content/ai-reading/example-sampling-plan.yaml) quotes
 * those passages. Every quote there must appear word for word in the text of THIS file (packages/docx/test/ai2-example.test.ts
 * checks it), so change the text here and the recording together.
 *
 * The plan follows the project's PPQ habits, so the example is a good one to learn from: every sample is taken in each of the three
 * PPQ lots, every hold is sampled at T0 and at the end of the hold, nothing is sampled after the sterile filter (the filtered
 * product is tested on filled units), and a 10 mL bioburden sample is fine against a limit per 100 mL. Two passages are traps a
 * careful reviewer rejects: an extra check on the filtrate (after the sterile filter) and a sample of the engineering run only.
 *
 * The file is shipped as apps/web/public/examples/example-finished-sampling-plan.docx. It is built the same way every time, and the
 * test compares the shipped file with this generator's output, part by part. To rewrite the shipped file after a change here:
 *   WRITE_EXAMPLE_SAMPLING=1 npx vitest run packages/docx/test/ai2-example.test.ts
 */

export const EXAMPLE_SAMPLING_FILE_NAME = "example-finished-sampling-plan.docx";

const D = "°"; // degree sign, written as an escape so the source file stays plain ASCII
const U = "µ"; // micro sign

/** The paragraphs and tables of the example, in order. */
export function exampleSamplingBodyXml(): string {
  return [
    p("PPQ Sampling Plan: ORV-118 Lyophilized Drug Product (fictional)", "Title"),
    table([
      ["Document number", "ORV-SP-0118"],
      ["Receiving site", "Northfield Fill Site (fictional)"],
      ["Related document", "ORV-TRD-0118, Technology Transfer Requirements Document"],
    ]),

    p("1 Purpose", "Heading1"),
    p("This plan lists the samples taken during the process performance qualification (PPQ) of ORV-118 at the Northfield Fill Site. It follows the transfer described in ORV-TRD-0118."),

    p("2 How the lots are sampled", "Heading1"),
    p("Three consecutive PPQ lots are made. Every sample in this plan is taken in each of the three PPQ lots. Every hold is sampled at T0 and at the end of the hold. No sample is taken after the sterile filter; the filtered product is tested on filled vials."),

    p("3 Drug substance", "Heading1"),
    p("After thawing, 3 mL of the thawed drug substance is taken for protein concentration by UV absorbance at 280 nm."),
    p(`The thawed drug substance is held at 2-8 ${D}C for up to 72 h. In each lot, 2 mL is taken for pH by potentiometry at T0 and at the end of the hold. 10 mL is taken for bioburden by membrane filtration at T0 and at the end of the hold.`),

    p("4 Compounding, hold and filtration", "Heading1"),
    p(`The drug substance is pooled and diluted at 20 ${D}C and mixed at 120 rpm for 30 min.`),
    p("Table 1 Samples taken at the process steps"),
    table([
      ["Process step", "Attribute", "Test", "Sample volume", "Timing", "Type"],
      ["Pooling, compounding and dilution", "pH", "Potentiometry", "5 mL", "After mixing", "In-process"],
      ["Pooling, compounding and dilution", "Osmolality", "Freezing point depression", "1 mL", "After mixing", "In-process"],
      ["Sterile filtration", "Bioburden before filtration", "Membrane filtration", "10 mL", "At T0", "In-process"],
      ["Aseptic filling and stoppering", "Subvisible particles", "Light obscuration", "5 mL", "Beginning, middle and end of run", "PPQ"],
      ["Lyophilization", "Residual moisture", "Karl Fischer titration", "0.2 g", "After the cycle", "PPQ"],
    ]),
    p(`Note a: During the engineering run only, 25 mL of the formulated bulk was taken every 15 min during mixing for protein concentration by UV absorbance at 280 nm.`),
    p("When mixing is complete, 3 mL is taken from the top, middle and bottom of the vessel for protein concentration by UV absorbance at 280 nm."),
    p(`The formulated bulk is held at 2-8 ${D}C for up to 24 h before filtration. In each lot, 3 mL of the bulk is taken for protein concentration by UV absorbance at 280 nm at T0 and at the end of the hold.`),
    p("A bioburden sample of 100 mL is drawn from the formulated bulk before the filter, at the end of the hold."),
    p(`The bulk is filtered through a 0.22 ${U}m polyethersulfone (PES) filter into a sterile bag. Filter integrity is tested by bubble point before use and after use.`),
    p("If the receiving site wants an extra check, 20 mL of the filtrate can be taken from the sterile bag for protein concentration by UV absorbance at 280 nm."),

    p("5 Filling, lyophilization and capping", "Heading1"),
    p("During filling, the fill volume is checked on 5 vials every 30 min by weighing."),
    p("Table 2 Further checks (from the site quality unit)"),
    table([
      ["Sample", "How it is taken"],
      ["Filled vials, visible particles", "100 vials are inspected visually at the end of the filling run."],
      ["Lyophilized vials, reconstitution time", "6 vials, one from each shelf position, are reconstituted and timed at the end of the cycle."],
      ["Lyophilized vials, cake appearance", "All vials of one shelf are inspected for cake appearance at the end of the cycle."],
    ]),
    p("After capping, 10 vials are tested for container closure integrity by dye ingress at the end of the capping run. Crimp quality is checked by residual seal force on 20 vials every 60 min."),

    p("6 Finished product", "Heading1"),
    p("Sterility is tested on 20 filled vials per lot by membrane filtration at release. Bacterial endotoxins are tested on 3 vials per lot by kinetic chromogenic assay at release."),
    p("40 vials per lot are kept as retain samples after capping."),

    p("Document status: Approved, version 1.0 (fictional example)", "Note"),
  ].join("");
}

/** The example Word file. Every part's content is the same on every run (fixed file dates, fixed compression). */
export function exampleSamplingDocx(): Uint8Array {
  return packExampleDocx(exampleSamplingBodyXml());
}
