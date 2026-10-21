// Milestone 5.2: SU/RU wording, the lean gap table with the Gap details appendix, per-gap notes, documents-first
// sources and the optional document sections. All names and data are fictional.
import {
  addComment,
  assess,
  buildDemoProject,
  buildDocument,
  changeLogView,
  CSV_COLUMNS,
  displaySideTags,
  displaySourceNames,
  displaySources,
  filterSourceRows,
  idWithTitle,
  documentFingerprint,
  DOCUMENT_SECTION_IDS,
  gapsToCsv,
  omittedSectionIds,
  OPTIONAL_SECTIONS,
  recordExport,
  ReviewError,
  setGapOverlay,
  setOmittedSections,
  sourceLabel,
  sourceRegisterRows,
  sourceShort,
  STAGE_QUESTION_ID,
  type DocModel,
} from "@gap/engine";
import { parseProject, type Actor, type Project, type Source } from "@gap/process-model";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

const GENERATED = "2026-10-02T00:00:00.000Z";
const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-04T09:00:00.000Z" };
const PUMP_KEY = "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple";
const BATCH_KEY = "R-BATCH-SIZE:uo.compounding.param.batch_size";
const PUPSIT_KEY = "R-PUPSIT:uo.sterile_filtration.ipc.pupsit.status";
const PROCEDURES_KEY = "R-PROCEDURES:uo.compounding.doc.procedures.status";

const demo = buildDemoProject(content, demos["arx-217"]);

function withStage(source: "commercial" | "clinical"): Project {
  const raw = demos["arx-217"] as { answers: { q: string; side: string; value?: unknown }[] };
  const answers = raw.answers.map((x) => (x.q === STAGE_QUESTION_ID && x.side === "source" ? { ...x, value: source } : x));
  return buildDemoProject(content, { ...raw, answers });
}

const docOf = (p: Project): DocModel => buildDocument(content, p, assess(content, p), GENERATED);
const section = (d: DocModel, id: string) => d.sections.find((s) => s.id === id)!;
const tableOf = (d: DocModel, id: string) => {
  const t = section(d, id).blocks.find((b) => b.type === "table");
  if (!t || t.type !== "table") throw new Error(`no table in ${id}`);
  return t;
};

describe("SU and RU wording", () => {
  for (const stage of ["commercial", "clinical"] as const) {
    describe(`${stage} SU`, () => {
      const p = withStage(stage);
      const a = assess(content, p);
      const d = docOf(p);
      const md = renderMarkdown(d);

      it("uses the full form in headings and prompts and SU or RU in compact places", () => {
        expect(md).toContain("(sending unit, SU)");
        expect(md).toContain("(receiving unit, RU)");
        expect(md).toContain("Sending unit program summary");
        expect(md).toContain("Receiving unit summary (planned state)");
        expect(md).toContain("| ID | Attribute | SU | RU | Gap | Severity | Actions | Notes |");
        expect(md).toContain("- **SU program stage:**");
        expect(md).toContain("- **RU program stage:**");
      });

      it("names the range categories by the SU stage", () => {
        const word = stage === "commercial" ? "validated" : "SU";
        expect(md).toContain(`Within ${word} range.`);
        expect(md).toContain(`Outside ${word} range.`);
        const other = stage === "commercial" ? "SU" : "validated";
        expect(md).not.toContain(`Within ${other} range.`);
      });

      it("words the compare details with SU and RU", () => {
        const details = a.gaps.map((g) => g.detail).join("\n");
        expect(details).toMatch(/\bSU PAR\b/);
        expect(details).toMatch(/outside the SU\b|exceeds the SU\b|beyond the SU\b/);
        expect(details).not.toMatch(/\b(the source|the target|Source PAR|Target)\b/);
      });

      it("leaves no user-facing 'source' or 'target' meaning a site in the document or the CSV", () => {
        const csv = gapsToCsv(content, a.gaps, p);
        const header = csv.split("\r\n")[0]!;
        expect(header).toContain('"SU value","RU value"');
        expect(header).toContain('"SU verification","RU verification"');
        expect(header).not.toMatch(/Source|Target/);
        // The evidence meaning of "source" stays: the Source register, and the Source column of the summary tables.
        expect(md).toContain("Source register");
        expect(md).not.toMatch(/\b[Tt]arget (summary|site|process|stage)\b/);
        expect(md).not.toMatch(/\bSource (program|summary|stage|site)\b/);
      });
    });
  }

  it("keeps stored keys, paths and category keys unchanged", () => {
    const keys = new Set(assess(content, demo).gaps.map((g) => g.category));
    expect(keys.has("within_validated_range")).toBe(true);
    expect(demo.processes.source.site.fields["name"]).toBeDefined();
    expect(JSON.stringify(demo)).not.toMatch(/"(SU|RU)"\s*:/);
    expect(gapsToCsv(content, assess(content, demo).gaps, demo)).not.toMatch(/within_validated_range/);
  });
});

