import { describe, expect, it } from "vitest";
import { parseProject, type Actor, type DocumentExport, type Project, type TemplateRecord } from "@gap/process-model";
import {
  actionLabel,
  addComment,
  assess,
  buildDocument,
  changeLogActionCounts,
  changeLogOptions,
  changeLogToCsv,
  changeLogView,
  commentDisplayId,
  DOCUMENT_SECTION_IDS,
  documentFingerprint,
  issueRevision,
  recordExport,
  reopenComment,
  replyToComment,
  resolveComment,
  revisionState,
  revisionStatusLabel,
  REVIEW_ACTIONS,
  ReviewError,
  type DocModel,
} from "@gap/engine";
import { ACTOR, content, kit } from "./helpers";

const { base, pair, v } = kit;

const PUMP_KEY = "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple";
const GEN = "2026-10-20T08:00:00.000Z";
const GEN2 = "2026-10-21T17:45:00.000Z";

const AUTHOR: Actor = { name: "A. Reviewer (fictional)", role: "MSAT lead (fictional)", at: "2026-10-05T09:00:00.000Z" };
const CHECKER: Actor = { name: "B. Checker (fictional)", role: "QA reviewer (fictional)", at: "2026-10-06T09:00:00.000Z" };
const at = (a: Actor, when: string): Actor => ({ ...a, at: when });

/** A small project with one real gap (the filling pump principle) to anchor comments to. */
const project = (): Project => pair(base(), "fill.pump", "rotary_piston", "peristaltic");
const docOf = (p: Project, generated = GEN): DocModel => buildDocument(content, p, assess(content, p), generated);

const BUILTIN: TemplateRecord = { mode: "builtin", name: "Built-in default", version: "1.0.0" };

