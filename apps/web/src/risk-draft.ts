import { riskConfigSchema, type RiskConfig, type RiskMethod } from "@gap/process-model";

/*
 * The method editor works on a DRAFT whose numbers are text, so a field can be empty or half typed without the page inventing a
 * value (the tool has no default scale, band or matrix). `draftToConfig` turns the draft into a config only when every number
 * is a whole number and the shape is valid; otherwise it returns the reasons in words.
 */

export interface ScaleDraft {
  min: string;
  max: string;
  levels: { value: string; description: string }[];
}
export interface BandDraft {
  label: string;
  min: string;
  max: string;
  note: string;
}
export interface LevelDraft {
  label: string;
  description: string;
}
export interface FactorDraft {
  /** Stable key kept from the saved config; new factors get f1, f2 ... */
  key: string;
  name: string;
  scale: ScaleDraft;
}

/** Informational links kept from the config the draft started from. */
export interface Keep {
  loadoutId?: string;
  libraryRef?: { id: string; name: string; version: string };
}

export type Draft =
  | { method: "fmea"; severity: ScaleDraft; occurrence: ScaleDraft; detection: ScaleDraft; bands: BandDraft[]; trigger: { on: boolean; min: string; label: string; note: string }; keep: Keep }
  | { method: "matrix"; likelihood: LevelDraft[]; severity: LevelDraft[]; cells: string[][]; keep: Keep }
  | { method: "custom"; factors: FactorDraft[]; combine: "product" | "sum" | "max" | "lookup"; lookup: Record<string, string>; bands: BandDraft[]; keep: Keep }
  | { method: "qualitative"; levels: LevelDraft[]; keep: Keep };

const emptyScale = (): ScaleDraft => ({ min: "", max: "", levels: [] });
export const emptyDraft = (method: RiskMethod): Draft => {
  switch (method) {
    case "fmea":
      return { method, severity: emptyScale(), occurrence: emptyScale(), detection: emptyScale(), bands: [], trigger: { on: false, min: "", label: "", note: "" }, keep: {} };
    case "matrix":
      return { method, likelihood: [{ label: "", description: "" }], severity: [{ label: "", description: "" }], cells: [[""]], keep: {} };
    case "custom":
      return { method, factors: [0, 1].map((i) => ({ key: `f${i + 1}`, name: "", scale: emptyScale() })), combine: "product", lookup: {}, bands: [], keep: {} };
    case "qualitative":
      return { method, levels: [{ label: "", description: "" }], keep: {} };
  }
};

const scaleToDraft = (s: { min: number; max: number; levels: { value: number; description: string }[] }): ScaleDraft => ({
  min: String(s.min),
  max: String(s.max),
  levels: s.levels.map((l) => ({ value: String(l.value), description: l.description })),
});
const bandToDraft = (b: { label: string; minRpn: number; maxRpn: number; note?: string | undefined }): BandDraft => ({ label: b.label, min: String(b.minRpn), max: String(b.maxRpn), note: b.note ?? "" });
const keepOf = (c: RiskConfig): Keep => ({ ...(c.loadoutId ? { loadoutId: c.loadoutId } : {}), ...(c.libraryRef ? { libraryRef: c.libraryRef } : {}) });

export function configToDraft(c: RiskConfig): Draft {
  switch (c.method) {
    case "fmea":
      return {
        method: "fmea",
        severity: scaleToDraft(c.severity),
        occurrence: scaleToDraft(c.occurrence),
        detection: scaleToDraft(c.detection),
        bands: c.bands.map(bandToDraft),
        trigger: c.severityTrigger ? { on: true, min: String(c.severityTrigger.min), label: c.severityTrigger.label, note: c.severityTrigger.note ?? "" } : { on: false, min: "", label: "", note: "" },
        keep: keepOf(c),
      };
    case "matrix":
      return {
        method: "matrix",
        likelihood: c.likelihood.map((l) => ({ label: l.label, description: l.description ?? "" })),
        severity: c.severity.map((l) => ({ label: l.label, description: l.description ?? "" })),
        cells: c.likelihood.map((_, r) => c.severity.map((_, k) => c.cells.find((x) => x.row === r + 1 && x.col === k + 1)?.label ?? "")),
        keep: keepOf(c),
      };
    case "custom":
      return {
        method: "custom",
        factors: c.factors.map((f) => ({ key: f.key, name: f.name, scale: scaleToDraft(f.scale) })),
        combine: c.combine,
        lookup: Object.fromEntries(c.lookup.map((e) => [e.levels.join(","), e.label])),
        bands: c.bands.map(bandToDraft),
        keep: keepOf(c),
      };
    case "qualitative":
      return { method: "qualitative", levels: c.levels.map((l) => ({ label: l.label, description: l.description ?? "" })), keep: keepOf(c) };
  }
}

