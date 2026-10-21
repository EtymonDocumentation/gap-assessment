import { assess } from "@gap/engine";
import { emptyProject, fingerprintResolved, getEntry, parseProject, resolveEntry, SCHEMA_VERSION, verificationState, type Actor } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content } from "../index";

/**
 * Migration 1.5.0 -> 1.6.0. The old file is written out by hand in the 1.5.0 shape: the bioburden-reduction (BBR) filter
 * question lived at uo.sterile_filtration.mat.prefilter, PUPSIT was one option of the integrity tests answer, and neither
 * the dilution question nor the buffer preparation unit existed.
 */

const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };
const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let counter = 0;
function entry(path: string, value: unknown, extra: Raw = {}): Raw {
  return {
    id: `ent-old${++counter}`,
    path,
    status: "established",
    value,
    sourceIds: ["src-old1"],
    recordedBy: "Alex Example (fictional)",
    recordedAt: T0,
    revision: 1,
    ...extra,
  };
}

function item(key: string, label: string, fields: Record<string, Raw>): Raw {
  return { key, label, fields };
}

/** The 1.5.0 file: a sterile filtration unit on both sides, with the old BBR filter question and the old integrity answer. */
function oldProject(opts: { sourceTests: string[]; targetSameAsSource?: boolean; targetTests?: string[] } = { sourceTests: ["pupsit", "post_use"] }): Raw {
  const raw = json(emptyProject({ title: "Old project (fictional)", actor: ACTOR, contentRefs: content.versions }));
  raw.schemaVersion = "1.5.0";
  raw.sources = [{ id: "src-old1", type: "interview_answer", label: "Interview answer (fictional)", date: T0 }];
  raw.answers = [
    { id: "ans-old1", questionId: "filt.prefilter", side: "source", kind: "value", raw: { kind: "value", value: "yes" }, sourceId: "src-old1", by: ACTOR.name, at: T0 },
  ];
  for (const side of ["source", "target"] as const) {
    const verified = side === "source" ? { verification: { by: "Verifier Example (fictional)", at: T0, fingerprint: "" } } : {};
    const tests =
      side === "target" && opts.targetSameAsSource
        ? { ...entry(`${side}.uo.sterile_filtration.ipc.integrity.tests`, undefined), value: undefined, sameAsSource: true }
        : entry(`${side}.uo.sterile_filtration.ipc.integrity.tests`, side === "source" ? opts.sourceTests : opts.targetTests ?? opts.sourceTests, verified);
    if (tests.value === undefined) delete tests.value;
    raw.processes[side].unitOperations.sterile_filtration = {
      key: "sterile_filtration",
      label: "Bioburden reduction and sterile filtration",
      sequence: 30,
      fields: { presence: entry(`${side}.uo.sterile_filtration.presence`, true) },
      collections: {
        param: {},
        equip: {},
        mat: {
          prefilter: item("prefilter", "Pre-filter (bioburden reduction)", {
            present: entry(`${side}.uo.sterile_filtration.mat.prefilter.present`, true),
            supplier: entry(`${side}.uo.sterile_filtration.mat.prefilter.supplier`, "Filter Vendor A (fictional)"),
          }),
        },
        ipc: {
          integrity: item("integrity", "Filter integrity testing", { tests }),
          bioburden: item("bioburden", "Pre-filtration bioburden", {
            limit: entry(`${side}.uo.sterile_filtration.ipc.bioburden.limit`, { value: 10, unit: "CFU/100 mL" }),
          }),
        },
        study: {},
        doc: {},
      },
    };
  }
  raw.gapOverlays = [
    { gapKey: "R-FILTER-TRAIN:uo.sterile_filtration.mat.prefilter.present", status: "in_progress", owner: "QA lead (fictional)" },
    { gapKey: "R-INTEGRITY-TESTS:uo.sterile_filtration.ipc.integrity.tests#pupsit", status: "accepted_no_action", notes: "Kept (fictional)." },
    { gapKey: "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple", status: "open" },
  ];
  raw.document.comments = [
    {
      seq: 1,
      anchor: { sectionId: "gap-table", gapKey: "R-FILTER-TRAIN:uo.sterile_filtration.mat.prefilter.present" },
      by: "B. Checker (fictional)",
      at: T0,
      text: "Is the BBR filter still needed (fictional)?",
      status: "open",
      replies: [],
    },
    {
      seq: 2,
      anchor: { sectionId: "gap-table", gapKey: "R-INTEGRITY-TESTS:uo.sterile_filtration.ipc.integrity.tests#pupsit" },
      by: "B. Checker (fictional)",
      at: T0,
      text: "PUPSIT justification please (fictional).",
      status: "open",
      replies: [],
    },
  ];
  raw.changeLog = [{ at: T0, by: ACTOR.name, action: "entry set", path: "source.uo.sterile_filtration.mat.prefilter.present" }];
  raw.interview.confirmations = [{ sectionId: "uo.sterile_filtration", side: "source", by: ACTOR.name, at: T0 }];
  // Give the verified source integrity answer a matching fingerprint, so its verification starts out valid.
  const srcTests = raw.processes.source.unitOperations.sterile_filtration.collections.ipc.integrity.fields.tests;
  srcTests.verification.fingerprint = fingerprintResolved(resolveEntry(raw as unknown as Parameters<typeof resolveEntry>[0], "source.uo.sterile_filtration.ipc.integrity.tests"));
  return raw;
}