/** Strict deep-freeze, to prove that no function writes into the project it was given. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) deepFreeze((o as Record<string, unknown>)[k]);
    Object.freeze(o);
  }
  return o;
}

const msg = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ReviewError);
    return (e as Error).message;
  }
  throw new Error("expected the call to throw");
};

describe("commentDisplayId and labels", () => {
  it("pads the comment number to three digits", () => {
    expect(commentDisplayId(1)).toBe("C-001");
    expect(commentDisplayId(42)).toBe("C-042");
    expect(commentDisplayId(1000)).toBe("C-1000");
  });

  it("revision status labels never say approved", () => {
    expect(revisionStatusLabel("draft")).toBe("Draft");
    expect(revisionStatusLabel("issued_for_review")).toBe("Issued for review");
  });
});

// ================================================================== fingerprint

describe("documentFingerprint", () => {
  it("is 16 hex digits and the same for the same document", () => {
    const p = project();
    const f = documentFingerprint(docOf(p));
    expect(f).toMatch(/^[0-9a-f]{16}$/);
    expect(documentFingerprint(docOf(p))).toBe(f);
    expect(documentFingerprint(docOf(structuredClone(p)))).toBe(f);
  });

  it("ignores the Generated time", () => {
    const p = project();
    expect(documentFingerprint(docOf(p, GEN))).toBe(documentFingerprint(docOf(p, GEN2)));
    expect(docOf(p, GEN).meta.find(([k]) => k === "Generated")![1]).not.toBe(docOf(p, GEN2).meta.find(([k]) => k === "Generated")![1]);
  });

  it("ignores the Revision line, revision history and reviewer comments", () => {
    const p = project();
    const f = documentFingerprint(docOf(p));
    const withRev = issueRevision(p, docOf(p), { status: "draft", summary: "First" }, AUTHOR);
    const withComment = addComment(withRev, { sectionId: "gap-table", gapKey: PUMP_KEY, text: "Please check." }, CHECKER);
    const resolved = resolveComment(withComment, 1, "Done.", AUTHOR);
    for (const q of [withRev, withComment, resolved]) {
      expect(documentFingerprint(docOf(q))).toBe(f);
    }
    // The documents do differ on the page: the Revision line, appendix C and appendix D.
    expect(docOf(withRev).meta.find(([k]) => k === "Revision")![1]).not.toBe(docOf(p).meta.find(([k]) => k === "Revision")![1]);
    expect(JSON.stringify(docOf(withComment).sections)).not.toBe(JSON.stringify(docOf(p).sections));
  });

  it("ignores the lists doc.revisions and doc.comments on their own", () => {
    const d = docOf(project());
    const f = documentFingerprint(d);
    expect(documentFingerprint({ ...d, revisions: [{ number: 9, statusLabel: "Draft", date: "x", by: "y", summary: "z" }] })).toBe(f);
    expect(documentFingerprint({ ...d, comments: [{ id: "C-001", sectionId: "scope", anchorText: "a", by: "b", at: "c", text: "d", status: "open", replies: [] }] })).toBe(f);
  });

  it("changes when a recorded value changes", () => {
    const p = project();
    const changed = v(p, "fill.pump", "target", "rotary_piston");
    expect(documentFingerprint(docOf(changed))).not.toBe(documentFingerprint(docOf(p)));
  });

  it("changes when a gap decision (owner or status) changes the document", () => {
    const p = project();
    const f = documentFingerprint(docOf(p));
    const q = structuredClone(p);
    q.gapOverlays.push({ gapKey: PUMP_KEY, status: "in_progress", owner: "Owner (fictional)" });
    expect(documentFingerprint(docOf(q))).not.toBe(f);
  });

  it("changes when the title, banner, status, other meta rows or any section changes", () => {
    const d = docOf(project());
    const f = documentFingerprint(d);
    expect(documentFingerprint({ ...d, title: d.title + "!" })).not.toBe(f);
    expect(documentFingerprint({ ...d, banner: d.banner + "!" })).not.toBe(f);
    expect(documentFingerprint({ ...d, status: "FINAL" })).not.toBe(f);
    expect(documentFingerprint({ ...d, meta: d.meta.map(([k, x]) => (k === "Project" ? [k, x + "!"] : [k, x])) as [string, string][] })).not.toBe(f);
    const edited = structuredClone(d);
    const sec = edited.sections.find((s) => s.id === "purpose")!;
    sec.blocks = [{ type: "paragraph", text: "Different." }];
    expect(documentFingerprint(edited)).not.toBe(f);
  });

  it("is not fooled by moving text between table cells", () => {
    const d = docOf(project());
    const a: DocModel = { ...d, sections: [{ id: "x", number: "1", title: "T", blocks: [{ type: "table", columns: ["A", "B"], rows: [["ab", "c"]] }] }] };
    const b: DocModel = { ...d, sections: [{ id: "x", number: "1", title: "T", blocks: [{ type: "table", columns: ["A", "B"], rows: [["a", "bc"]] }] }] };
    expect(documentFingerprint(a)).not.toBe(documentFingerprint(b));
  });

  it("handles non-ASCII text", () => {
    const d = docOf(project());
    const a = documentFingerprint({ ...d, title: "Gap — é" });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(documentFingerprint({ ...d, title: "Gap — e" }));
  });
});

// ================================================================== revisions

describe("revisionState", () => {
  it("has no latest revision before one is issued", () => {
    const p = project();
    expect(revisionState(p, docOf(p))).toEqual({ changedSinceIssue: false });
  });

  it("reports the latest revision and that nothing changed", () => {
    const p0 = project();
    const p = issueRevision(p0, docOf(p0), { status: "draft", summary: "First" }, AUTHOR);
    const st = revisionState(p, docOf(p));
    expect(st.latest?.number).toBe(1);
    expect(st.changedSinceIssue).toBe(false);
  });

  it("reports a change after the content changes, and clears it with a new revision", () => {
    const p0 = project();
    const p1 = issueRevision(p0, docOf(p0), { status: "draft", summary: "First" }, AUTHOR);
    const changed = v(p1, "fill.pump", "target", "rotary_piston");
    expect(revisionState(changed, docOf(changed))).toMatchObject({ latest: { number: 1 }, changedSinceIssue: true });
    const p2 = issueRevision(changed, docOf(changed), { status: "issued_for_review", summary: "Pump aligned" }, at(AUTHOR, "2026-10-07T09:00:00.000Z"));
    expect(revisionState(p2, docOf(p2))).toMatchObject({ latest: { number: 2 }, changedSinceIssue: false });
  });

  it("uses the highest revision number as the latest, whatever the order", () => {
    const p0 = project();
    const p = issueRevision(issueRevision(p0, docOf(p0), { status: "draft", summary: "a" }, AUTHOR), docOf(p0), { status: "draft", summary: "b" }, AUTHOR);
    p.document.revisions.reverse();
    expect(revisionState(p, docOf(p)).latest?.number).toBe(2);
  });
});

describe("issueRevision", () => {
  it("records the revision with who, when, summary, fingerprint and template", () => {
    const p0 = project();
    const d = docOf(p0);
    const p = issueRevision(p0, d, { status: "draft", summary: "  First draft for internal review  ", template: BUILTIN }, AUTHOR);
    expect(p.document.revisions).toEqual([
      {
        number: 1,
        status: "draft",
        summary: "First draft for internal review",
        by: "A. Reviewer (fictional)",
        role: "MSAT lead (fictional)",
        at: "2026-10-05T09:00:00.000Z",
        fingerprint: documentFingerprint(d),
        template: BUILTIN,
      },
    ]);
  });

  it("leaves out role and template when none are given, and trims the name and role", () => {
    const p0 = project();
    const p = issueRevision(p0, docOf(p0), { status: "issued_for_review", summary: "S" }, { name: "  Pat Placeholder (fictional) ", role: "   ", at: GEN });
    const r = p.document.revisions[0]!;
    expect(r.by).toBe("Pat Placeholder (fictional)");
    expect("role" in r).toBe(false);
    expect("template" in r).toBe(false);
  });

  it("stores a library template with its hash and file name, and drops empty extras", () => {
    const p0 = project();
    const tpl: TemplateRecord = { mode: "their_look", name: "Brightwater look (fictional)", version: "2.1", sha256: "ab".repeat(32), fileName: "brightwater.docx" };
    const p = issueRevision(p0, docOf(p0), { status: "draft", summary: "S", template: tpl }, AUTHOR);
    expect(p.document.revisions[0]!.template).toEqual(tpl);
    // The stored record is a copy.
    tpl.name = "changed";
    expect(p.document.revisions[0]!.template!.name).toBe("Brightwater look (fictional)");
  });

  it("numbers revisions 1, 2, 3 and logs each with the exact detail text", () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "draft", summary: "First draft" }, AUTHOR);
    p = issueRevision(p, docOf(p), { status: "issued_for_review", summary: "Ready for QA review" }, at(AUTHOR, "2026-10-06T09:00:00.000Z"));
    p = issueRevision(p, docOf(p), { status: "draft", summary: "Rework" }, at(AUTHOR, "2026-10-07T09:00:00.000Z"));
    expect(p.document.revisions.map((r) => r.number)).toEqual([1, 2, 3]);
    const events = p.changeLog.filter((e) => e.action === "issue_revision");
    expect(events.map((e) => e.detail)).toEqual([
      "Revision 1 (Draft): First draft",
      "Revision 2 (Issued for review): Ready for QA review",
      "Revision 3 (Draft): Rework",
    ]);
    expect(events[1]).toMatchObject({ by: AUTHOR.name, at: "2026-10-06T09:00:00.000Z", path: "document.revision.2" });
    expect(events[1]!.after).toMatchObject({ number: 2, status: "issued_for_review" });
  });

  it("never reuses a number, even when the stored numbers have gaps", () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "draft", summary: "a" }, AUTHOR);
    p.document.revisions[0]!.number = 7;
    p = issueRevision(p, docOf(p), { status: "draft", summary: "b" }, AUTHOR);
    expect(p.document.revisions.map((r) => r.number)).toEqual([7, 8]);
  });

  it("does not change the project it was given", () => {
    const p0 = deepFreeze(project());
    const d = deepFreeze(docOf(p0));
    const before = JSON.stringify(p0);
    const p = issueRevision(p0, d, { status: "draft", summary: "S", template: BUILTIN }, AUTHOR);
    expect(JSON.stringify(p0)).toBe(before);
    expect(p).not.toBe(p0);
    expect(p.changeLog.length).toBe(p0.changeLog.length + 1);
    expect(p0.document.revisions).toHaveLength(0);
  });

  it("refuses a missing summary, naming what to enter", () => {
    const p0 = project();
    expect(msg(() => issueRevision(p0, docOf(p0), { status: "draft", summary: "" }, AUTHOR))).toMatch(/summary/i);
    expect(msg(() => issueRevision(p0, docOf(p0), { status: "draft", summary: "   \n " }, AUTHOR))).toMatch(/summary/i);
  });

  it("refuses a missing name or an unknown status", () => {
    const p0 = project();
    expect(msg(() => issueRevision(p0, docOf(p0), { status: "draft", summary: "S" }, { name: "  ", at: GEN }))).toMatch(/name/i);
    expect(msg(() => issueRevision(p0, docOf(p0), { status: "approved" as never, summary: "S" }, AUTHOR))).toMatch(/Draft or Issued for review/);
  });

  it("refuses a template without a name or with an unknown mode", () => {
    const p0 = project();
    expect(msg(() => issueRevision(p0, docOf(p0), { status: "draft", summary: "S", template: { mode: "tags", name: " ", version: "1" } }, AUTHOR))).toMatch(/template/i);
    expect(msg(() => issueRevision(p0, docOf(p0), { status: "draft", summary: "S", template: { mode: "macro" as never, name: "x", version: "1" } }, AUTHOR))).toMatch(/mode/i);
  });

  it("makes no change to the project when it refuses", () => {
    const p0 = deepFreeze(project());
    expect(() => issueRevision(p0, docOf(p0), { status: "draft", summary: "" }, AUTHOR)).toThrow();
    expect(p0.document.revisions).toHaveLength(0);
  });
});

// ================================================================== comments

describe("addComment", () => {
  it("adds an open comment anchored to a section", () => {
    const p = addComment(project(), { sectionId: "scope", text: "  Is the lyophilizer out of scope?  " }, CHECKER);
    expect(p.document.comments).toEqual([
      {
        seq: 1,
        anchor: { sectionId: "scope" },
        by: "B. Checker (fictional)",
        role: "QA reviewer (fictional)",
        at: "2026-10-06T09:00:00.000Z",
        text: "Is the lyophilizer out of scope?",
        status: "open",
        replies: [],
      },
    ]);
  });

  it("keeps the stable gap key, not a display ID", () => {
    const p = addComment(project(), { sectionId: "gap-table", gapKey: `  ${PUMP_KEY} `, text: "Check." }, CHECKER);
    expect(p.document.comments[0]!.anchor).toEqual({ sectionId: "gap-table", gapKey: PUMP_KEY });
  });

  it("treats a blank gap key as no gap", () => {
    const p = addComment(project(), { sectionId: "gap-table", gapKey: "  ", text: "Check." }, CHECKER);
    expect(p.document.comments[0]!.anchor).toEqual({ sectionId: "gap-table" });
  });

  it("accepts every section the document builds, appendices included", () => {
    let p = project();
    for (const id of DOCUMENT_SECTION_IDS) p = addComment(p, { sectionId: id, text: `On ${id}` }, CHECKER);
    expect(p.document.comments).toHaveLength(DOCUMENT_SECTION_IDS.length);
  });

  it("the section list matches the sections buildDocument produces, in order", () => {
    expect(docOf(project()).sections.map((s) => s.id)).toEqual([...DOCUMENT_SECTION_IDS]);
  });

  it("numbers comments 1, 2, 3 and logs each one", () => {
    let p = project();
    p = addComment(p, { sectionId: "scope", text: "One" }, CHECKER);
    p = addComment(p, { sectionId: "risk", text: "Two" }, CHECKER);
    p = addComment(p, { sectionId: "approval", text: "Three" }, CHECKER);
    expect(p.document.comments.map((c) => c.seq)).toEqual([1, 2, 3]);
    const events = p.changeLog.filter((e) => e.action === "add_comment");
    expect(events.map((e) => e.detail)).toEqual(["C-001: One", "C-002: Two", "C-003: Three"]);
    expect(events[0]).toMatchObject({ by: CHECKER.name, at: CHECKER.at, path: "document.comment.1" });
    expect(events[0]!.after).toMatchObject({ seq: 1, status: "open", anchor: { sectionId: "scope" } });
  });

  it("never reuses a number, even when the stored numbers have gaps", () => {
    let p = addComment(project(), { sectionId: "scope", text: "One" }, CHECKER);
    p.document.comments[0]!.seq = 9;
    p = addComment(p, { sectionId: "scope", text: "Two" }, CHECKER);
    expect(p.document.comments.map((c) => c.seq)).toEqual([9, 10]);
  });

  it("does not change the project it was given", () => {
    const p0 = deepFreeze(project());
    const p = addComment(p0, { sectionId: "scope", text: "One" }, CHECKER);
    expect(p0.document.comments).toHaveLength(0);
    expect(p0.changeLog.length).toBe(p.changeLog.length - 1);
  });

  it("refuses empty text, an unknown section and a missing name", () => {
    const p0 = project();
    expect(msg(() => addComment(p0, { sectionId: "scope", text: "" }, CHECKER))).toMatch(/Enter the comment/);
    expect(msg(() => addComment(p0, { sectionId: "scope", text: " \t " }, CHECKER))).toMatch(/Enter the comment/);
    expect(msg(() => addComment(p0, { sectionId: "nonsense", text: "x" }, CHECKER))).toMatch(/not a section/);
    expect(msg(() => addComment(p0, { sectionId: "", text: "x" }, CHECKER))).toMatch(/not a section/);
    expect(msg(() => addComment(p0, { sectionId: "scope", text: "x" }, { name: "", at: GEN }))).toMatch(/name/i);
  });
});

describe("replyToComment", () => {
  const withComment = () => addComment(project(), { sectionId: "validation-plan", text: "Who schedules the media fill?" }, CHECKER);

  it("adds a reply and leaves the comment open", () => {
    const p = replyToComment(withComment(), 1, "  Site South quality.  ", at(AUTHOR, "2026-10-06T10:00:00.000Z"));
    const c = p.document.comments[0]!;
    expect(c.status).toBe("open");
    expect(c.replies).toEqual([{ kind: "reply", by: AUTHOR.name, role: AUTHOR.role, at: "2026-10-06T10:00:00.000Z", text: "Site South quality." }]);
    const ev = p.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "reply_comment", path: "document.comment.1", detail: "C-001: Site South quality.", before: { status: "open" } });
  });

  it("keeps replies in order and allows a reply to a resolved comment", () => {
    let p = replyToComment(withComment(), 1, "First", AUTHOR);
    p = resolveComment(p, 1, "Done", AUTHOR);
    p = replyToComment(p, 1, "Thanks", CHECKER);
    expect(p.document.comments[0]!.replies.map((r) => [r.kind, r.text])).toEqual([
      ["reply", "First"],
      ["resolution", "Done"],
      ["reply", "Thanks"],
    ]);
    expect(p.document.comments[0]!.status).toBe("resolved");
  });

  it("refuses an unknown comment, empty text and a missing name", () => {
    const p0 = withComment();
    expect(msg(() => replyToComment(p0, 2, "x", AUTHOR))).toMatch(/no comment C-002/);
    expect(msg(() => replyToComment(p0, 0, "x", AUTHOR))).toMatch(/no comment C-000/);
    expect(msg(() => replyToComment(p0, 1, "  ", AUTHOR))).toMatch(/Enter your reply/);
    expect(msg(() => replyToComment(p0, 1, "x", { name: " ", at: GEN }))).toMatch(/name/i);
  });

  it("does not change the project it was given", () => {
    const p0 = deepFreeze(withComment());
    const p = replyToComment(p0, 1, "x", AUTHOR);
    expect(p0.document.comments[0]!.replies).toHaveLength(0);
    expect(p.document.comments[0]!.replies).toHaveLength(1);
  });
});

describe("resolveComment and reopenComment", () => {
  const withComment = () => addComment(project(), { sectionId: "scope", text: "Is the lyophilizer out of scope?" }, CHECKER);
  const T_RESOLVE = "2026-10-06T09:45:00.000Z";
  const T_REOPEN = "2026-10-08T09:00:00.000Z";

  it("resolves with a written resolution that is kept as a reply of kind resolution", () => {
    const p = resolveComment(withComment(), 1, " Checked; it is a liquid. ", at(AUTHOR, T_RESOLVE));
    const c = p.document.comments[0]!;
    expect(c.status).toBe("resolved");
    expect(c.replies).toEqual([{ kind: "resolution", by: AUTHOR.name, role: AUTHOR.role, at: T_RESOLVE, text: "Checked; it is a liquid." }]);
    expect(p.changeLog.at(-1)).toMatchObject({
      action: "resolve_comment",
      by: AUTHOR.name,
      at: T_RESOLVE,
      detail: "C-001 resolved: Checked; it is a liquid.",
      before: { status: "open" },
      after: { status: "resolved" },
    });
  });

  it("reopens with a reason that is kept as a reply of kind reopen", () => {
    let p = resolveComment(withComment(), 1, "Done", at(AUTHOR, T_RESOLVE));
    p = reopenComment(p, 1, "The answer is not in the document.", at(CHECKER, T_REOPEN));
    const c = p.document.comments[0]!;
    expect(c.status).toBe("open");
    expect(c.replies.map((r) => r.kind)).toEqual(["resolution", "reopen"]);
    expect(c.replies[1]).toMatchObject({ by: CHECKER.name, at: T_REOPEN, text: "The answer is not in the document." });
    expect(p.changeLog.at(-1)).toMatchObject({ action: "reopen_comment", detail: "C-001 reopened: The answer is not in the document.", before: { status: "resolved" }, after: { status: "open" } });
  });

  it("can be resolved again after a reopening", () => {
    let p = resolveComment(withComment(), 1, "Done", AUTHOR);
    p = reopenComment(p, 1, "No", CHECKER);
    p = resolveComment(p, 1, "Now added to the scope table.", AUTHOR);
    expect(p.document.comments[0]!.status).toBe("resolved");
    expect(p.document.comments[0]!.replies).toHaveLength(3);
  });

  it("refuses to resolve an already resolved comment and to reopen an open one", () => {
    const open = withComment();
    const resolved = resolveComment(open, 1, "Done", AUTHOR);
    expect(msg(() => resolveComment(resolved, 1, "Again", AUTHOR))).toBe("C-001 is already resolved");
    expect(msg(() => reopenComment(open, 1, "Why", CHECKER))).toBe("C-001 is already open");
  });

  it("requires text for both", () => {
    const open = withComment();
    const resolved = resolveComment(open, 1, "Done", AUTHOR);
    expect(msg(() => resolveComment(open, 1, "", AUTHOR))).toMatch(/how the comment was resolved/);
    expect(msg(() => resolveComment(open, 1, "   ", AUTHOR))).toMatch(/how the comment was resolved/);
    expect(msg(() => reopenComment(resolved, 1, "", CHECKER))).toMatch(/reason for reopening/);
  });

  it("refuses an unknown comment and a missing name", () => {
    const open = withComment();
    const resolved = resolveComment(open, 1, "Done", AUTHOR);
    expect(msg(() => resolveComment(open, 5, "x", AUTHOR))).toMatch(/no comment C-005/);
    expect(msg(() => reopenComment(open, 5, "x", AUTHOR))).toMatch(/no comment C-005/);
    expect(msg(() => resolveComment(open, 1, "x", { name: "", at: GEN }))).toMatch(/name/i);
    expect(msg(() => reopenComment(resolved, 1, "x", { name: "", at: GEN }))).toMatch(/name/i);
  });

  it("does not change the project it was given, and a refusal changes nothing", () => {
    const open = deepFreeze(withComment());
    const resolved = resolveComment(open, 1, "Done", AUTHOR);
    expect(open.document.comments[0]!.status).toBe("open");
    expect(open.document.comments[0]!.replies).toHaveLength(0);
    const frozen = deepFreeze(resolved);
    expect(() => resolveComment(frozen, 1, "again", AUTHOR)).toThrow(ReviewError);
    expect(frozen.document.comments[0]!.replies).toHaveLength(1);
  });

  it("other comments are untouched", () => {
    let p = addComment(withComment(), { sectionId: "risk", text: "Second" }, CHECKER);
    p = resolveComment(p, 2, "Fine", AUTHOR);
    expect(p.document.comments.map((c) => c.status)).toEqual(["open", "resolved"]);
    expect(p.document.comments[0]!.replies).toHaveLength(0);
  });
});

// ================================================================== exports

describe("recordExport", () => {
  const rec = (over: Partial<DocumentExport> = {}): DocumentExport => ({
    at: GEN,
    by: "Pat Placeholder (fictional)",
    format: "docx",
    template: { mode: "their_look", name: "Brightwater look (fictional)", version: "1.0", sha256: "cd".repeat(32), fileName: "b.docx" },
    revision: 1,
    fingerprint: "0123456789abcdef",
    changedSinceRevision: false,
    ...over,
  });

  it("appends the record without adding a change-log entry", () => {
    const p0 = project();
    const p = recordExport(recordExport(p0, rec()), rec({ format: "markdown", template: BUILTIN, changedSinceRevision: true }));
    expect(p.document.exports).toHaveLength(2);
    expect(p.document.exports[0]).toEqual(rec());
    expect(p.document.exports[1]).toMatchObject({ format: "markdown", changedSinceRevision: true });
    expect(p.changeLog).toEqual(p0.changeLog);
  });

  it("does not change the project it was given or keep a reference to the record", () => {
    const p0 = deepFreeze(project());
    const r = rec();
    const p = recordExport(p0, r);
    expect(p0.document.exports).toHaveLength(0);
    r.template.name = "changed";
    expect(p.document.exports[0]!.template.name).toBe("Brightwater look (fictional)");
  });

  it("does not change the document fingerprint", () => {
    const p0 = project();
    expect(documentFingerprint(docOf(recordExport(p0, rec())))).toBe(documentFingerprint(docOf(p0)));
  });

  it("refuses an unknown format, a missing fingerprint and a nameless template", () => {
    const p0 = project();
    expect(msg(() => recordExport(p0, rec({ format: "pdf" as never })))).toMatch(/format/i);
    expect(msg(() => recordExport(p0, rec({ fingerprint: "" })))).toMatch(/fingerprint/i);
    expect(msg(() => recordExport(p0, rec({ template: { mode: "builtin", name: "", version: "1" } })))).toMatch(/template/i);
  });
});

// ================================================================== the document

describe("the document: Revision line", () => {
  const meta = (d: DocModel) => d.meta.find(([k]) => k === "Revision")![1];

  it("sits right after Generated", () => {
    const d = docOf(project());
    const i = d.meta.findIndex(([k]) => k === "Generated");
    expect(d.meta[i + 1]![0]).toBe("Revision");
    expect(d.meta.filter(([k]) => k === "Revision")).toHaveLength(1);
  });

  it("says Not yet issued, then the latest revision, then that the content has changed", () => {
    const p0 = project();
    expect(meta(docOf(p0))).toBe("Not yet issued");
    const p1 = issueRevision(p0, docOf(p0), { status: "issued_for_review", summary: "S" }, AUTHOR);
    expect(meta(docOf(p1))).toBe("1 (Issued for review, 2026-10-05)");
    const p1d = issueRevision(p0, docOf(p0), { status: "draft", summary: "S" }, AUTHOR);
    expect(meta(docOf(p1d))).toBe("1 (Draft, 2026-10-05)");
    const changed = v(p1d, "fill.pump", "target", "rotary_piston");
    expect(meta(docOf(changed))).toBe("1 (Draft, 2026-10-05); the content has changed since this revision was issued");
  });

  it("shows the highest revision, not the first", () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "draft", summary: "a" }, AUTHOR);
    p = issueRevision(p, docOf(p), { status: "issued_for_review", summary: "b" }, at(AUTHOR, "2026-10-09T09:00:00.000Z"));
    expect(meta(docOf(p))).toBe("2 (Issued for review, 2026-10-09)");
  });

  it("stays current after a comment, a reply, a resolution, an export and another revision's logging", () => {
    let p = issueRevision(project(), docOf(project()), { status: "draft", summary: "S" }, AUTHOR);
    p = addComment(p, { sectionId: "gap-table", gapKey: PUMP_KEY, text: "Check" }, CHECKER);
    p = replyToComment(p, 1, "Ok", AUTHOR);
    p = resolveComment(p, 1, "Done", AUTHOR);
    p = recordExport(p, { at: GEN, format: "html", template: BUILTIN, revision: 1, fingerprint: "ffff", changedSinceRevision: false });
    expect(meta(docOf(p))).toBe("1 (Draft, 2026-10-05)");
    expect(revisionState(p, docOf(p)).changedSinceIssue).toBe(false);
  });
});

describe("the document: appendices after the gap details and the lists", () => {
  const sec = (d: DocModel, id: string) => d.sections.find((s) => s.id === id)!;

  it("come after the Gap details appendix, in order, with letters A to E", () => {
    const d = docOf(project());
    expect(d.sections.filter((s) => s.appendix).map((s) => [s.number, s.id, s.title])).toEqual([
      ["A", "gap-details", "Gap details"],
      ["B", "source-register", "Source register"],
      ["C", "change-log-summary", "Change log summary"],
      ["D", "revision-history", "Revision history"],
      ["E", "reviewer-comments", "Reviewer comments"],
    ]);
  });

  it("say so plainly when nothing has been recorded", () => {
    const d = docOf(project());
    expect(d.revisions).toEqual([]);
    expect(d.comments).toEqual([]);
    const c = sec(d, "revision-history").blocks;
    expect(c[0]).toMatchObject({ type: "paragraph", text: content.templates.document.revisionHistoryIntro });
    expect(c[1]).toEqual({ type: "paragraph", text: "No revision has been issued yet." });
    expect(c[2]).toEqual({ type: "note", text: content.templates.document.revisionStatement });
    const dd = sec(d, "reviewer-comments").blocks;
    expect(dd[0]).toMatchObject({ type: "paragraph", text: content.templates.document.reviewerCommentsIntro });
    expect(dd[1]).toEqual({ type: "paragraph", text: "No reviewer comments have been recorded." });
  });

  it("list revisions with status, date, author, summary and template", () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "draft", summary: "First draft", template: BUILTIN }, AUTHOR);
    p = issueRevision(p, docOf(p), { status: "issued_for_review", summary: "For QA" }, { name: "Pat Placeholder (fictional)", at: "2026-10-08T10:00:00.000Z" });
    const d = docOf(p);
    expect(d.revisions).toEqual([
      { number: 1, statusLabel: "Draft", date: "2026-10-05", by: AUTHOR.name, role: AUTHOR.role, summary: "First draft", template: "Built-in default 1.0.0" },
      { number: 2, statusLabel: "Issued for review", date: "2026-10-08", by: "Pat Placeholder (fictional)", summary: "For QA" },
    ]);
    const table = sec(d, "revision-history").blocks[1]!;
    expect(table).toEqual({
      type: "table",
      columns: ["Revision", "Status", "Date", "By", "Summary of change", "Template"],
      rows: [
        ["1", "Draft", "2026-10-05", "A. Reviewer (fictional) (MSAT lead (fictional))", "First draft", "Built-in default 1.0.0"],
        ["2", "Issued for review", "2026-10-08", "Pat Placeholder (fictional)", "For QA", "—"],
      ],
    });
  });

  it("never describes a revision as approved, in the statement or anywhere in appendix C", () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "issued_for_review", summary: "For review" }, AUTHOR);
    const text = JSON.stringify(sec(docOf(p), "revision-history"));
    expect(text).toMatch(/not an approval/);
    expect(text).toMatch(/no\s+electronic signature/);
    expect(text).not.toMatch(/\bapproved by\b/i);
    expect(content.templates.document.revisionStatement).not.toMatch(/GMP-compliant|validated/i);
  });

  it("list comments with an anchor made of the section number, title and the gap's current ID", () => {
    let p = project();
    p = addComment(p, { sectionId: "gap-table", gapKey: PUMP_KEY, text: "Regulatory check, please." }, CHECKER);
    p = addComment(p, { sectionId: "scope", text: "Scope?" }, CHECKER);
    p = addComment(p, { sectionId: "change-log-summary", text: "On an appendix" }, CHECKER);
    p = addComment(p, { sectionId: "reviewer-comments", text: "On the comments list itself" }, CHECKER);
    const a = assess(content, p);
    const gap = a.gaps.find((g) => g.key === PUMP_KEY)!;
    const d = docOf(p);
    expect(d.comments.map((c) => c.anchorText)).toEqual([
      `6. Detailed gap table, ${gap.displayId}`,
      "2. Scope",
      "Appendix C. Change log summary",
      "Appendix E. Reviewer comments",
    ]);
    expect(d.comments[0]).toMatchObject({ id: "C-001", sectionId: "gap-table", gapDisplayId: gap.displayId, status: "open" });
    expect(d.comments[1]!.gapDisplayId).toBeUndefined();
  });

  it("follows the gap when its display ID changes, because the comment keeps the stable key", () => {
    let p = addComment(project(), { sectionId: "gap-table", gapKey: PUMP_KEY, text: "x" }, CHECKER);
    const first = docOf(p).comments[0]!.gapDisplayId!;
    // Another gap appears earlier in the register: the display ID of the pump gap may change, the comment still finds it.
    p = pair(p, "comp.vessel_type", "stainless_tank", "glass");
    const a = assess(content, p);
    expect(docOf(p).comments[0]!.gapDisplayId).toBe(a.gaps.find((g) => g.key === PUMP_KEY)!.displayId);
    expect(first).toMatch(/^G-\d{3}$/);
  });

  it("say when the gap is no longer present, and keep the comment", () => {
    // Remove the pump difference: the gap becomes equivalent in the table but still exists as a gap, so use a key that never exists.
    const p = addComment(project(), { sectionId: "gap-table", gapKey: "R-OLD-RULE:uo.gone.param.x", text: "x" }, CHECKER);
    const d = docOf(p);
    expect(d.comments[0]!.anchorText).toBe("6. Detailed gap table, gap no longer present (R-OLD-RULE:uo.gone.param.x)");
    expect(d.comments[0]!.gapDisplayId).toBeUndefined();
  });

  it("names an unknown section from an imported file instead of failing", () => {
    const p = addComment(project(), { sectionId: "scope", text: "x" }, CHECKER);
    p.document.comments[0]!.anchor.sectionId = "removed-section";
    expect(docOf(p).comments[0]!.anchorText).toBe("Unknown section (removed-section)");
  });

  it("render the table with status and every response, in the order given", () => {
    let p = project();
    p = addComment(p, { sectionId: "validation-plan", text: "Who schedules it?" }, CHECKER);
    p = replyToComment(p, 1, "Site South.", at(AUTHOR, "2026-10-06T11:00:00.000Z"));
    p = resolveComment(p, 1, "Owner recorded.", at(AUTHOR, "2026-10-07T08:00:00.000Z"));
    p = reopenComment(p, 1, "Not recorded yet.", at(CHECKER, "2026-10-08T08:00:00.000Z"));
    p = addComment(p, { sectionId: "risk", text: "Second comment" }, CHECKER);
    const table = sec(docOf(p), "reviewer-comments").blocks[1]!;
    expect(table).toEqual({
      type: "table",
      columns: ["ID", "Location", "Comment", "By", "Date", "Status", "Responses"],
      rows: [
        [
          "C-001",
          "7. Validation plan",
          "Who schedules it?",
          "B. Checker (fictional) (QA reviewer (fictional))",
          "2026-10-06",
          "Open",
          "Reply by A. Reviewer (fictional), 2026-10-06: Site South.; Resolution by A. Reviewer (fictional), 2026-10-07: Owner recorded.; Reopened by B. Checker (fictional), 2026-10-08: Not recorded yet.",
        ],
        ["C-002", "10. Risk ranking", "Second comment", "B. Checker (fictional) (QA reviewer (fictional))", "2026-10-06", "Open", "—"],
      ],
    });
  });

  it("shows a resolved comment as Resolved", () => {
    let p = addComment(project(), { sectionId: "scope", text: "x" }, CHECKER);
    p = resolveComment(p, 1, "y", AUTHOR);
    const row = (sec(docOf(p), "reviewer-comments").blocks[1] as { rows: string[][] }).rows[0]!;
    expect(row[5]).toBe("Resolved");
    expect(docOf(p).comments[0]!.status).toBe("resolved");
    expect(docOf(p).comments[0]!.replies[0]).toMatchObject({ kind: "resolution", text: "y" });
  });

  it("keep text exactly as typed, including characters a renderer must escape", () => {
    const hostile = `<script>alert("x")</script> & 'q' | pipe\nsecond line`;
    const p = addComment(project(), { sectionId: "scope", text: hostile }, { name: "<b>Name</b>", at: CHECKER.at });
    const d = docOf(p);
    expect(d.comments[0]!.text).toBe(hostile);
    expect(d.comments[0]!.by).toBe("<b>Name</b>");
  });
});

describe("the document: Change log summary leaves review events out", () => {
  it("does not count revisions or comments, nor include them in the Total", () => {
    const p0 = project();
    const before = JSON.stringify(docOf(p0).sections.find((s) => s.id === "change-log-summary"));
    let p = issueRevision(p0, docOf(p0), { status: "draft", summary: "S" }, AUTHOR);
    p = addComment(p, { sectionId: "scope", text: "c" }, CHECKER);
    p = replyToComment(p, 1, "r", AUTHOR);
    p = resolveComment(p, 1, "d", AUTHOR);
    p = reopenComment(p, 1, "o", CHECKER);
    expect(JSON.stringify(docOf(p).sections.find((s) => s.id === "change-log-summary"))).toBe(before);
    expect(p.changeLog.length).toBe(p0.changeLog.length + 5);
  });

  it("carries a note that says where they are listed, without fixed appendix letters", () => {
    const blocks = docOf(project()).sections.find((s) => s.id === "change-log-summary")!.blocks;
    expect(blocks.at(-1)).toEqual({ type: "note", text: content.templates.document.changeLogReviewNote });
    expect(content.templates.document.changeLogReviewNote).toMatch(/Revision history and Reviewer comments appendices/);
    expect(content.templates.document.changeLogReviewNote).not.toMatch(/Appendix [A-Z]/);
  });

  it("changeLogActionCounts counts them by default and skips them on request", () => {
    let p = issueRevision(project(), docOf(project()), { status: "draft", summary: "S" }, AUTHOR);
    p = addComment(p, { sectionId: "scope", text: "c" }, CHECKER);
    expect(changeLogActionCounts(p).map((c) => c.action)).toEqual(expect.arrayContaining(["issue_revision", "add_comment"]));
    const skipped = changeLogActionCounts(p, { excludeReview: true });
    for (const a of REVIEW_ACTIONS) expect(skipped.map((c) => c.action)).not.toContain(a);
    expect(skipped.some((c) => c.action === "answer")).toBe(true);
  });
});

// ================================================================== change log page

describe("change log labels and rows for the new actions", () => {
  it("has the five labels from the spec", () => {
    expect(actionLabel("issue_revision")).toBe("Revision issued");
    expect(actionLabel("add_comment")).toBe("Comment added");
    expect(actionLabel("reply_comment")).toBe("Comment reply");
    expect(actionLabel("resolve_comment")).toBe("Comment resolved");
    expect(actionLabel("reopen_comment")).toBe("Comment reopened");
    expect([...REVIEW_ACTIONS].sort()).toEqual(["add_comment", "issue_revision", "reopen_comment", "reply_comment", "resolve_comment"]);
  });

  const scenario = () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "draft", summary: "First draft" }, AUTHOR);
    p = addComment(p, { sectionId: "scope", text: "Scope?" }, CHECKER);
    p = replyToComment(p, 1, "Looking", AUTHOR);
    p = resolveComment(p, 1, "Done", AUTHOR);
    p = reopenComment(p, 1, "Not done", CHECKER);
    return p;
  };

  it("offers the new actions in the filter options, with their labels", () => {
    const opts = changeLogOptions(content, scenario()).actions;
    for (const [value, label] of [
      ["issue_revision", "Revision issued"],
      ["add_comment", "Comment added"],
      ["reply_comment", "Comment reply"],
      ["resolve_comment", "Comment resolved"],
      ["reopen_comment", "Comment reopened"],
    ] as const) {
      expect(opts).toContainEqual({ value, label });
    }
  });

  it("shows readable rows: subject, before and after, detail", () => {
    const rows = changeLogView(content, scenario());
    const byAction = (a: string) => rows.find((r) => r.action === a)!;
    expect(byAction("issue_revision")).toMatchObject({ actionLabel: "Revision issued", subject: "Document revision 1", detail: "Revision 1 (Draft): First draft", by: AUTHOR.name });
    expect(byAction("add_comment")).toMatchObject({ actionLabel: "Comment added", subject: "Reviewer comment C-001", before: "—", after: "Open", detail: "C-001: Scope?" });
    expect(byAction("reply_comment")).toMatchObject({ before: "Open", after: "Open" });
    expect(byAction("resolve_comment")).toMatchObject({ before: "Open", after: "Resolved", detail: "C-001 resolved: Done" });
    expect(byAction("reopen_comment")).toMatchObject({ before: "Resolved", after: "Open", detail: "C-001 reopened: Not done" });
  });

  it("filters by the new actions and exports them to CSV", () => {
    const p = scenario();
    expect(changeLogView(content, p, { action: "add_comment" })).toHaveLength(1);
    expect(changeLogView(content, p, { text: "C-001" }).length).toBe(4);
    const csv = changeLogToCsv(content, p);
    expect(csv).toContain("Revision issued");
    expect(csv).toContain("Comment reopened");
  });
});

// ================================================================== files

describe("a project with a review survives a file round trip", () => {
  it("keeps revisions, comments, replies and exports", () => {
    let p = project();
    p = issueRevision(p, docOf(p), { status: "draft", summary: "S", template: BUILTIN }, AUTHOR);
    p = addComment(p, { sectionId: "gap-table", gapKey: PUMP_KEY, text: "Check" }, CHECKER);
    p = resolveComment(replyToComment(p, 1, "Ok", AUTHOR), 1, "Done", AUTHOR);
    p = recordExport(p, { at: GEN, format: "docx", template: BUILTIN, revision: 1, fingerprint: documentFingerprint(docOf(p)), changedSinceRevision: false });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    expect(revisionState(back, docOf(back)).changedSinceIssue).toBe(false);
  });

  it("the project used here starts with an empty document block", () => {
    expect(project().document).toEqual({ revisions: [], comments: [], exports: [] });
    expect(project().schemaVersion).toBe("1.6.0");
    expect(ACTOR.name).toBeTruthy();
  });
});
