import { describe, expect, it } from "vitest";
import { pageTrail } from "../src/page-trail";

/** The words above each page title: "Project name > Area > Page". The project name is added by the header, so the table has the rest. */
describe("breadcrumb trail of each page", () => {
  it("has no trail for Home or for a route that does not exist", () => {
    expect(pageTrail("/")).toBeUndefined();
    expect(pageTrail("/no-such-page")).toBeUndefined();
  });

  it("puts a page of the open project under the project and its menu area", () => {
    const t = pageTrail("/register")!;
    expect(t.project).toBe(true);
    expect(t.parts.map((p) => p.label)).toEqual(["Documents", "Gap assessment", "Gap register"]);
    // Earlier parts link to a page where one exists; the last part is the page itself and is plain text.
    expect(t.parts[1]!.path).toBe("/scope");
    expect(t.parts.at(-1)!.path).toBeUndefined();
  });

  it("leaves the project out of the libraries, which belong to the browser", () => {
    for (const path of ["/templates", "/guidance", "/saved-answers", "/trd/writeups", "/sampling/tables", "/sampling/subsections", "/mbr/library", "/risk/methods"]) {
      expect(pageTrail(path)!.project, path).toBe(false);
    }
    expect(pageTrail("/sources")!.project).toBe(true);
  });

  it("links each module library back to its module", () => {
    const back = (path: string) => pageTrail(path)!.parts.find((p) => p.path)!;
    expect(back("/trd/writeups")).toEqual({ label: "TRD", path: "/trd" });
    expect(back("/sampling/tables")).toEqual({ label: "Sampling plan", path: "/sampling" });
    expect(back("/mbr/library")).toEqual({ label: "Batch record", path: "/mbr" });
    expect(back("/risk/methods")).toEqual({ label: "Risk assessment", path: "/risk" });
  });

  it("names the Process view under the batch record, and the heading placement under Templates", () => {
    expect(pageTrail("/mbr/view")!.parts.map((p) => p.label)).toEqual(["Documents", "Batch record"]);
    expect(pageTrail("/mbr/view")!.parts[1]!.path).toBe("/mbr");
    const mapping = pageTrail("/templates/abc-123/mapping")!;
    expect(mapping.project).toBe(false);
    expect(mapping.parts.map((p) => p.label)).toEqual(["Library", "Templates", "Heading placement"]);
    expect(mapping.parts[1]!.path).toBe("/templates");
  });

  it("Version history and the Change log are the open project's, not the Library's (EOU-36)", () => {
    for (const [path, label] of [["/versions", "Version history"], ["/changes", "Change log"]] as const) {
      const t = pageTrail(path)!;
      expect(t.project).toBe(true);
      expect(t.parts.map((p) => p.label)).toEqual([label]);
    }
    expect(pageTrail("/stage-review")!.parts.map((p) => p.label)).toEqual(["Version history", "Stage review"]);
  });

  it("gives the Open items page the same kind of trail as the other pages, under Documents", () => {
    // The page used to have no header; the menu lists it under Documents ("Alongside"), so the trail does too.
    const t = pageTrail("/tbd")!;
    expect(t.project).toBe(true);
    expect(t.parts.map((p) => p.label)).toEqual(["Documents", "Open items"]);
    expect(t.parts.at(-1)!.path).toBeUndefined();
  });

  it("gives the old model address the Builder trail", () => {
    expect(pageTrail("/model")).toEqual(pageTrail("/builder"));
  });

  it("never lets a link carry the same words as the page it is on", () => {
    for (const path of ["/scope", "/interview", "/compare", "/register", "/validation", "/document", "/trd", "/sampling", "/mbr", "/risk", "/templates", "/guidance"]) {
      const parts = pageTrail(path)!.parts;
      const last = parts.at(-1)!;
      expect(parts.slice(0, -1).some((p) => p.label === last.label), path).toBe(false);
    }
  });
});
