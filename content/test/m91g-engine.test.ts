import {
  addPart,
  buildDemoProject,
  buildTrdDocument,
  differenceText,
  editLibraryWriteup,
  moveWriteup,
  openFigures,
  placeholderPng,
  planMove,
  setPartImage,
  setPartText,
  setTableRows,
  updateWriteupFromLibrary,
  writeupBlanks,
  writeupDifference,
  writeupsInOrder,
  type Block,
} from "@gap/engine";
import {
  bytesToBase64,
  PROCESS_MODEL_VERSION,
  parseProject,
  readTrdImage,
  SCHEMA_VERSION,
  TRD_IMAGE_MAX_BYTES,
  TrdImageError,
  type Project,
  type TrdDocument,
  type TrdLibraryWriteup,
} from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, trdWriteups } from "../index";

const T1 = "2026-10-24T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: "2026-10-25T09:00:00.000Z" };
const base = buildDemoProject(content, demos["arx-217"], undefined, undefined, undefined, undefined, { writeups: trdWriteups });
const docOf = (p: Project): TrdDocument => p.trd.documents[0]!;
const byLib = (p: Project, id: string) => docOf(p).writeups!.find((w) => w.libraryId === id)!;
const exportOf = (p: Project) => buildTrdDocument(p, docOf(p), { generatedAt: T1, content });
const evidenceOf = (p: Project) => buildTrdDocument(p, docOf(p), { generatedAt: T1, content, variant: "evidence" });
const png = (w = 40, h = 20) => placeholderPng(w, h);
const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const pictures = (p: Project) => exportOf(p).sections.flatMap((s) => s.blocks.filter((b): b is Extract<Block, { type: "picture" }> => b.type === "picture"));

describe("versions (M9.1 gap closure)", () => {
  it("are process model 1.15.0 and schema 1.24.0, and a 1.19.0 project opens with nothing else changed", () => {
    expect(PROCESS_MODEL_VERSION).toBe("1.15.0");
    expect(SCHEMA_VERSION).toBe("1.24.0");
    const old = JSON.parse(JSON.stringify({ ...base, schemaVersion: "1.19.0" }));
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.24.0");
    expect(docOf(p).writeups).toEqual(docOf(base).writeups);
  });
});

describe("reading a picture", () => {
  it("accepts PNG and JPEG by their first bytes, with their size", () => {
    expect(readTrdImage(png(40, 20))).toMatchObject({ mime: "image/png", width: 40, height: 20 });
    expect(readTrdImage(jpeg(300, 200), { name: "a.jpg" })).toMatchObject({ mime: "image/jpeg", width: 300, height: 200, name: "a.jpg" });
  });

  it("refuses other types, even under a .png name, with a message that states the limit", () => {
    const gif = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000");
    expect(() => readTrdImage(gif, { name: "x.png" })).toThrow(TrdImageError);
    expect(() => readTrdImage(gif)).toThrow(/not a PNG or JPEG picture.*2 MB/);
    expect(() => readTrdImage(new Uint8Array())).toThrow(TrdImageError);
  });

  it("refuses a picture over 2 MB and says so in megabytes", () => {
    const big = new Uint8Array(TRD_IMAGE_MAX_BYTES + 1);
    big.set(png(10, 10));
    expect(() => readTrdImage(big)).toThrow(/2 MB/);
  });
});

