import type { RiskConfig, RiskScore } from "@gap/process-model";
import type { RiskResult } from "@gap/risk";
import { describeMethod, factorColumns } from "@gap/risk";

/*
 * Showing and entering a risk score.
 *  - A band, cell or level label is the USER's own word. The badge adds a shape beside it so the meaning never rests on colour:
 *    ○ not scored, a different shape for each of the user's bands or levels, a flag for the user's severity rule.
 *  - Entry uses lists of the method's own values (or the matrix levels), with "Not given" first. Nothing is pre-selected.
 */

const SHAPES = ["●", "▲", "■", "◆", "★", "✚"];

/** The labels of a method in their natural order, so a label keeps the same shape on every page. */
function labelOrder(config: RiskConfig): string[] {
  switch (config.method) {
    case "fmea":
    case "custom": {
      if (config.method === "custom" && config.combine === "lookup") return [...new Set(config.lookup.map((l) => l.label).filter(Boolean))].sort();
      return describeMethod(config).bands.map((b) => b.label);
    }
    case "matrix":
      return [...new Set(config.cells.map((c) => c.label).filter(Boolean))].sort();
    case "qualitative":
      return config.levels.map((l) => l.label);
  }
}
export const shapeFor = (config: RiskConfig, label: string): string => SHAPES[Math.max(0, labelOrder(config).indexOf(label)) % SHAPES.length]!;

export function ScoreBadge({ config, res, label = "" }: { config: RiskConfig | undefined; res: RiskResult | undefined; label?: string }) {
  if (!config || !res || !res.scored) {
    return (
      <span className="risk-badge risk-none" data-testid="score-none">
        <span aria-hidden="true">○</span> Not scored
      </span>
    );
  }
  return (
    <span className="risk-score" data-testid="score-badge">
      {res.score !== undefined && <strong className="num">{label}{res.score}</strong>}
      {res.label ? (
        <span className="risk-badge risk-band">
          <span aria-hidden="true">{shapeFor(config, res.label)}</span> {res.label}
        </span>
      ) : res.score !== undefined && config.method !== "matrix" ? (
        <span className="muted small"> (no band)</span>
      ) : null}
      {res.trigger && (
        <span className="risk-badge risk-trigger">
          <span aria-hidden="true">⚑</span> Rule: {res.trigger.label}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ entry

export interface ScoreForm {
  values: Record<string, string>;
  level: string;
  reason: string;
}
export const blankScore = (): ScoreForm => ({ values: {}, level: "", reason: "" });
export const scoreToForm = (s: RiskScore | undefined): ScoreForm => ({
  values: Object.fromEntries(Object.entries(s?.values ?? {}).map(([k, v]) => [k, String(v)])),
  level: s?.level ?? "",
  reason: s?.reason ?? "",
});
export function formToScore(f: ScoreForm): RiskScore {
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(f.values)) if (v.trim() !== "" && Number.isInteger(Number(v))) values[k] = Number(v);
  return { values, ...(f.level ? { level: f.level } : {}), ...(f.reason.trim() ? { reason: f.reason.trim() } : {}) };
}
export const formIsEmpty = (f: ScoreForm): boolean => Object.values(f.values).every((v) => v.trim() === "") && !f.level && !f.reason.trim();

export function ScoreInputs({ config, form, onChange, which }: { config: RiskConfig; form: ScoreForm; onChange: (f: ScoreForm) => void; which: "initial" | "residual" }) {
  const set = (patch: Partial<ScoreForm>) => onChange({ ...form, ...patch, values: patch.values ?? form.values });
  const word = which === "initial" ? "" : "Residual ";
  if (config.method === "qualitative") {
    const known = config.levels.some((l) => l.label === form.level);
    return (
      <div className="stack">
        <label className="field">
          <span>{word}Level</span>
          <select value={form.level} onChange={(e) => set({ level: e.target.value })} data-testid={`score-${which}-level`}>
            <option value="">Not given</option>
            {config.levels.map((l) => (
              <option key={l.label} value={l.label}>
                {l.label}
              </option>
            ))}
            {form.level && !known && <option value={form.level}>{form.level} (not in the method)</option>}
          </select>
        </label>
        <label className="field">
          <span>{word}Reason (required with a level)</span>
          <textarea rows={2} value={form.reason} onChange={(e) => set({ reason: e.target.value })} data-testid={`score-${which}-reason`} />
        </label>
      </div>
    );
  }
  return (
    <div className="row wrap">
      {factorColumns(config).map((c) => {
        const cur = form.values[c.key] ?? "";
        let options: { value: string; text: string }[];
        if (config.method === "matrix") {
          const list = c.key === "likelihood" ? config.likelihood : config.severity;
          options = list.map((l, i) => ({ value: String(i + 1), text: l.label }));
        } else {
          const scale = config.method === "fmea" ? config[c.key as "severity" | "occurrence" | "detection"] : config.factors.find((f) => f.key === c.key)!.scale;
          options = [];
          for (let v = scale.min; v <= scale.max && options.length < 200; v++) {
            const d = scale.levels.find((l) => l.value === v)?.description;
            options.push({ value: String(v), text: d ? `${v} - ${d}` : String(v) });
          }
        }
        const stale = cur !== "" && !options.some((o) => o.value === cur);
        return (
          <label key={c.key} className="field">
            <span>
              {word}
              {c.name}
            </span>
            <select value={cur} onChange={(e) => set({ values: { ...form.values, [c.key]: e.target.value } })} data-testid={`score-${which}-${c.key}`}>
              <option value="">Not given</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
              {stale && <option value={cur}>{cur} (outside the scale)</option>}
            </select>
          </label>
        );
      })}
    </div>
  );
}