describe("the main gap table and the Gap details appendix", () => {
  const d = docOf(demo);
  const a = assess(content, demo);
  const diffs = a.gaps.filter((g) => g.category !== "equivalent");

  it("has exactly the agreed columns", () => {
    expect(tableOf(d, "gap-table").columns).toEqual(["ID", "Attribute", "SU", "RU", "Gap", "Severity", "Actions", "Notes"]);
    expect(tableOf(d, "gap-details").columns).toEqual(["ID", "Rule", "Owner", "Status", "Regulatory", "SU verification", "RU verification"]);
  });

  it("puts Gap details before the Source register as Appendix A, and every row has one line", () => {
    const apps = d.sections.filter((s) => s.appendix);
    expect(apps.map((s) => [s.number, s.id])).toEqual([
      ["A", "gap-details"],
      ["B", "source-register"],
      ["C", "change-log-summary"],
      ["D", "revision-history"],
      ["E", "reviewer-comments"],
    ]);
    expect(tableOf(d, "gap-details").rows).toHaveLength(diffs.length);
    expect(tableOf(d, "gap-table").rows).toHaveLength(diffs.length);
    for (const r of tableOf(d, "gap-table").rows) expect(r).toHaveLength(8);
    for (const r of tableOf(d, "gap-details").rows) expect(r).toHaveLength(7);
  });

  it("joins the section and the attribute, the category, the detail and why it matters", () => {
    const g = diffs.find((x) => x.key === BATCH_KEY)!;
    const row = tableOf(d, "gap-table").rows.find((r) => r[0] === g.displayId)!;
    expect(row[1]).toBe("Pooling, compounding and dilution — Batch size");
    expect(row[2]).toBe(g.sourceDisplay);
    expect(row[3]).toBe(g.targetDisplay);
    expect(row[4]).toContain(`${g.detail} Why it matters: ${g.rationale}`);
    expect(row[4]!.startsWith("Scale change. ")).toBe(true);
  });

  it("puts the regulatory wording last in Actions, and only there", () => {
    const g = diffs.find((x) => x.key === PUMP_KEY)!;
    expect(g.regulatoryNote).toBe("Requires regulatory affairs assessment.");
    const row = tableOf(d, "gap-table").rows.find((r) => r[0] === g.displayId)!;
    expect(row[6]!.endsWith("; Requires regulatory affairs assessment.")).toBe(true);
    // The sentence is joined to the action list with "; " in every flagged row (never run on to the last action).
    for (const f of diffs.filter((x) => x.regulatoryNote)) {
      const cell = tableOf(d, "gap-table").rows.find((r) => r[0] === f.displayId)![6]!;
      expect(cell, f.displayId).toMatch(f.activities.length ? /\S; Requires regulatory affairs assessment\.$/ : /^Requires regulatory affairs assessment\.$/);
    }
    // Markdown and HTML show the same cell text.
    expect(renderMarkdown(d)).toContain("; Requires regulatory affairs assessment.");
    expect(renderHtml(d)).toContain("; Requires regulatory affairs assessment.");
    expect(row[6]!.startsWith("Process performance qualification")).toBe(false); // the activities come first, in the rule's order
    const plain = diffs.find((x) => !x.regulatoryNote && x.activities.length)!;
    const plainRow = tableOf(d, "gap-table").rows.find((r) => r[0] === plain.displayId)!;
    expect(plainRow[6]).not.toContain("regulatory");
    for (const r of tableOf(d, "gap-table").rows) {
      expect(r.slice(0, 6).concat(r.slice(7)).join(" ")).not.toMatch(/Requires regulatory affairs assessment/);
    }
    expect(tableOf(d, "gap-details").rows.find((r) => r[0] === g.displayId)![4]).toBe("Requires regulatory affairs assessment.");
  });

  it("uses a dash for an empty Notes cell and never an empty cell", () => {
    for (const r of tableOf(d, "gap-table").rows) for (const c of r) expect(c.trim(), r[0]).not.toBe("");
    for (const r of tableOf(d, "gap-details").rows) for (const c of r) expect(c.trim(), r[0]).not.toBe("");
  });

  it("renders both tables in Markdown and HTML", () => {
    const md = renderMarkdown(d);
    const html = renderHtml(d);
    expect(md).toContain("## Appendix A. Gap details");
    expect(md).toContain("| ID | Rule | Owner | Status | Regulatory | SU verification | RU verification |");
    expect(html).toContain('<section id="doc-gap-details">');
    expect(html).toContain('<th scope="col">RU verification</th>');
  });

  it("allows a comment on the Gap details appendix", () => {
    expect(DOCUMENT_SECTION_IDS).toContain("gap-details");
    const p = addComment(demo, { sectionId: "gap-details", text: "Check the rule versions." }, { name: "B. Checker (fictional)", at: "2026-10-05T09:00:00.000Z" });
    expect(docOf(p).comments.at(-1)!.anchorText).toBe("Appendix A. Gap details");
  });
});

