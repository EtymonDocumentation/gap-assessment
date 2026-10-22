import type { CustomConfig, FmeaConfig, MatrixConfig, QualitativeConfig } from "@gap/process-model";

// Test configs only. They are not defaults of the tool: the package has none.
const scale = (min: number, max: number) => ({ min, max, levels: [] });

export const fmea = (over: Partial<FmeaConfig> = {}): FmeaConfig => ({
  method: "fmea",
  severity: scale(1, 10),
  occurrence: scale(1, 10),
  detection: scale(1, 10),
  bands: [],
  ...over,
});

export const matrix3 = (labelled = true): MatrixConfig => ({
  method: "matrix",
  likelihood: [{ label: "Rare" }, { label: "Possible" }, { label: "Likely" }],
  severity: [{ label: "Minor" }, { label: "Moderate" }, { label: "Major" }],
  cells: labelled
    ? [1, 2, 3].flatMap((row) => [1, 2, 3].map((col) => ({ row, col, label: row * col >= 6 ? "Band A" : row * col >= 3 ? "Band B" : "Band C" })))
    : [],
});

export const custom = (combine: CustomConfig["combine"], over: Partial<CustomConfig> = {}): CustomConfig => ({
  method: "custom",
  factors: [
    { key: "impact", name: "Impact", scale: scale(1, 3) },
    { key: "freq", name: "Frequency", scale: scale(1, 3) },
  ],
  combine,
  lookup: [],
  bands: [],
  ...over,
});

export const qualitative = (): QualitativeConfig => ({ method: "qualitative", levels: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] });
