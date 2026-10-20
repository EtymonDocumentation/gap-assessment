import { quantityRatio, resolveEntry, type Project, type Side } from "@gap/process-model";
import type { Condition } from "./content-schema";
import { compareMagnitude, isQuantity, magnitudeOf, valuesEqual } from "./values";

export interface EvalContext {
  project: Project;
  /** The side of the question instance being evaluated, when there is one. */
  side?: Side | "shared";
}

function established(ctx: EvalContext, ref: string) {
  const r = resolveEntry(ctx.project, ref);
  return r.status === "established" ? r : undefined;
}

function pair(ctx: EvalContext, path: string) {
  return { s: established(ctx, `source.${path}`), t: established(ctx, `target.${path}`) };
}

function literalMatches(value: unknown, lit: string | number | boolean): boolean {
  if (typeof value === "boolean" && typeof lit === "string") return value === (lit === "yes" || lit === "true");
  return value === lit;
}

/**
 * Evaluates a branching condition against the current project state.
 * Conditions are pure data (no code execution). Anything that cannot be
 * determined (missing or unknown values) evaluates to false, so follow-ups
 * appear only once their trigger is actually established.
 */
export function evaluate(cond: Condition, ctx: EvalContext): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluate(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, ctx));
  if ("not" in cond) return !evaluate(cond.not, ctx);
  if ("eq" in cond) {
    const r = established(ctx, cond.eq[0]);
    return !!r && literalMatches(r.value, cond.eq[1]);
  }
  if ("in" in cond) {
    const r = established(ctx, cond.in[0]);
    return !!r && cond.in[1].some((l) => literalMatches(r.value, l));
  }
  if ("includes" in cond) {
    const r = established(ctx, cond.includes[0]);
    return !!r && Array.isArray(r.value) && r.value.includes(cond.includes[1]);
  }
  if ("answered" in cond) return resolveEntry(ctx.project, cond.answered).status !== "not_established";
  if ("isUnknown" in cond) return resolveEntry(ctx.project, cond.isUnknown).status === "unknown";
  if ("isTrue" in cond) return established(ctx, cond.isTrue)?.value === true;
  if ("uoPresent" in cond) {
    const present = (side: Side) => established(ctx, `${side}.uo.${cond.uoPresent}.presence`)?.value === true;
    if (ctx.side === "source" || ctx.side === "target") return present(ctx.side);
    return present("source") || present("target");
  }
  if ("changed" in cond) {
    const { s, t } = pair(ctx, cond.changed);
    return !!s && !!t && !valuesEqual(s.value, t.value);
  }
  if ("increased" in cond || "decreased" in cond) {
    const path = "increased" in cond ? cond.increased : cond.decreased;
    const { s, t } = pair(ctx, path);
    if (!s || !t) return false;
    const c = compareMagnitude(t.value, s.value);
    return c !== undefined && ("increased" in cond ? c > 0 : c < 0);
  }
  if ("ratioAbove" in cond) {
    const { s, t } = pair(ctx, cond.ratioAbove[0]);
    const qs = magnitudeOf(s?.value);
    const qt = magnitudeOf(t?.value);
    if (!qs || !qt) return false;
    try {
      return quantityRatio(qt, qs) > cond.ratioAbove[1];
    } catch {
      return false;
    }
  }
  const [op, args] =
    "gt" in cond ? (["gt", cond.gt] as const) : "gte" in cond ? (["gte", cond.gte] as const) : "lt" in cond ? (["lt", cond.lt] as const) : (["lte", cond.lte] as const);
  const left = established(ctx, args[0]);
  if (!left) return false;
  let right: number | undefined | ReturnType<typeof magnitudeOf> | number;
  if (typeof args[1] === "string") {
    const r = established(ctx, args[1]);
    if (!r) return false;
    right = typeof r.value === "number" ? r.value : magnitudeOf(r.value);
  } else {
    right = args[1];
  }
  const lv = typeof left.value === "number" ? left.value : magnitudeOf(left.value);
  const c = compareMagnitude(lv, isQuantity(right) || typeof right === "number" ? right : undefined);
  if (c === undefined) return false;
  return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
}