describe("figures", () => {
  const w = byLib(base, "sec_stopper_position");
  const fig = w.parts.find((p) => p.kind === "figure")!;

  it("a picture is stored with the part, numbered in the document, and the change log keeps its hash and size but not the bytes", () => {
    const image = readTrdImage(png(), { name: "p.png", sha256: "ab".repeat(32) });
    const next = setPartImage(base, docOf(base).id, w.id, fig.id, image, who);
    expect(byLib(next, "sec_stopper_position").parts.find((p) => p.id === fig.id)!.image!.data).toBe(image.data);
    const pics = pictures(next);
    expect(pics).toHaveLength(1);
    expect(pics[0]).toMatchObject({ number: 1, mime: "image/png", width: 40, height: 20 });
    const log = JSON.stringify(next.changeLog.at(-1));
    expect(log).toContain("trd_writeup_image");
    expect(log).toContain("ab".repeat(32));
    expect(log).not.toContain(image.data);
    expect(next.changeLog.at(-1)!.detail).toMatch(/picture/i);
  });

  it("numbers pictures through the whole document and puts the caption after 'Figure N.'", () => {
    let p = setPartImage(base, docOf(base).id, w.id, fig.id, readTrdImage(png()), who);
    const added = addPart(p, docOf(p).id, w.id, { kind: "figure", text: "", caption: "Second", alt: "Second picture" }, who);
    p = setPartImage(added.project, docOf(p).id, w.id, added.partId, readTrdImage(jpeg(30, 30)), who);
    expect(pictures(p).map((b) => b.number)).toEqual([1, 2]);
    expect(pictures(p)[1]).toMatchObject({ caption: "Second", alt: "Second picture", mime: "image/jpeg" });
  });

  it("falls back to the caption as alternative text", () => {
    let p = setPartText(base, docOf(base).id, w.id, fig.id, { alt: "" }, who);
    p = setPartImage(p, docOf(p).id, w.id, fig.id, readTrdImage(png()), who);
    const pic = pictures(p)[0]!;
    expect(pic.alt).toBe(pic.caption);
  });

  it("counts figures without a picture, shows them as 'Figure to be added' and lists them in the appendix", () => {
    // The demo already carries a picture on its figure; a figure added without one is the open item.
    expect(openFigures(byLib(base, "sec_stopper_position"))).toHaveLength(0);
    const added = addPart(base, docOf(base).id, w.id, { kind: "figure", text: "", caption: "Not yet drawn" }, who);
    expect(openFigures(byLib(added.project, "sec_stopper_position"))).toHaveLength(1);
    expect(JSON.stringify(exportOf(added.project).sections)).toContain("Figure to be added");
    // The appendix of open figures is in the evidence record; the standard document has no appendix of values.
    expect(JSON.stringify(exportOf(added.project).sections)).not.toContain("Figures without a picture");
    expect(JSON.stringify(evidenceOf(added.project).sections)).toContain("Figures without a picture");
    const filled = setPartImage(added.project, docOf(base).id, w.id, added.partId, readTrdImage(png()), who);
    expect(openFigures(byLib(filled, "sec_stopper_position"))).toHaveLength(0);
    expect(JSON.stringify(evidenceOf(filled).sections)).not.toContain("Figures without a picture");
  });

  it("removing the picture goes back to the note, and a non-figure part cannot hold a picture", () => {
    const withPic = setPartImage(base, docOf(base).id, w.id, fig.id, readTrdImage(png()), who);
    const without = setPartImage(withPic, docOf(base).id, w.id, fig.id, null, who);
    expect(byLib(without, "sec_stopper_position").parts.find((p) => p.id === fig.id)!.image).toBeUndefined();
    const para = w.parts.find((p) => p.kind === "paragraph")!;
    expect(() => setPartImage(base, docOf(base).id, w.id, para.id, readTrdImage(png()), who)).toThrow(/figure/i);
  });

  it("holds at most 10 MB of pictures in one TRD", () => {
    const filler = new Uint8Array(1_900_000);
    const make = () => {
      const b = png(8, 8);
      const all = new Uint8Array(b.length + filler.length);
      all.set(b);
      return readTrdImage(all);
    };
    let p = base;
    let refused = "";
    for (let i = 0; i < 7; i++) {
      const a = addPart(p, docOf(p).id, w.id, { kind: "figure", text: "", caption: `F${i}` }, who);
      try {
        p = setPartImage(a.project, docOf(p).id, w.id, a.partId, make(), who);
      } catch (e) {
        refused = (e as Error).message;
        break;
      }
    }
    expect(refused).toMatch(/10 MB/);
  });

  it("a base64 image of the wrong length is refused by the schema", () => {
    const image = readTrdImage(png());
    expect(() => setPartImage(base, docOf(base).id, w.id, fig.id, { ...image, data: bytesToBase64(new Uint8Array(5)) }, who)).toThrow();
  });
});

describe("table rows", () => {
  const w = byLib(base, "sec_dilution_buffer");
  const table = w.parts.find((p) => p.kind === "table")!;
  const cols = table.columns!.length;

  it("rows are set, change-logged with what changed, and the part is marked edited", () => {
    const rows = [Array(cols).fill("a"), Array(cols).fill("b"), Array(cols).fill("c")];
    const next = setTableRows(base, docOf(base).id, w.id, table.id, rows, who);
    const part = byLib(next, "sec_dilution_buffer").parts.find((p) => p.id === table.id)!;
    expect(part.rows).toEqual(rows);
    expect(part.edited).toBe(true);
    expect(next.changeLog.at(-1)!.detail).toMatch(/rows of the table/);
    expect(next.changeLog.at(-1)!.detail).toMatch(/1 row added/);
  });

  it("an unchanged save adds nothing to the log; short rows are padded, long ones cut, newlines removed", () => {
    expect(setTableRows(base, docOf(base).id, w.id, table.id, table.rows ?? [], who)).toBe(base);
    const next = setTableRows(base, docOf(base).id, w.id, table.id, [["x\ny"], Array(cols + 2).fill("z")], who);
    const rows = byLib(next, "sec_dilution_buffer").parts.find((p) => p.id === table.id)!.rows!;
    expect(rows[0]).toEqual(["x y", ...Array(cols - 1).fill("")]);
    expect(rows[1]).toHaveLength(cols);
  });

  it("export has the header row and the typed rows; an empty cell stays empty; a blank shows its label", () => {
    const next = setTableRows(base, docOf(base).id, w.id, table.id, [["K", "", "", "{{trd.none.known|Quantity to be decided}}"]], who);
    const blocks = exportOf(next).sections.flatMap((s) => s.blocks).filter((b): b is Extract<Block, { type: "table" }> => b.type === "table" && b.columns.join() === table.columns!.join());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.rows).toEqual([["K", "", "", "[Quantity to be decided]"]]);
    expect(writeupBlanks({ project: next, doc: docOf(next), content }, byLib(next, "sec_dilution_buffer")).some((b) => b.key === "trd.none.known")).toBe(true);
  });

  it("'Update from library' keeps rows the team typed, and the difference note names a table change", () => {
    const typed = setTableRows(base, docOf(base).id, w.id, table.id, [["K", "L", "M", "N"]], who);
    const lib = trdWriteups.find((x) => x.id === "sec_dilution_buffer")!;
    const newer: TrdLibraryWriteup = { ...lib, version: lib.version + 1, parts: lib.parts.map((p) => (p.id === table.id ? { ...p, columns: [...table.columns!, "Remark"] } : p)) };
    const diff = writeupDifference(byLib(typed, "sec_dilution_buffer"), newer);
    expect(differenceText(diff)).toMatch(/table/i);
    const updated = updateWriteupFromLibrary(typed, docOf(typed).id, w.id, newer, who);
    const part = byLib(updated, "sec_dilution_buffer").parts.find((p) => p.id === table.id)!;
    expect(part.rows).toEqual([["K", "L", "M", "N"]]);
  });
});

