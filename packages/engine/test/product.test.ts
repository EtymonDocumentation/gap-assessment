import { describe, expect, it } from "vitest";
import {
  FILING_CATEGORY_STATEMENT,
  NOTICE_DOCUMENT,
  NOTICE_FOOTER,
  NOTICE_STRIP,
  NOTICE_STRIP_PHONE,
  PRODUCT_NAME,
  PRODUCT_SUBTITLE,
  PRODUCT_TITLE,
  RISK_BANNER,
  SAMPLING_BANNER,
  STORAGE_PHRASE_BROWSER,
  STORAGE_PHRASE_SERVER,
  TRD_BANNER,
} from "@gap/engine";

// The wording below is the product owner's decision (2026-11-02). It is written out in full here on purpose: this is the one test that
// pins the sentences, so a careless edit of the shared module fails here, and every other test imports the constants instead.
describe("product name and notice wording (one shared source)", () => {
  it("names the product Cascade, with its subtitle", () => {
    expect(PRODUCT_NAME).toBe("Cascade");
    expect(PRODUCT_SUBTITLE).toBe("GMP transfer documentation");
    expect(PRODUCT_TITLE).toBe("Cascade: GMP transfer documentation");
  });

  it("has the desktop strip, the phone strip and the document notice, word for word", () => {
    expect(NOTICE_STRIP).toBe("Drafting aid · Not validated · Review and approve every document in your own document control · Fictional data only");
    expect(NOTICE_STRIP_PHONE).toBe("Drafting aid · Not validated · Fictional data only");
    expect(NOTICE_DOCUMENT).toBe("Drafting aid output, not validated. Review and approve this document in your own document control system. Fictional data only.");
  });

  it("says in every form that the tool is not validated and holds fictional data only", () => {
    for (const form of [NOTICE_STRIP, NOTICE_STRIP_PHONE, NOTICE_DOCUMENT, NOTICE_FOOTER]) {
      expect(form).toMatch(/not validated/i);
      expect(form).toMatch(/fictional data only/i);
      expect(form).toMatch(/drafting aid/i);
    }
  });

  it("no longer carries the proof-of-concept wording, and never claims approval or GMP use", () => {
    for (const form of [NOTICE_STRIP, NOTICE_STRIP_PHONE, NOTICE_DOCUMENT, NOTICE_FOOTER]) {
      expect(form).not.toMatch(/proof of concept|proof-of-concept|not for gmp use/i);
      expect(form).not.toMatch(/\b(approved|validated for|fit for)\b/i);
    }
  });

  it("keeps the phone strip short enough for one line, and the document notice tells the reader where to approve", () => {
    expect(NOTICE_STRIP_PHONE.length).toBeLessThan(NOTICE_STRIP.length / 2);
    expect(NOTICE_STRIP_PHONE.length).toBeLessThanOrEqual(60);
    expect(NOTICE_STRIP).toContain("Review and approve every document in your own document control");
    expect(NOTICE_DOCUMENT).toContain("Review and approve this document in your own document control system");
  });

  it("builds the page footer from the full strip wording and the filing-category statement", () => {
    expect(FILING_CATEGORY_STATEMENT).toBe("The tool never determines regulatory filing categories.");
    expect(NOTICE_FOOTER).toBe(`${NOTICE_STRIP}. ${FILING_CATEGORY_STATEMENT}`);
  });

  it("has the two storage phrases the strip adds in browser mode and in server mode", () => {
    expect(STORAGE_PHRASE_BROWSER).toBe("Data stays in this browser.");
    expect(STORAGE_PHRASE_SERVER).toBe("Your data is kept on the server.");
  });

  it("is the notice that the TRD, sampling and risk documents carry", () => {
    expect(TRD_BANNER).toBe(NOTICE_DOCUMENT);
    expect(SAMPLING_BANNER).toBe(NOTICE_DOCUMENT);
    expect(RISK_BANNER).toBe(NOTICE_DOCUMENT);
  });
});