describe("per-gap notes", () => {
  const gapOf = (p: Project, key: string) => assess(content, p).gaps.find((g) => g.key === key)!;

  it("the demo carries notes on three gaps", () => {
    const withNotes = assess(content, demo).gaps.filter((g) => g.notes);
    expect(withNotes.map((g) => g.key).sort()).toEqual([BATCH_KEY, PUMP_KEY, PUPSIT_KEY].sort());
    for (const g of withNotes) expect(g.notes).toMatch(/\(fictional\)/);
  });

  it("show in the document Notes column, the CSV and the appendix-free table, and not in other rows", () => {
    const d = docOf(demo);
    const a = assess(content, demo);
    const g = gapOf(demo, BATCH_KEY);
    const rows = tableOf(d, "gap-table").rows;
    expect(rows.find((r) => r[0] === g.displayId)![7]).toBe(g.notes);
    expect(rows.filter((r) => r[7] !== "—")).toHaveLength(3);
    const csv = gapsToCsv(content, a.gaps, demo).split("\r\n");
    const col = (CSV_COLUMNS as readonly string[]).indexOf("Notes");
    expect(col).toBeGreaterThan(0);
    expect(csv[0]).toContain('"Notes"');
    expect(csv.find((l) => l.startsWith(`"${g.displayId}"`))).toContain(g.notes!.replace(/"/g, '""'));
  });

  it("are saved on the overlay, trimmed, change-logged, and can be cleared", () => {
    const g = gapOf(demo, PROCEDURES_KEY);
    expect(g.notes).toBeUndefined();
    const p1 = setGapOverlay(demo, PROCEDURES_KEY, { notes: "  Procedure owner to confirm (fictional).  " }, ACTOR);
    expect(gapOf(p1, PROCEDURES_KEY).notes).toBe("Procedure owner to confirm (fictional).");
    const last = changeLogView(content, p1)[0]!;
    expect(last.actionLabel).toBe("Gap updated");
    expect(last.before).toBe("Notes: —");
    expect(last.after).toBe("Notes: Procedure owner to confirm (fictional).");
    const p2 = setGapOverlay(p1, PROCEDURES_KEY, { notes: "   " }, ACTOR);
    expect(gapOf(p2, PROCEDURES_KEY).notes).toBeUndefined();
    expect(changeLogView(content, p2)[0]!.after).toBe("Notes: —");
  });

  it("change the document fingerprint", () => {
    const base = documentFingerprint(docOf(demo));
    const p = setGapOverlay(demo, PROCEDURES_KEY, { notes: "A new note (fictional)." }, ACTOR);
    expect(documentFingerprint(docOf(p))).not.toBe(base);
    const changed = setGapOverlay(p, PROCEDURES_KEY, { notes: "A different note (fictional)." }, ACTOR);
    expect(documentFingerprint(docOf(changed))).not.toBe(documentFingerprint(docOf(p)));
  });

  it("survive a save and load", () => {
    const p = setGapOverlay(demo, PROCEDURES_KEY, { notes: "Round trip (fictional)." }, ACTOR);
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(gapOf(back, PROCEDURES_KEY).notes).toBe("Round trip (fictional).");
  });
});

describe("sources: documents first", () => {
  const doc: Source = { id: "s-doc", type: "document_reference", label: "x", date: "2026-10-01T00:00:00.000Z", docRef: { identifier: "DEMO-PPQ-217-01", docType: "PPQ report", title: "PPQ report (fictional)" } };
  const doc2: Source = { id: "s-doc2", type: "document_reference", label: "y", date: "2026-10-01T00:00:00.000Z", docRef: { identifier: "DEMO-SOP-1", docType: "SOP" } };
  const iv: Source = { id: "s-iv", type: "interview_answer", label: "z", date: "2026-10-01T09:00:00.000Z", responder: { name: "Alex Example (fictional)" } };

  it("shows only the documents when a document backs the value", () => {
    expect(displaySources([iv, doc]).map((s) => s.id)).toEqual(["s-doc"]);
    expect(displaySourceNames([iv, doc, doc2])).toEqual(["DEMO-PPQ-217-01 — PPQ report (fictional)", "DEMO-SOP-1"]);
  });

  it("shows the interview when no document backs the value", () => {
    expect(displaySourceNames([iv])).toEqual(["Interview (Alex Example (fictional), 2026-10-01)"]);
    expect(displaySourceNames([])).toEqual([]);
  });

  it("applies in the summary tables: a document and an interview never appear together", () => {
    const d = docOf(demo);
    const rows = [...section(d, "source-summary").blocks, ...section(d, "target-summary").blocks, ...section(d, "scope").blocks]
      .flatMap((b) => (b.type === "table" ? b.rows : []));
    const sourceCell = (r: string[]) => r[2]!;
    expect(rows.some((r) => sourceCell(r).includes("DEMO-PPQ-217-01 — ARX-217 PPQ summary report (fictional)"))).toBe(true);
    expect(rows.some((r) => sourceCell(r).includes("DEMO-PPQ-217-01 ("))).toBe(false);
    expect(rows.some((r) => sourceCell(r).startsWith("Interview ("))).toBe(true);
    for (const r of rows) {
      if (/DEMO-[A-Z]+-/.test(sourceCell(r))) expect(sourceCell(r), r[0]).not.toContain("Interview (");
    }
  });

  it("keeps every source in the Source register appendix", () => {
    const d = docOf(demo);
    const reg = tableOf(d, "source-register").rows.map((r) => r[1]);
    expect(reg).toContain("Interview answer");
    expect(reg).toContain("Document reference");
  });
});

describe("optional document sections", () => {
  const OMIT = ["risk", "approval"];
  const omitted = setOmittedSections(demo, OMIT);
  const full = docOf(demo);
  const d = docOf(omitted);

  it("lists the optional sections and keeps the mandatory ones out of the list", () => {
    expect(OPTIONAL_SECTIONS.map((s) => s.id)).toEqual([
      "differences",
      "validation-plan",
      "equipment-qualification",
      "risk",
      "verification-status",
      "references",
      "approval",
      "gap-details",
      "source-register",
      "change-log-summary",
      "revision-history",
      "reviewer-comments",
    ]);
    for (const id of ["purpose", "scope", "source-summary", "target-summary", "gap-table", "open-items"]) {
      expect(OPTIONAL_SECTIONS.map((s) => s.id)).not.toContain(id);
      expect(() => setOmittedSections(demo, [id])).toThrow(ReviewError);
    }
    expect(() => setOmittedSections(demo, ["nonsense"])).toThrow(/cannot be left out/);
  });

  it("includes everything by default", () => {
    expect(omittedSectionIds(demo)).toEqual([]);
    expect(demo.document.omittedSections).toBeUndefined();
    expect(full.meta.find(([k]) => k === "Sections omitted")?.[1]).toBe("None");
    expect(full.sections).toHaveLength(18);
  });

  it("removes the sections and closes up the numbering and the appendix letters", () => {
    expect(d.sections.map((s) => s.id)).not.toContain("risk");
    expect(d.sections.map((s) => s.id)).not.toContain("approval");
    expect(d.sections.filter((s) => !s.appendix).map((s) => s.number)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(d.sections.filter((s) => !s.appendix).map((s) => s.id)).toEqual([
      "purpose",
      "scope",
      "source-summary",
      "target-summary",
      "differences",
      "gap-table",
      "validation-plan",
      "equipment-qualification",
      "open-items",
      "verification-status",
      "references",
    ]);
    const omitAppendix = docOf(setOmittedSections(demo, ["gap-details", "revision-history"]));
    expect(omitAppendix.sections.filter((s) => s.appendix).map((s) => [s.number, s.id])).toEqual([
      ["A", "source-register"],
      ["B", "change-log-summary"],
      ["C", "reviewer-comments"],
    ]);
  });

  it("adds a 'Sections omitted' meta line with the titles, in document order", () => {
    expect(d.meta.find(([k]) => k === "Sections omitted")?.[1]).toBe("Risk ranking; Approval");
    expect(renderMarkdown(d)).toContain("- **Sections omitted:** Risk ranking; Approval");
    expect(renderHtml(d)).toContain("Sections omitted");
    expect(renderMarkdown(d)).not.toContain("Risk ranking\n\n");
  });

  it("stores the choice once, in document order, and clears it with an empty list", () => {
    expect(setOmittedSections(demo, ["approval", "risk", "risk"]).document.omittedSections).toEqual(["risk", "approval"]);
    expect(setOmittedSections(omitted, []).document.omittedSections).toBeUndefined();
    expect(demo.document.omittedSections).toBeUndefined(); // the input is not changed
    expect(parseProject(JSON.parse(JSON.stringify(omitted))).document.omittedSections).toEqual(["risk", "approval"]);
  });

  it("changes the fingerprint, since the document is not the same document", () => {
    expect(documentFingerprint(d)).not.toBe(documentFingerprint(full));
    expect(documentFingerprint(docOf(setOmittedSections(omitted, [])))).toBe(documentFingerprint(full));
  });

  it("records the omitted sections in each export record", () => {
    const rec = { at: GENERATED, by: ACTOR.name, format: "markdown" as const, template: { mode: "builtin" as const, name: "Built-in default", version: "1.0.0" }, fingerprint: documentFingerprint(d), changedSinceRevision: false };
    const p = recordExport(recordExport(omitted, rec), { ...rec, format: "html" });
    expect(p.document.exports.map((e) => e.omittedSections)).toEqual([OMIT, OMIT]);
    expect(recordExport(demo, rec).document.exports[0]!.omittedSections).toBeUndefined();
    expect(parseProject(JSON.parse(JSON.stringify(p))).document.exports[1]!.omittedSections).toEqual(OMIT);
  });

  it("keeps comments anchored to an omitted section, with their anchor text", () => {
    let p = addComment(omitted, { sectionId: "risk", text: "Ranking looks high (fictional)." }, { name: "B. Checker (fictional)", at: "2026-10-05T09:00:00.000Z" });
    p = addComment(p, { sectionId: "gap-table", gapKey: PUMP_KEY, text: "Regulatory check." }, { name: "B. Checker (fictional)", at: "2026-10-05T10:00:00.000Z" });
    const doc = docOf(p);
    const mine = doc.comments.find((c) => c.text === "Ranking looks high (fictional).")!;
    expect(mine).toMatchObject({ sectionId: "risk", anchorText: "Risk ranking (section omitted from this export)" });
    const row = tableOf(doc, "reviewer-comments").rows.find((r) => r[2] === "Ranking looks high (fictional).")!;
    expect(row[1]).toBe("Risk ranking (section omitted from this export)");
    expect(doc.comments.find((c) => c.text === "Regulatory check.")!.anchorText).toMatch(/^6\. Detailed gap table, G-\d+$/);
    expect(doc.comments).toHaveLength(demo.document.comments.length + 2);
  });

  it("keeps comments when the Reviewer comments appendix itself is omitted", () => {
    const p = addComment(setOmittedSections(demo, ["reviewer-comments"]), { sectionId: "scope", text: "Scope?" }, { name: "B. Checker (fictional)", at: "2026-10-05T09:00:00.000Z" });
    const doc = docOf(p);
    expect(doc.sections.map((s) => s.id)).not.toContain("reviewer-comments");
    expect(doc.comments).toHaveLength(demo.document.comments.length + 1);
    expect(doc.comments.find((c) => c.text === "Scope?")!.anchorText).toBe("2. Scope");
  });

  it("renders the Markdown and HTML without the omitted sections", () => {
    const md = renderMarkdown(d);
    const html = renderHtml(d);
    expect(md).not.toMatch(/^## \d+\. Risk ranking$/m);
    expect(md).not.toMatch(/^## \d+\. Approval$/m);
    expect(html).not.toContain('<section id="doc-risk">');
    expect(html).not.toContain('<section id="doc-approval">');
    expect(md).toMatch(/^## 10\. Verification status$/m);
  });

  it("leaves the gap list, the open items and the plan alone", () => {
    expect(tableOf(d, "gap-table").rows).toEqual(tableOf(full, "gap-table").rows);
    expect(tableOf(d, "validation-plan")).toEqual(tableOf(full, "validation-plan"));
  });
});

describe("stored side tags are shown as SU and RU (display only)", () => {
  // Records saved before M5.2 may carry "[source]" and "[target]" in a source label. The stored text stays; every display says SU and RU.
  const OLD_SU = "Interview answer: Mixing speed [source]";
  const OLD_RU = "Interview answer: Mixing speed [target]";
  const mk = (id: string, label: string): Source => ({ id, type: "user_entry", label, date: "2026-10-01T09:00:00.000Z", responder: { name: "Alex Example (fictional)" } });

  function legacy(): Project {
    const p = structuredClone(demo);
    p.sources.push(mk("s-old-su", OLD_SU), mk("s-old-ru", OLD_RU));
    p.changeLog.push({ at: "2026-10-01T09:00:00.000Z", by: "Alex Example (fictional)", action: "add_source", detail: `user_entry: ${OLD_SU}`, after: { id: "s-old-su", label: OLD_SU } });
    return p;
  }

  it("keeps the stored label unchanged and shows the short name with SU and RU", () => {
    const p = legacy();
    expect(p.sources.at(-2)!.label).toBe(OLD_SU);
    expect(displaySideTags(OLD_SU)).toBe("Interview answer: Mixing speed [SU]");
    expect(displaySideTags(OLD_RU)).toBe("Interview answer: Mixing speed [RU]");
    expect(sourceLabel(p.sources.at(-1)!)).toBe("Interview answer: Mixing speed [RU]");
    expect(displaySourceNames([p.sources.at(-2)!])).toEqual(["Interview answer: Mixing speed [SU]"]);
  });

  it("shows SU and RU in the Sources page rows and finds them by the displayed text", () => {
    const rows = sourceRegisterRows(content, legacy());
    const su = rows.find((r) => r.source.id === "s-old-su")!;
    expect(su.title).toBe("Interview answer: Mixing speed [SU]");
    expect(su.source.label).toBe(OLD_SU);
    expect(filterSourceRows(rows, { text: "[SU]" }).map((r) => r.source.id)).toContain("s-old-su");
  });

  it("shows SU and RU in the Source register appendix and never [source] or [target]", () => {
    const d = docOf(legacy());
    const text = JSON.stringify(section(d, "source-register").blocks);
    expect(text).toContain("Interview answer: Mixing speed [SU]");
    expect(text).toContain("Interview answer: Mixing speed [RU]");
    expect(text).not.toMatch(/\[(source|target)\]/);
    expect(renderMarkdown(d)).not.toMatch(/\[(source|target)\]/);
    expect(renderHtml(d)).not.toMatch(/\[(source|target)\]/);
  });

  it("shows SU in the change log", () => {
    const row = changeLogView(content, legacy()).find((r) => r.action === "add_source" && r.subject.includes("Mixing speed"))!;
    expect(row.subject).toBe("Interview answer: Mixing speed [SU]");
    expect(row.detail).toBe("user_entry: Interview answer: Mixing speed [SU]");
  });

  it("new interview answers are labelled with SU and RU already", () => {
    const labels = demo.sources.filter((s) => s.type === "interview_answer").map((s) => s.label);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/\[(source|target)\]/);
  });
});

describe("a document source reads 'ID — title' (the title may hold parentheses)", () => {
  it("uses an em dash, not brackets, in the short name", () => {
    const s: Source = { id: "s1", type: "document_reference", label: "x", date: "2026-10-01T00:00:00.000Z", docRef: { identifier: "DOC-001", docType: "Spec", title: "Vendor X spec (fictional)" } };
    expect(sourceShort(s)).toBe("DOC-001 — Vendor X spec (fictional)");
    expect(idWithTitle("DOC-002")).toBe("DOC-002");
    expect(idWithTitle("DOC-003", "")).toBe("DOC-003");
  });
});
