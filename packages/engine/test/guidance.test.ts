import { describe, expect, it } from "vitest";
import {
  filterGuidance,
  groupGuidance,
  guidanceAgencies,
  isGuidanceFilterEmpty,
  needsConfirmation,
  type GuidanceItem,
} from "@gap/engine";

const base: GuidanceItem = {
  id: "x",
  jurisdiction: "US",
  agency: "US FDA",
  title: "Sterile Drug Products Produced by Aseptic Processing",
  reference: "FDA 2004",
  type: "guidance",
  status: "final",
  date: "2004-09",
  language: "en",
  access: "free",
  url: "https://www.fda.gov/x",
  topics: ["aseptic", "gmp"],
  verified: "ok",
  notes: "",
};
const item = (o: Partial<GuidanceItem>): GuidanceItem => ({ ...base, ...o });

const items: GuidanceItem[] = [
  item({ id: "a", title: "Aseptic processing guidance" }),
  item({ id: "b", jurisdiction: "EU", agency: "European Commission (EudraLex)", title: "Annex 1 Manufacture of Sterile Medicinal Products", reference: "EudraLex Vol 4 Annex 1", type: "annex", status: "draft", topics: ["aseptic", "cci"], notes: "Draft revision. confirm status." }),
  item({ id: "c", jurisdiction: "ICH", agency: "ICH", title: "Q12 lifecycle management", reference: "ICH Q12", type: "guideline", topics: ["changes"] }),
  item({ id: "d", jurisdiction: "US", title: "Old text", status: "superseded", topics: ["gmp"] }),
];
const ids = (l: GuidanceItem[]) => l.map((i) => i.id);

describe("filterGuidance", () => {
  it("returns everything, in file order, when nothing is set", () => {
    expect(ids(filterGuidance(items, {}))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterGuidance(items, { text: "  ", jurisdiction: "all", topic: "" }))).toEqual(["a", "b", "c", "d"]);
  });

  it("searches title, reference, agency and notes without regard to case", () => {
    expect(ids(filterGuidance(items, { text: "ANNEX" }))).toEqual(["b"]);
    expect(ids(filterGuidance(items, { text: "ich q12" }))).toEqual(["c"]);
    expect(ids(filterGuidance(items, { text: "eudralex" }))).toEqual(["b"]);
    expect(ids(filterGuidance(items, { text: "draft revision" }))).toEqual(["b"]);
  });

  it("needs every typed word, in any order", () => {
    expect(ids(filterGuidance(items, { text: "sterile annex" }))).toEqual(["b"]);
    expect(filterGuidance(items, { text: "annex xyz" })).toEqual([]);
  });

  it("does not search topics or the url", () => {
    expect(filterGuidance(items, { text: "fda.gov" })).toEqual([]);
  });

  it("filters by jurisdiction, agency, topic, type and status, and combines them", () => {
    expect(ids(filterGuidance(items, { jurisdiction: "US" }))).toEqual(["a", "d"]);
    expect(ids(filterGuidance(items, { agency: "ICH" }))).toEqual(["c"]);
    expect(ids(filterGuidance(items, { topic: "aseptic" }))).toEqual(["a", "b"]);
    expect(ids(filterGuidance(items, { type: "annex" }))).toEqual(["b"]);
    expect(ids(filterGuidance(items, { status: "superseded" }))).toEqual(["d"]);
    expect(ids(filterGuidance(items, { topic: "gmp", jurisdiction: "US", status: "final" }))).toEqual(["a"]);
    expect(filterGuidance(items, { jurisdiction: "ICH", topic: "cci" })).toEqual([]);
  });
});

describe("helpers", () => {
  it("reports whether a filter is empty", () => {
    expect(isGuidanceFilterEmpty({})).toBe(true);
    expect(isGuidanceFilterEmpty({ text: " ", type: "all" })).toBe(true);
    expect(isGuidanceFilterEmpty({ text: "a" })).toBe(false);
    expect(isGuidanceFilterEmpty({ status: "draft" })).toBe(false);
  });

  it("flags items whose notes ask for confirmation", () => {
    expect(needsConfirmation(item({ notes: "Opens in a browser. Confirm final status." }))).toBe(true);
    expect(needsConfirmation(item({ notes: "date to confirm" }))).toBe(true);
    expect(needsConfirmation(item({ notes: "Updated continuously." }))).toBe(false);
  });

  it("groups by jurisdiction in the fixed display order and skips empty groups", () => {
    const groups = groupGuidance([items[2]!, items[1]!, items[3]!, items[0]!]);
    expect(groups.map((g) => g.jurisdiction)).toEqual(["US", "ICH", "EU"]);
    expect(groups[0]!.label).toBe("United States");
    expect(ids(groups[0]!.items)).toEqual(["d", "a"]);
  });

  it("lists the distinct agencies alphabetically", () => {
    expect(guidanceAgencies(items)).toEqual(["European Commission (EudraLex)", "ICH", "US FDA"]);
  });
});