const WHOLE = /^-?\d+$/;
const whole = (s: string): number | undefined => (WHOLE.test(s.trim()) ? Number(s.trim()) : undefined);
const num = (s: string): number | undefined => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);

export type DraftResult = { ok: true; config: RiskConfig } | { ok: false; errors: string[] };

export function draftToConfig(d: Draft): DraftResult {
  const errors: string[] = [];
  const scale = (name: string, s: ScaleDraft) => {
    const min = whole(s.min);
    const max = whole(s.max);
    if (min === undefined || max === undefined) {
      errors.push(`${name}: enter the lowest and the highest value as whole numbers`);
      return { min: 0, max: 0, levels: [] };
    }
    const levels = s.levels
      .filter((l) => l.value.trim() || l.description.trim())
      .map((l) => {
        const v = whole(l.value);
        if (v === undefined) errors.push(`${name}: a level needs a whole-number value`);
        if (!l.description.trim()) errors.push(`${name}: level ${l.value} needs a description`);
        return { value: v ?? 0, description: l.description.trim() };
      });
    return { min, max, levels };
  };
  const bands = (list: BandDraft[]) =>
    list.map((b) => {
      const min = num(b.min);
      const max = num(b.max);
      if (!b.label.trim()) errors.push("A band needs a label");
      if (min === undefined || max === undefined) errors.push(`Band "${b.label}": enter the lowest and the highest score as numbers`);
      return { label: b.label.trim(), minRpn: min ?? 0, maxRpn: max ?? 0, ...(b.note.trim() ? { note: b.note.trim() } : {}) };
    });
  const levels = (name: string, list: LevelDraft[]) =>
    list.map((l) => {
      if (!l.label.trim()) errors.push(`${name}: a level needs a name`);
      return { label: l.label.trim(), ...(l.description.trim() ? { description: l.description.trim() } : {}) };
    });
  let raw: unknown;
  switch (d.method) {
    case "fmea": {
      let trigger: unknown;
      if (d.trigger.on) {
        const min = whole(d.trigger.min);
        if (min === undefined) errors.push("Severity rule: enter the severity as a whole number");
        if (!d.trigger.label.trim()) errors.push("Severity rule: enter the label it gives");
        trigger = { min: min ?? 0, label: d.trigger.label.trim(), ...(d.trigger.note.trim() ? { note: d.trigger.note.trim() } : {}) };
      }
      raw = { method: "fmea", severity: scale("Severity", d.severity), occurrence: scale("Occurrence", d.occurrence), detection: scale("Detection", d.detection), bands: bands(d.bands), ...(trigger ? { severityTrigger: trigger } : {}), ...d.keep };
      break;
    }
    case "matrix": {
      const cells: { row: number; col: number; label: string }[] = [];
      d.cells.forEach((row, r) => row.forEach((label, c) => label.trim() && cells.push({ row: r + 1, col: c + 1, label: label.trim() })));
      raw = { method: "matrix", likelihood: levels("Likelihood", d.likelihood), severity: levels("Severity", d.severity), cells, ...d.keep };
      break;
    }
    case "custom": {
      const factors = d.factors.map((f) => {
        if (!f.name.trim()) errors.push("A factor needs a name");
        return { key: f.key, name: f.name.trim(), scale: scale(f.name.trim() || f.key, f.scale) };
      });
      const lookup =
        d.combine === "lookup"
          ? Object.entries(d.lookup)
              .filter(([, label]) => label.trim())
              .map(([k, label]) => ({ levels: k.split(",").map(Number), label: label.trim() }))
          : [];
      raw = { method: "custom", factors, combine: d.combine, lookup, bands: d.combine === "lookup" ? [] : bands(d.bands), ...d.keep };
      break;
    }
    case "qualitative":
      raw = { method: "qualitative", levels: levels("Levels", d.levels), ...d.keep };
      break;
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const r = riskConfigSchema.safeParse(raw);
  return r.success ? { ok: true, config: r.data } : { ok: false, errors: [...new Set(r.error.issues.map((i) => i.message))] };
}

/** All combinations of a user-defined method's factor values, for the lookup table (empty when a scale is not valid yet). */
export function lookupCombos(factors: FactorDraft[]): number[][] {
  let out: number[][] = [[]];
  for (const f of factors) {
    const min = whole(f.scale.min);
    const max = whole(f.scale.max);
    if (min === undefined || max === undefined || max < min) return [];
    const vals: number[] = [];
    for (let v = min; v <= max; v++) vals.push(v);
    out = out.flatMap((o) => vals.map((v) => [...o, v]));
    if (out.length > 200) return out;
  }
  return out;
}