describe("migration 1.5.0 -> 1.6.0", () => {
  it("is read as the current schema version (the chain continues past 1.6.0)", () => {
    expect(parseProject(oldProject()).schemaVersion).toBe(SCHEMA_VERSION);
  });

  describe("the BBR filter question moves to the new BBR filtration unit", () => {
    const p = parseProject(oldProject());

    it("moves the answer to uo.bbr_filtration.presence on both sides and keeps its identity, sources and recorder", () => {
      for (const side of ["source", "target"]) {
        expect(resolveEntry(p, `${side}.uo.bbr_filtration.presence`)).toMatchObject({ status: "established", value: true });
        expect(resolveEntry(p, `${side}.uo.sterile_filtration.mat.prefilter.present`).status).toBe("not_established");
      }
      const moved = getEntry(p, "source.uo.bbr_filtration.presence")!;
      expect(moved.path).toBe("source.uo.bbr_filtration.presence");
      expect(moved.sourceIds).toEqual(["src-old1"]);
      expect(moved.recordedBy).toBe("Alex Example (fictional)");
      expect(moved.revision).toBe(1);
    });

    it("moves any other field of the old pre-filter item to the BBR filter item", () => {
      expect(resolveEntry(p, "source.uo.bbr_filtration.mat.bbr_filter.supplier")).toMatchObject({ status: "established", value: "Filter Vendor A (fictional)" });
      expect(getEntry(p, "source.uo.sterile_filtration.mat.prefilter.supplier")).toBeUndefined();
    });

    it("creates the unit with the new name and order, and renames the sterile filtration unit and its bioburden item", () => {
      const bbr = p.processes.source.unitOperations.bbr_filtration!;
      expect(bbr.label).toBe("Bioburden reduction (BBR) filtration");
      expect(bbr.sequence).toBe(25);
      const sterile = p.processes.source.unitOperations.sterile_filtration!;
      expect(sterile.label).toBe("Sterile filtration");
      expect(sterile.collections.mat.prefilter).toBeUndefined();
      expect(sterile.collections.ipc.bioburden!.label).toBe("Bioburden before the sterilizing filter");
      // The item that covers both steps stays in sterile filtration, with its value.
      expect(resolveEntry(p, "source.uo.sterile_filtration.ipc.bioburden.limit")).toMatchObject({ status: "established" });
    });

    it("moves the stored answer of the old question to the new question id", () => {
      expect(p.answers.map((a) => a.questionId)).toEqual(["bbr.presence"]);
    });

    it("moves gap overlays, reviewer comments and change log paths with the gap keys and entry paths", () => {
      expect(p.gapOverlays.find((o) => o.gapKey === "R-BBR-PRESENCE:uo.bbr_filtration.presence")).toMatchObject({ status: "in_progress", owner: "QA lead (fictional)" });
      expect(p.gapOverlays.find((o) => o.gapKey === "R-PUPSIT:uo.sterile_filtration.ipc.pupsit.status")).toMatchObject({ status: "accepted_no_action", notes: "Kept (fictional)." });
      // A key that did not move is left alone.
      expect(p.gapOverlays.some((o) => o.gapKey === "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple")).toBe(true);
      expect(p.gapOverlays.some((o) => o.gapKey.includes("prefilter"))).toBe(false);
      expect(p.document.comments.map((c) => c.anchor.gapKey)).toEqual([
        "R-BBR-PRESENCE:uo.bbr_filtration.presence",
        "R-PUPSIT:uo.sterile_filtration.ipc.pupsit.status",
      ]);
      expect(p.document.comments.map((c) => c.text)).toEqual(["Is the BBR filter still needed (fictional)?", "PUPSIT justification please (fictional)."]);
      expect(p.changeLog[0]!.path).toBe("source.uo.bbr_filtration.presence");
    });

    it("keeps the section confirmation of the sterile filtration section", () => {
      expect(p.interview.confirmations).toEqual([{ sectionId: "uo.sterile_filtration", side: "source", by: ACTOR.name, at: T0 }]);
    });
  });

  describe("PUPSIT moves out of the integrity tests answer", () => {
    it("an answer with pupsit becomes PUPSIT = performed, with the same sources and recorder, and pupsit leaves the tests", () => {
      const p = parseProject(oldProject({ sourceTests: ["pupsit", "post_use"] }));
      const e = getEntry(p, "source.uo.sterile_filtration.ipc.pupsit.status")!;
      expect(e).toMatchObject({ status: "established", value: "performed", sourceIds: ["src-old1"], recordedBy: "Alex Example (fictional)", recordedAt: T0, revision: 1 });
      expect(e.id).not.toBe(getEntry(p, "source.uo.sterile_filtration.ipc.integrity.tests")!.id);
      expect(resolveEntry(p, "source.uo.sterile_filtration.ipc.integrity.tests").value).toEqual(["post_use"]);
      expect(p.processes.source.unitOperations.sterile_filtration!.collections.ipc.pupsit!.label).toBe("Pre-use post-sterilization integrity test (PUPSIT)");
    });

    it("the old tests answer is no longer a verified one after pupsit was removed from it", () => {
      const p = parseProject(oldProject({ sourceTests: ["pupsit", "post_use"] }));
      expect(verificationState(p, "source.uo.sterile_filtration.ipc.integrity.tests").state).toBe("withdrawn");
    });

    it("an answer without pupsit leaves PUPSIT unanswered and invents no justification", () => {
      const p = parseProject(oldProject({ sourceTests: ["post_use"] }));
      expect(resolveEntry(p, "source.uo.sterile_filtration.ipc.pupsit.status").status).toBe("not_established");
      expect(resolveEntry(p, "source.uo.sterile_filtration.ipc.integrity.tests").value).toEqual(["post_use"]);
      expect(verificationState(p, "source.uo.sterile_filtration.ipc.integrity.tests").state).toBe("verified");
      const a = assess(content, p);
      expect(a.openItems.map((o) => o.ref)).toContain("source.uo.sterile_filtration.ipc.pupsit.status");
      expect(a.openItems.map((o) => o.ref)).toContain("target.uo.sterile_filtration.ipc.pupsit.status");
    });

    it("a target tests answer that is 'same as SU' follows the source's PUPSIT answer", () => {
      const p = parseProject(oldProject({ sourceTests: ["pupsit", "post_use"], targetSameAsSource: true }));
      const t = getEntry(p, "target.uo.sterile_filtration.ipc.pupsit.status")!;
      expect(t.sameAsSource).toBe(true);
      expect(resolveEntry(p, "target.uo.sterile_filtration.ipc.pupsit.status")).toMatchObject({ status: "established", value: "performed" });
      expect(resolveEntry(p, "target.uo.sterile_filtration.ipc.integrity.tests").value).toEqual(["post_use"]);
    });

    it("pupsit at the target only becomes performed at the target only", () => {
      const p = parseProject(oldProject({ sourceTests: ["post_use"], targetTests: ["pupsit", "post_use"] }));
      expect(resolveEntry(p, "source.uo.sterile_filtration.ipc.pupsit.status").status).toBe("not_established");
      expect(resolveEntry(p, "target.uo.sterile_filtration.ipc.pupsit.status")).toMatchObject({ status: "established", value: "performed" });
    });
  });

  describe("the dilution question and the buffer preparation unit start empty", () => {
    const p = parseProject(oldProject());
    const a = assess(content, p);

    it("scope.dilution is not answered and is an open scoping question", () => {
      expect(resolveEntry(p, "scope.dilution").status).toBe("not_established");
      expect(a.instances.some((i) => i.key === "scope.dilution@shared")).toBe(true);
    });

    it("no buffer preparation section or buffer entry appears, and nothing is reported inactive", () => {
      expect(a.instances.some((i) => i.section.id === "uo.buffer_prep")).toBe(false);
      expect(p.processes.source.unitOperations.buffer_prep).toBeUndefined();
      expect(a.inactive).toEqual([]);
    });

    it("the BBR filtration section shows, with the migrated answer in place", () => {
      expect(a.instances.some((i) => i.key === "bbr.presence@source")).toBe(true);
      expect(a.instances.some((i) => i.key === "bbr.membrane@source")).toBe(true);
    });

    it("the new PFS stopper questions are not established, and they stay hidden for the vial-less empty scope", () => {
      expect(resolveEntry(p, "source.uo.aseptic_filling.param.stopper_position.setPoint").status).toBe("not_established");
      expect(a.instances.some((i) => i.question.id.startsWith("fill.stopper_"))).toBe(false);
    });
  });

  it("a 1.5.0 file without a sterile filtration unit changes nothing but the version", () => {
    const raw = json(emptyProject({ title: "Plain old project (fictional)", actor: ACTOR, contentRefs: content.versions }));
    raw.schemaVersion = "1.5.0";
    const p = parseProject(raw);
    expect({ ...p, schemaVersion: "1.5.0" }).toEqual(raw);
  });
});
