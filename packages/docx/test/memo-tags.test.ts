/// <reference types="node" />
import { buildCmoInstructionsDocument, buildDemoProject, buildSamplingPlanDocument, partyTags, setParties } from "@gap/engine";
import type { Actor, SamplingPlan } from "@gap/process-model";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../../../content/index";
import { TAG_REFERENCE, buildDocumentTagData, buildSamplingTagData, importTemplateFile, renderDocx, tagReferenceMarkdown } from "../src/index";
import { restoreFirstPageHeader } from "../src/inspect";
import { GENERATED_AT, buildModel, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };

const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
const plan = project.sampling.plans[0]!;

/** The fictional Brightwater look with its body replaced by the given paragraphs. */
function tagDoc(...paragraphs: string[]): Uint8Array {
  const zip = new PizZip(fixture("brightwater-template.docx"));
  const xml = zip.file("word/document.xml")!.asText();
  zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${paragraphs.join("")}$1`));
  return zip.generate({ type: "uint8array" });
}

async function renderSampling(bytes: Uint8Array, kind: "plan" | "cmo" = "plan") {
  const t = await importTemplateFile("memo.docx", bytes);
  const doc = (kind === "plan" ? buildSamplingPlanDocument : buildCmoInstructionsDocument)(content, project, plan, samplingSuggestions, opts);
  const out = await renderDocx({
    doc,
    tagData: buildSamplingTagData(doc, project, plan),
    mode: "tags",
    generatedAt: GENERATED_AT,
    template: { name: "Memo test (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis },
  });
  return { out, text: plainText(strictDocx(out.bytes)), analysis: t.analysis };
}

describe("memo parties as template tags", () => {
  it("lists the parties and the From / To / Cc groups the person chose, and nothing else", () => {
    const tags = partyTags(plan);
    expect(tags.parties.map((p) => p.name)).toEqual(plan.parties.map((p) => p.name));
    expect(tags.fromParties.map((p) => p.name)).toEqual(["Alex Example (fictional)", "Sam Sample (fictional)"]);
    expect(tags.toParties.map((p) => p.name)).toEqual(["Site South manufacturing (fictional)"]);
    expect(tags.ccParties.map((p) => p.name)).toEqual(["Example Test Laboratory (fictional)"]);
    expect(tags.fromParties[0]).toEqual({
      party: "Sponsor",
      name: "Alex Example (fictional)",
      role: "Technology transfer lead",
      department: "Process Validation (fictional)",
      memoLine: "From",
      line: "Alex Example (fictional), Technology transfer lead, Process Validation (fictional)",
    });
    expect(tags.fromText).toBe("Alex Example (fictional), Technology transfer lead, Process Validation (fictional); Sam Sample (fictional), Validation engineer, Process Validation (fictional)");
    expect(tags.cmoName).toBe("Site South manufacturing (fictional)");
    expect(tags.sponsorName).toBe("Alex Example (fictional), Sam Sample (fictional)");
  });

  it("chooses no memo line for anyone: a party with no line is only in {#parties}, and empty lists say so visibly", () => {
    const who: Actor = { name: "Pat Placeholder (fictional)", at: "2026-10-06T09:00:00.000Z" };
    const p2 = setParties(project, plan.id, [{ party: "cmo", name: "Site South (fictional)" }, { party: "sponsor", name: "Pat (fictional)", department: "  " }], who);
    const pl = p2.sampling.plans[0]!;
    expect(pl.parties[1]).toEqual({ party: "sponsor", name: "Pat (fictional)" });
    const t = partyTags(pl);
    expect(t.parties).toHaveLength(2);
    expect([t.fromParties, t.toParties, t.ccParties]).toEqual([[], [], []]);
    expect([t.fromText, t.toText, t.ccText]).toEqual(["[none chosen]", "[none chosen]", "[none chosen]"]);
    expect(t.parties[1]!.line).toBe("Pat (fictional)");
    expect(t.parties[0]!.memoLine).toBe("");
    const none = partyTags({ ...pl, parties: [] } as SamplingPlan);
    expect(none.cmoName).toBe("[no CMO named]");
    expect(none.sponsorName).toBe("[no sponsor named]");
  });

  it("adds the sending unit and receiving site from the project's two sites", () => {
    const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    const data = buildSamplingTagData(doc, project, plan);
    const gap = buildModel().tagData;
    expect(data.sendingUnit).toBe(gap.sourceSite);
    expect(data.receivingSite).toBe(gap.targetSite);
    expect(data.sendingUnit).not.toBe("");
    // The gap tag data carries them too, and the other documents carry empty party loops (an empty loop prints nothing).
    expect(gap.sendingUnit).toBe(gap.sourceSite);
    expect(gap.parties).toEqual([]);
    expect(buildDocumentTagData(doc).fromParties).toEqual([]);
  });

  it("documents every new tag in the tag reference and its Markdown", () => {
    const md = tagReferenceMarkdown();
    for (const t of ["sendingUnit", "receivingSite", "cmoName", "sponsorName", "fromText", "toText", "ccText"]) {
      expect(TAG_REFERENCE.find((x) => x.tag === t)?.kind, t).toBe("text");
      expect(md).toContain(`{${t}}`);
    }
    for (const t of ["parties", "fromParties", "toParties", "ccParties"]) {
      const e = TAG_REFERENCE.find((x) => x.tag === t);
      expect(e?.kind, t).toBe("loop");
      expect(e!.fields!.map((f) => f.name)).toEqual(["party", "name", "role", "department", "memoLine", "line"]);
      expect(md).toContain(`{#${t}}`);
    }
  });

  const memo = () =>
    tagDoc(
      P("From: {fromText}"),
      P("To: {toText}"),
      P("Cc: {ccText}"),
      P("{#fromParties}"),
      P("FROMROW {name} | {role} | {department} | {party} | {memoLine}"),
      P("{/fromParties}"),
      P("{#toParties}"),
      P("TOROW {line}"),
      P("{/toParties}"),
      P("{#ccParties}"),
      P("CCROW {line}"),
      P("{/ccParties}"),
      P("{#parties}"),
      P("ALL {name} / {department}"),
      P("{/parties}"),
      P("Sending {sendingUnit}; receiving {receivingSite}; CMO {cmoName}; sponsor {sponsorName}"),
    );

  it("accepts the new tags in the unknown-tag check", async () => {
    const t = await importTemplateFile("memo.docx", memo());
    expect(t.analysis.tags!.errors).toEqual([]);
    expect(t.analysis.tags!.unknown).toEqual([]);
    const bad = await importTemplateFile("bad.docx", tagDoc(P("{#parties}"), P("{name} {nonsense}"), P("{/parties}")));
    expect(bad.analysis.tags!.unknown.join(" ")).toContain("nonsense");
  });

  it("fills a memo from the sampling plan and from the CMO instructions", async () => {
    for (const kind of ["plan", "cmo"] as const) {
      const { text, out } = await renderSampling(memo(), kind);
      expect(text, kind).toContain("From: Alex Example (fictional), Technology transfer lead, Process Validation (fictional); Sam Sample (fictional)");
      expect(text).toContain("To: Site South manufacturing (fictional), Takes the samples and writes the PPQ summary report, Manufacturing Sciences (fictional)");
      expect(text).toContain("Cc: Example Test Laboratory (fictional), Tests the samples");
      expect(text).toContain("FROMROW Alex Example (fictional) | Technology transfer lead | Process Validation (fictional) | Sponsor | From");
      expect(text).toContain("FROMROW Sam Sample (fictional) | Validation engineer");
      expect(text).toContain("TOROW Site South manufacturing (fictional)");
      expect(text).toContain("CCROW Example Test Laboratory (fictional), Tests the samples");
      expect(text.match(/ALL /g)).toHaveLength(plan.parties.length);
      expect(text).toContain("CMO Site South manufacturing (fictional); sponsor Alex Example (fictional), Sam Sample (fictional)");
      expect(text).not.toContain("not available");
      expect(out.warnings.join(" ")).not.toMatch(/not in the tag reference/);
    }
  });

  it("shows [none chosen] for a memo line nobody was put on, and prints no rows", async () => {
    const t = await importTemplateFile("memo.docx", tagDoc(P("Cc: {ccText}"), P("{#ccParties}"), P("CCROW {name}"), P("{/ccParties}")));
    const p2 = setParties(project, plan.id, plan.parties.map(({ memoLine: _m, ...rest }) => rest), { name: "Pat Placeholder (fictional)", at: "2026-10-06T09:00:00.000Z" });
    const pl = p2.sampling.plans[0]!;
    const doc = buildSamplingPlanDocument(content, p2, pl, samplingSuggestions, opts);
    const out = await renderDocx({ doc, tagData: buildSamplingTagData(doc, p2, pl), mode: "tags", generatedAt: GENERATED_AT, template: { name: "t", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis } });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Cc: [none chosen]");
    expect(text).not.toContain("CCROW");
  });

  it("gives the gap assessment's tag data the same names, so a shared template never breaks", () => {
    expect(Object.keys(buildModel().tagData)).toEqual(expect.arrayContaining(["parties", "fromParties", "toParties", "ccParties", "sendingUnit", "receivingSite"]));
  });
});

