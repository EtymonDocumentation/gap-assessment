import { describe, expect, it } from "vitest";
import { countOf, projectFileStem } from "../src/lib";

// Tester D row 28: downloaded files start with the project title (file-name safe); the id only when there is no usable title.
describe("projectFileStem", () => {
  it("uses the project title in file-name-safe form", () => {
    expect(projectFileStem({ title: "ARX-217 transfer (fictional)", id: "P-3" })).toBe("arx-217-transfer-fictional");
  });

  it("falls back to the id when the title is empty or has no letters or digits", () => {
    expect(projectFileStem({ title: "", id: "P-3" })).toBe("p-3");
    expect(projectFileStem({ title: "  ... ", id: "P-3" })).toBe("p-3");
  });

  it("never returns an empty stem", () => {
    expect(projectFileStem({ title: "", id: "" })).toBe("project");
  });
});

// Tester D row 30: a count never reads "1 rows" or "1 activitys"; the unusual plural is given by the caller.
describe("countOf", () => {
  it("uses the singular for exactly one and the plural for everything else, zero included", () => {
    expect(countOf(1, "row")).toBe("1 row");
    expect(countOf(2, "row")).toBe("2 rows");
    expect(countOf(0, "row")).toBe("0 rows");
  });

  it("takes the plural from the caller when it is not just an 's'", () => {
    expect(countOf(1, "activity", "activities")).toBe("1 activity");
    expect(countOf(2, "activity", "activities")).toBe("2 activities");
  });
});
