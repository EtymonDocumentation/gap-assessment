import { z } from "zod";

/**
 * The condition language of the catalog ("show this unit operation only when ..."). It is part of the process model
 * because the catalog's unit operations carry conditions (applicableWhen, hiddenWhen). Evaluating a condition needs a
 * project and is done by the consuming tool (the gap engine has the evaluator); only the shape and its validation live here.
 * Some operators ("changed", "increased", ...) compare the two sides of a transfer; a tool with one side never uses them.
 */

const quantity = z.object({ value: z.number(), unit: z.string() });
const literal = z.union([z.string(), z.number(), z.boolean()]);

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { eq: [string, string | number | boolean] }
  | { in: [string, (string | number | boolean)[]] }
  | { includes: [string, string] }
  | { answered: string }
  | { isTbd: string }
  | { isTrue: string }
  | { uoPresent: string }
  | { changed: string }
  | { increased: string }
  | { decreased: string }
  | { ratioAbove: [string, number] }
  | { gt: [string, string | number | { value: number; unit: string }] }
  | { gte: [string, string | number | { value: number; unit: string }] }
  | { lt: [string, string | number | { value: number; unit: string }] }
  | { lte: [string, string | number | { value: number; unit: string }] };

const cmpOperand = z.union([z.string(), z.number(), quantity]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z.object({ eq: z.tuple([z.string(), literal]) }).strict(),
    z.object({ in: z.tuple([z.string(), z.array(literal).min(1)]) }).strict(),
    z.object({ includes: z.tuple([z.string(), z.string()]) }).strict(),
    z.object({ answered: z.string() }).strict(),
    z.object({ isTbd: z.string() }).strict(),
    z.object({ isTrue: z.string() }).strict(),
    z.object({ uoPresent: z.string() }).strict(),
    z.object({ changed: z.string() }).strict(),
    z.object({ increased: z.string() }).strict(),
    z.object({ decreased: z.string() }).strict(),
    z.object({ ratioAbove: z.tuple([z.string(), z.number()]) }).strict(),
    z.object({ gt: z.tuple([z.string(), cmpOperand]) }).strict(),
    z.object({ gte: z.tuple([z.string(), cmpOperand]) }).strict(),
    z.object({ lt: z.tuple([z.string(), cmpOperand]) }).strict(),
    z.object({ lte: z.tuple([z.string(), cmpOperand]) }).strict(),
  ]),
) as z.ZodType<Condition>;

/** One answer choice of an option set. The catalog supplies options, never answers. */
export const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type Option = z.infer<typeof optionSchema>;

export interface ConditionRefs {
  /** Answer references ("scope.x", "site.y", "uo.<uo>.<path>"). */
  refs: string[];
  /** Side-less content paths read by the comparison operators. */
  paths: string[];
  /** Unit operation keys read by uoPresent. */
  uos: string[];
}

/** Collects what a condition reads, so a catalog or question file can be checked against the paths and keys that exist. */
export function conditionRefs(c: Condition, out: ConditionRefs): void {
  if ("all" in c) c.all.forEach((x) => conditionRefs(x, out));
  else if ("any" in c) c.any.forEach((x) => conditionRefs(x, out));
  else if ("not" in c) conditionRefs(c.not, out);
  else if ("eq" in c) out.refs.push(c.eq[0]);
  else if ("in" in c) out.refs.push(c.in[0]);
  else if ("includes" in c) out.refs.push(c.includes[0]);
  else if ("answered" in c) out.refs.push(c.answered);
  else if ("isTbd" in c) out.refs.push(c.isTbd);
  else if ("isTrue" in c) out.refs.push(c.isTrue);
  else if ("uoPresent" in c) out.uos.push(c.uoPresent);
  else if ("changed" in c) out.paths.push(c.changed);
  else if ("increased" in c) out.paths.push(c.increased);
  else if ("decreased" in c) out.paths.push(c.decreased);
  else if ("ratioAbove" in c) out.paths.push(c.ratioAbove[0]);
  else {
    const pair = "gt" in c ? c.gt : "gte" in c ? c.gte : "lt" in c ? c.lt : c.lte;
    out.refs.push(pair[0]);
    if (typeof pair[1] === "string") out.refs.push(pair[1]);
  }
}
