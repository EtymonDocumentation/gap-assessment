import {
  GUIDANCE_JURISDICTIONS,
  GUIDANCE_STATUSES,
  GUIDANCE_TOPICS,
  GUIDANCE_TYPES,
  OFFICIAL_GUIDANCE_HOSTS,
  parseGuidance,
} from "@gap/engine";
import { describe, expect, it } from "vitest";
import { guidance } from "../index";

describe("guidance library content", () => {
  const items = guidance.items;

  it("has a version, a last-checked date and the researched items", () => {
    expect(guidance.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(guidance.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(items.length).toBe(162);
  });

  it("has unique ids and unique urls", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const urls = items.map((i) => i.url);
    expect(urls.filter((u, n) => urls.indexOf(u) !== n)).toEqual([]);
  });

  it("links only over https, to official hosts", () => {
    for (const it of items) {
      for (const u of [it.url, it.pdf].filter((x): x is string => !!x)) {
        expect(u.startsWith("https://"), `${it.id}: ${u}`).toBe(true);
        expect(OFFICIAL_GUIDANCE_HOSTS as readonly string[], `${it.id}: ${u}`).toContain(new URL(u).host);
      }
    }
  });

  it("keeps the official-host list free of hosts no item uses", () => {
    const used = new Set(items.flatMap((i) => [i.url, i.pdf]).filter((x): x is string => !!x).map((u) => new URL(u).host));
    expect([...OFFICIAL_GUIDANCE_HOSTS].filter((h) => !used.has(h))).toEqual([]);
    expect(new Set(OFFICIAL_GUIDANCE_HOSTS).size).toBe(OFFICIAL_GUIDANCE_HOSTS.length);
  });

  it("uses only the known jurisdictions, types, statuses and topics, and every one of them is in use", () => {
    expect([...new Set(items.map((i) => i.jurisdiction))].sort()).toEqual([...GUIDANCE_JURISDICTIONS].sort());
    expect([...new Set(items.map((i) => i.type))].sort()).toEqual([...GUIDANCE_TYPES].sort());
    expect([...new Set(items.map((i) => i.status))].sort()).toEqual([...GUIDANCE_STATUSES].sort());
    expect([...new Set(items.flatMap((i) => i.topics))].sort()).toEqual([...GUIDANCE_TOPICS].sort());
  });

  it("has every required field filled in (a date or notes may be empty on purpose)", () => {
    for (const it of items) {
      for (const k of ["id", "agency", "title", "reference", "language", "url"] as const) expect(it[k].trim(), `${it.id}.${k}`).not.toBe("");
      expect(it.topics.length, it.id).toBeGreaterThan(0);
    }
  });

  it("contains no machine or path wording in the notes shown to readers", () => {
    for (const it of items) expect(it.notes, it.id).not.toMatch(/this machine|[A-Z]:\\|WebFetch|curl/i);
  });
});

describe("guidance schema", () => {
  const good = () => structuredClone({ version: "1.0.0", checked: "2026-01-01", items: [guidance.items[0]!] });

  it("accepts a valid file", () => {
    expect(parseGuidance(good()).items).toHaveLength(1);
  });

  it("rejects an http link, an unofficial host, an unknown topic and a missing field, naming the item", () => {
    const http = good();
    http.items[0]!.url = http.items[0]!.url.replace("https://", "http://");
    expect(() => parseGuidance(http)).toThrow(/us-21cfr210.*url/);

    const host = good();
    host.items[0]!.url = "https://example.com/guidance";
    expect(() => parseGuidance(host)).toThrow(/official-source list/);

    const topic = good();
    (topic.items[0] as { topics: string[] }).topics = ["made-up"];
    expect(() => parseGuidance(topic)).toThrow(/us-21cfr210/);

    const missing = good() as { items: Record<string, unknown>[] };
    delete missing.items[0]!.title;
    expect(() => parseGuidance(missing)).toThrow(/title/);
  });

  it("rejects duplicate ids", () => {
    const dup = good();
    dup.items.push(structuredClone(dup.items[0]!));
    expect(() => parseGuidance(dup)).toThrow(/duplicate id/);
  });
});
