import { describe, expect, it } from "vitest";
import { formatLimitMB } from "../src/server/files";

// Walk-through row 12: the admin sets --max-upload-mb 50 and the page must say "50 MB", not "52 MB".
describe("formatLimitMB", () => {
  it("reads the limit as the admin typed it", () => {
    expect(formatLimitMB(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatLimitMB(1 * 1024 * 1024)).toBe("1 MB");
    expect(formatLimitMB(1024 * 1024 * 1024)).toBe("1024 MB");
  });
});