// ------------------------------------------------------------------ first-page-only header

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal template built here (no client file): a default header, a first-page header, {title} and {@body}. */
function firstPageTemplate(firstPageOnly: boolean): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/><Relationship Id="rId2" Type="${R}/header" Target="header2.xml"/></Relationships>`,
  );
  zip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}"><w:p><w:r><w:t>DEFAULT HEADER (fictional)</w:t></w:r></w:p></w:hdr>`);
  zip.file("word/header2.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}"><w:p><w:r><w:t>FIRST PAGE HEADER (fictional)</w:t></w:r></w:p></w:hdr>`);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${P("{title}")}${P("{@body}")}<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:headerReference w:type="first" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>${firstPageOnly ? "<w:titlePg/>" : ""}</w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array" });
}

const sectPrs = (xml: string) => [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map((m) => m[0]);

describe("a first-page-only header survives the sections the tool adds", () => {
  const model = buildModel();

  async function render(firstPageOnly: boolean) {
    const t = await importTemplateFile("first.docx", firstPageTemplate(firstPageOnly));
    const out = await renderDocx({ doc: model.doc, tagData: model.tagData, mode: "tags", generatedAt: GENERATED_AT, template: { name: "First page (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis } });
    const res = strictDocx(out.bytes);
    return { res, sects: sectPrs(res.text("word/document.xml")) };
  }

  it("gives the first section titlePg and its first-page header, and takes it off the last section", async () => {
    const { res, sects } = await render(true);
    // The wide gap table gets a landscape section of its own, so there are at least three sections.
    expect(sects.length).toBeGreaterThanOrEqual(3);
    expect(sects[0]).toContain("<w:titlePg/>");
    expect(sects[0]).toContain('w:type="first"');
    expect(sects[0]).toContain('w:type="default"');
    expect(sects[0]).not.toContain("landscape");
    // Later sections behave as an ordinary section: no different first page, so the first-page header is not repeated.
    for (const s of sects.slice(1)) expect(s).not.toContain("titlePg");
    // The header parts are still in the package and the text is still there.
    expect(plainText(res, "word/header2.xml")).toContain("FIRST PAGE HEADER (fictional)");
    expect(plainText(res, "word/header1.xml")).toContain("DEFAULT HEADER (fictional)");
    // titlePg stands in its schema position (after the page layout), so Word accepts the section.
    expect(sects[0]!.indexOf("<w:titlePg/>")).toBeGreaterThan(sects[0]!.indexOf("<w:pgMar"));
  });

  it("adds no titlePg to a template that has none", async () => {
    const { sects } = await render(false);
    expect(sects.length).toBeGreaterThanOrEqual(3);
    for (const s of sects) expect(s).not.toContain("titlePg");
  });

  it("leaves a document with one section, and a template's own earlier sections, as they are", () => {
    const portrait = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
    const fp = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:titlePg/></w:sectPr>';
    const sp = { portrait, landscape: "<w:sectPr/>" };
    const single = `<w:body>${fp}</w:body>`;
    expect(restoreFirstPageHeader(single, sp)).toBe(single);
    const ownFirst = `<w:body><w:p><w:pPr><w:sectPr><w:pgSz w:w="1" w:h="2"/></w:sectPr></w:pPr></w:p>${portrait}${fp}</w:body>`;
    expect(restoreFirstPageHeader(ownFirst, sp)).toBe(ownFirst);
    expect(restoreFirstPageHeader(`<w:body>${portrait}${fp}</w:body>`, undefined)).toBe(`<w:body>${portrait}${fp}</w:body>`);
    const moved = restoreFirstPageHeader(`<w:body>${portrait}${fp}</w:body>`, sp);
    expect(sectPrs(moved)).toEqual(['<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:titlePg/></w:sectPr>', '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>']);
  });
});