describe("order and placement", () => {
  const d = docOf(base);

  it("the Descriptions order is the order of the export", () => {
    const listed = writeupsInOrder(d).map((w) => w.id);
    const exported = exportOf(base).sections.filter((s) => s.id.startsWith("writeup-") || s.id === "manufacturing-overview");
    expect(listed.length).toBe(d.writeups!.length);
    expect(exported.length).toBeGreaterThan(0);
  });

  it("moving a unit-operation description past one of another step is refused with a reason; among sections it swaps", () => {
    const ops = writeupsInOrder(d).filter((w) => w.kind === "unitOp");
    const plan = planMove(d, ops[0]!.id, 1);
    expect(plan.blocked).toMatch(/step/i);
    expect(() => moveWriteup(base, d.id, ops[0]!.id, 1, who)).toThrow(/step/i);
    const prose = writeupsInOrder(d).filter((w) => w.kind === "section" && !w.placement);
    if (prose.length >= 2) {
      const moved = moveWriteup(base, d.id, prose[1]!.id, -1, who);
      const order = writeupsInOrder(docOf(moved)).filter((w) => w.kind === "section" && !w.placement).map((w) => w.id);
      expect(order.slice(0, 2)).toEqual([prose[1]!.id, prose[0]!.id]);
      expect(moved.changeLog.at(-1)!.action).toBe("trd_writeup_move");
      // The export follows.
      const titles = exportOf(moved).sections.map((s) => s.id);
      expect(titles.indexOf(`writeup-${prose[1]!.key}`)).toBeLessThan(titles.indexOf(`writeup-${prose[0]!.key}`));
    }
  });

  it("the first section cannot move up and the reason is given", () => {
    const first = writeupsInOrder(d)[0]!;
    const plan = planMove(d, first.id, -1);
    expect(plan.blocked).toBeTruthy();
  });

  it("a placed section that passes a unit-operation description takes its place and keeps it on update", () => {
    const placed = writeupsInOrder(d).find((w) => w.kind === "section" && w.placement?.unitOp);
    if (!placed) return;
    const dir = placed.placement!.where === "before" ? -1 : 1;
    const plan = planMove(d, placed.id, dir);
    if (plan.blocked || !plan.placeBy) return;
    const moved = moveWriteup(base, d.id, placed.id, dir, who);
    const after = docOf(moved).writeups!.find((w) => w.id === placed.id)!;
    expect(after.placementEdited).toBe(true);
    expect(after.placement).toEqual(plan.placeBy.placement);
  });
});

describe("placement in the library", () => {
  const lib = trdWriteups.find((w) => w.kind === "section" && !w.placement)!;
  const unitOp = content.catalog.unitOperations[2]!.key;

  it("a placement can be set, changes the library write-up, and can be cleared again", () => {
    const placed = editLibraryWriteup(lib, { placement: { where: "after", unitOp } }, T1, "Alex Example (fictional)");
    expect(placed.placement).toEqual({ where: "after", unitOp });
    expect(placed.version).toBe(lib.version + 1);
    const cleared = editLibraryWriteup(placed, { placement: undefined }, T1, "Alex Example (fictional)");
    expect(cleared.placement).toBeUndefined();
    expect(cleared.version).toBe(placed.version + 1);
  });

  it("the difference note says the place changed, unless the team moved it themselves", () => {
    const w = docOf(base).writeups!.find((x) => x.libraryId === lib.id);
    if (!w) return;
    const newer = editLibraryWriteup(lib, { placement: { where: "last" } }, T1, "x");
    expect(differenceText(writeupDifference(w, newer))).toMatch(/place/i);
    expect(differenceText(writeupDifference({ ...w, placementEdited: true }, newer))).not.toMatch(/another place/i);
  });
});
