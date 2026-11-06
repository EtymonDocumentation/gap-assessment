import { SAMPLE_ACCESS_LABEL, type SampleAccess, type SampleFlushPractice, type SampleMethod, type SamplingPlan, type SamplingPoint, type StudyEquipmentItem } from "@gap/process-model";

/**
 * How each sample is physically taken (plan format 1.6.0), turned into plain instruction lines and reminders.
 *
 * WHY: CMOs often add a sampling port or Y-connector to a single-use assembly only to pull development or PPQ samples, then do not
 * flush the port, re-use one port for several samples in the wrong order, or draw from a bag that was not mixed. The tool asks; these
 * functions only repeat what the person answered and point at what is still unstated. They never decide that a method is adequate,
 * and nothing here blocks completeness: reminders are an OPTIONAL practice, not an open item of the plan.
 *
 * WHEN reminders appear (one simple rule): for a point once its method section has at least one answer, or for every point when
 * the plan switches the practice on ("Ask how each sample is taken", `askSampleMethod`). A plan that never touches the section and
 * leaves the switch off shows no reminders at all, so existing plans and demos are unchanged.
 */

export type MethodReminderSeverity = "open" | "reminder";
export interface MethodReminder {
  /** "open": a choice or yes/no that has no answer. "reminder": the choice is made but a detail (volume, time, place) is missing. */
  severity: MethodReminderSeverity;
  /** A sentence for the person who fills in the plan. */
  text: string;
  /** What is missing, in a few words (used for the blank in a batch record). */
  field: string;
}

/** A write-in line for a value the plan does not state. */
export const METHOD_BLANK = "______";

const filled = (s: string | undefined) => (s ?? "").trim() !== "";
/** A typed phrase without its closing full stop, so that adding our own never doubles it. */
const bare = (s: string | undefined) => (s ?? "").trim().replace(/[.!?]+$/, "");
const yesNo = (v: boolean | undefined) => (v === undefined ? undefined : v ? "yes" : "no");

/** True when the person has answered anything in the method section. An empty object left behind by the editor counts as not started. */
export function methodStarted(m: SampleMethod | undefined): boolean {
  if (!m) return false;
  const walk = (v: unknown): boolean => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.some(walk);
    if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(walk);
    return true;
  };
  return walk(m);
}

/** Does the plan ask the method question for this point? (See the file comment for the rule.) */
export function methodAsked(plan: SamplingPlan, p: SamplingPoint): boolean {
  return plan.askSampleMethod === true || methodStarted(p.method);
}

const PORT_LIKE = new Set(["dedicated_port", "shared_port", "added_y_connector", "bag_sample_manifold", "aseptic_connector"]);
/** The access draws liquid through a port, connector or manifold (so a flush practice applies). Shared with the design review. */
export const isPortLikeAccess = (a: SampleAccess | undefined): boolean => a !== undefined && PORT_LIKE.has(a);

/** The sample comes out of a bag or hold vessel: the person says so, the access is a bag manifold, or the point sits on a hold. */
export function isBagSample(p: SamplingPoint): boolean {
  return p.method?.bag?.fromBag === true || p.method?.access === "bag_sample_manifold" || !!p.flow?.holdId;
}

/** A port or connector that was put on only for the study (or is a Y-connector, which is nearly always an addition). */
function addedPart(m: SampleMethod): boolean {
  return m.added?.forStudyOnly === true || m.access === "added_y_connector";
}

export function samplingMethodReminders(p: SamplingPoint, plan: SamplingPlan): MethodReminder[] {
  if (!methodAsked(plan, p)) return [];
  const m = p.method ?? {};
  const out: MethodReminder[] = [];
  const open = (field: string, text: string) => out.push({ severity: "open", field, text });
  const detail = (field: string, text: string) => out.push({ severity: "reminder", field, text });

  if (!m.access) open("how the sample is taken", "State how this sample is taken (dedicated port, shared port, added connector, bag manifold, aseptic connector, grab).");
  if (m.access === "other" && !filled(m.accessOther)) detail("how the sample is taken", "Describe the other way the sample is taken.");

  // A bag manifold or an aseptic connector can be put on only for the study just like a port (design review A5 asks the same about them).
  if (m.access === "dedicated_port" || m.access === "shared_port" || m.access === "added_y_connector" || m.access === "bag_sample_manifold" || m.access === "aseptic_connector") {
    if (m.added?.forStudyOnly === undefined) open("port or connector added for the study", "State whether the port or connector was added only for development or PPQ sampling.");
  }
  if (addedPart(m)) {
    if (m.added?.inCommercialAssembly === undefined) open("added part in the commercial assembly", "State whether the added connector is in the commercial assembly.");
    if (m.added?.validatedAssembly === undefined) open("modified assembly qualified", "State whether the modified assembly is covered by the single-use assembly qualification (for example extractables).");
    if (m.added?.removedAfter === undefined) open("added part removed afterwards", "State whether the added port or connector is removed after the study.");
  }

  if (m.access && PORT_LIKE.has(m.access)) {
    const f = m.flush;
    if (!f?.practice) open("flush", "State the flush or first-draw discard volume and where it goes.");
    else if (f.practice === "none_stated_reason") {
      if (!filled(f.reason)) detail("reason for no flush", "Write down why the port is not flushed.");
    } else {
      if (!f.volume) detail("flush volume", f.practice === "flush_volume" ? "State the flush volume." : "State the volume of the first draw that is discarded.");
      if (!filled(f.discardTo)) detail("where the flushed liquid goes", "State where the flushed or discarded liquid goes.");
    }
  }

  if (m.access === "shared_port") {
    const s = m.shared;
    if (!s?.pointIds?.length) detail("samples sharing the port", "Name the other samples drawn from the same port.");
    if (!filled(s?.order)) detail("order on the shared port", "State the order the samples are drawn in on the shared port.");
    if (s?.flushBetween === undefined) open("flush between samples", "State whether the port is flushed between samples.");
  }

  if (isBagSample(p)) {
    const b = m.bag;
    if (b?.mixedFirst === undefined) open("bag mixed first", "State whether the bag is mixed before the sample is drawn.");
    else if (b.mixedFirst && !filled(b.mixingTime)) detail("mixing time", "State how long the bag is mixed before sampling.");
    if (!filled(b?.drawFrom)) detail("where on the bag it is drawn", "State where on the bag the sample is drawn from (for example the bottom port or a sample manifold).");
  }

  if (!m.closedSystem) open("closed or open", "State whether the sample is drawn in a closed system or open.");
  else if (m.closedSystem === "open" && !filled(m.openClass)) detail("room or hood class", "State the room or hood class an open sample is drawn in.");
  return out;
}

/** Reminders of every point of the plan, for the plan-level list. */
export function planMethodReminders(plan: SamplingPlan): { pointId: string; reminders: MethodReminder[] }[] {
  return plan.points.map((p) => ({ pointId: p.id, reminders: samplingMethodReminders(p, plan) })).filter((x) => x.reminders.length > 0);
}

const volumeText = (v: { value: number; unit: string } | undefined) => (v ? `${v.value} ${v.unit}` : undefined);

/**
 * The answers as plain instruction lines (imperative where the answer is an action), in the order a sampler works: access, added part,
 * flush, shared port, bag, closed or open. Only what was answered is written; what is not stated is NOT guessed here (see the reminders).
 * Where an answer exists but a detail is missing, a write-in line takes its place so a batch record shows the gap.
 */
export function methodInstructionLines(p: SamplingPoint): string[] {
  const m = p.method;
  if (!m) return [];
  const out: string[] = [];
  if (m.access) out.push(`Sample taken through: ${m.access === "other" ? bare(m.accessOther) || "other (not described)" : SAMPLE_ACCESS_LABEL[m.access].replace(/^[A-Z](?![A-Z-])/, (c) => c.toLowerCase())}.`);
  if (m.added?.forStudyOnly !== undefined || m.access === "added_y_connector") {
    const a = m.added;
    const bits = [
      a?.forStudyOnly === undefined ? undefined : a.forStudyOnly ? "added only for development or PPQ sampling" : "not added for the study",
      a?.inCommercialAssembly === undefined ? undefined : a.inCommercialAssembly ? "in the commercial assembly" : "not in the commercial assembly",
      a?.validatedAssembly === undefined ? undefined : a.validatedAssembly ? "modified assembly covered by the single-use qualification" : "modified assembly not covered by the single-use qualification",
      a?.removedAfter === undefined ? undefined : a.removedAfter ? "removed after the study" : "not removed after the study",
    ].filter(Boolean);
    if (bits.length) out.push(`Port or connector: ${bits.join("; ")}.${filled(a?.note) ? ` ${bare(a!.note)}.` : ""}`);
  }
  const f = m.flush;
  if (f?.practice === "none_stated_reason") out.push(`No flush before sampling. Reason: ${bare(f.reason) || METHOD_BLANK}.`);
  else if (f?.practice) {
    const where = bare(f.discardTo) || METHOD_BLANK;
    out.push(f.practice === "flush_volume" ? `Flush ${volumeText(f.volume) ?? METHOD_BLANK} from the port to ${where} before drawing.` : `Discard the first ${volumeText(f.volume) ?? METHOD_BLANK} drawn to ${where} before taking the sample.`);
  }
  const s = m.shared;
  if (s && (s.pointIds?.length || filled(s.order) || s.flushBetween !== undefined)) {
    const others = s.pointIds?.length ? ` with ${s.pointIds.join(", ")}` : "";
    out.push(`This port is shared${others}.${filled(s.order) ? ` Order: ${bare(s.order)}.` : ""}${s.flushBetween === undefined ? "" : ` Flush between samples: ${yesNo(s.flushBetween)}.`}`);
  }
  const b = m.bag;
  if (b && (b.mixedFirst !== undefined || filled(b.drawFrom))) {
    if (b.mixedFirst === true) out.push(`Mix the bag ${bare(b.mixingTime) || METHOD_BLANK} before sampling.`);
    else if (b.mixedFirst === false) out.push("The bag is not mixed before sampling.");
    if (filled(b.drawFrom)) out.push(`Draw the sample from: ${bare(b.drawFrom)}.`);
  }
  if (m.closedSystem === "closed") out.push("Closed sample.");
  else if (m.closedSystem === "open") out.push(`Open sample, drawn under ${bare(m.openClass) || METHOD_BLANK}.`);
  if (filled(m.note)) out.push(`${bare(m.note)}.`);
  return out;
}

// ------------------------------------------------------------------ equipment used only to take the samples (design review A5)

/** What the plan states about one item, in the words of a document. A fact the plan does not state is left out, never guessed. */
function equipmentFacts(it: StudyEquipmentItem): string[] {
  return [
    it.inCommercialProcess === undefined ? undefined : it.inCommercialProcess ? "also in the commercial process" : "not in the commercial process",
    it.qualified === undefined ? undefined : it.qualified ? "qualified" : "not qualified",
    it.removedAfter === undefined ? undefined : it.removedAfter ? "removed afterwards" : "not removed afterwards",
  ].filter((x): x is string => x !== undefined);
}

/**
 * The listed study-only equipment that is used for this sample: an item that names the sample, or an item that names only the step the
 * sample sits on. An item that names neither has no place in a batch record (the review asks where it is used) and is not returned.
 */
export function studyEquipmentFor(plan: SamplingPlan, p: SamplingPoint): StudyEquipmentItem[] {
  const se = plan.designReview?.studyEquipment;
  if (!se?.used) return [];
  return se.items.filter((it) => (it.pointIds?.length ? it.pointIds.includes(p.id) : it.stepId !== undefined && it.stepId === p.flow?.stepId));
}

/** One instruction line for a batch record: "PPQ only: sampling manifold (EQ-01) is used only to take samples; ...". */
export function studyEquipmentLine(it: StudyEquipmentItem, tag: "PPQ only" | "study only"): string {
  const facts = equipmentFacts(it);
  return `${tag}: ${bare(it.what) || it.id} (${it.id}) is used only to take samples${facts.length ? `; ${facts.join("; ")}` : ""}.`;
}

/** The plan-level table of the listed equipment (plan body and CMO instructions). Undefined when no equipment is listed. */
export function studyEquipmentTable(plan: SamplingPlan): { columns: string[]; rows: string[][] } | undefined {
  const se = plan.designReview?.studyEquipment;
  if (!se?.used || se.items.length === 0) return undefined;
  const yn = (v: boolean | undefined) => (v === undefined ? "Not stated" : v ? "Yes" : "No");
  const stepLabel = (id: string | undefined) => (id ? (plan.steps.find((s) => s.id === id)?.label ?? id) : "");
  return {
    columns: ["Item", "What it is", "Step", "Samples", "In the commercial process", "Qualified", "Removed afterwards"],
    rows: se.items.map((it) => [it.id, bare(it.what) || "(not described)", stepLabel(it.stepId) || "Not stated", (it.pointIds ?? []).join(", ") || "Not stated", yn(it.inCommercialProcess), yn(it.qualified), yn(it.removedAfter)]),
  };
}

/**
 * The lines for a batch record or an instruction document: the instruction lines, then the "PPQ only" lines for equipment used only to take
 * this sample, then one "not stated" blank per unanswered item. `stage` is the project stage key (it decides "PPQ only" or "study only").
 */
export function methodDocumentLines(p: SamplingPoint, plan: SamplingPlan, stage?: string): { text: string; open: boolean }[] {
  const lines = methodInstructionLines(p).map((text) => ({ text, open: text.includes(METHOD_BLANK) }));
  for (const it of studyEquipmentFor(plan, p)) lines.push({ text: studyEquipmentLine(it, studyTagFor(stage, Boolean(p.type?.startsWith("ppq")))), open: false });
  for (const r of samplingMethodReminders(p, plan)) lines.push({ text: `[not stated: ${r.field}] ${METHOD_BLANK}`, open: true });
  return lines;
}

// ------------------------------------------------------------------ the answers as a picture and one phrase

/**
 * How the linked sampling plan says the sample is physically taken (plan format 1.6.0), as the Process view draws and prints it. Every
 * field is present only when the plan states it; the view adds no default. The step's own port name (ViewSample.port) is the PLACE, the
 * access here is the KIND of connection, so both are kept when both exist.
 */
export interface SampleMethodView {
  access?: SampleAccess;
  /** Short words for the access ("shared port", "Y-connector", ...). For "other" the person's own description, or "other" when none. */
  accessText?: string;
  /** A port or connector added only for the study (a Y-connector counts as an addition unless the plan says it is not). */
  addedForStudy?: boolean;
  /** "PPQ only" at a PPQ project, else "study only" (the point's type decides when the project stage is not set): the tag drawn next to an added part. */
  studyTag?: "PPQ only" | "study only";
  inCommercialAssembly?: boolean;
  removedAfter?: boolean;
  flush?: {
    practice: SampleFlushPractice;
    /** Counted as liquid lost to waste only when the plan states it in mL or L (kept here in mL). */
    volumeMl?: number;
    /** The volume as the plan wrote it, for words. */
    volumeText?: string;
    discardTo?: string;
  };
  sharedWith?: string[];
  flushBetween?: boolean;
  closedSystem?: "closed" | "open";
  /** The same facts in one phrase, for an accessible name and the sample lists ("shared port, flush 30 mL to waste"). */
  text: string;
}

const ACCESS_WORDS: Record<SampleAccess, string> = {
  dedicated_port: "dedicated port",
  shared_port: "shared port",
  added_y_connector: "Y-connector",
  bag_sample_manifold: "bag sample manifold",
  aseptic_connector: "aseptic connector",
  grab_open: "open grab",
  other: "other",
};

/** A flush volume the tracker may count: mL or L only. Any other unit is shown in words but never turned into a number. */
export function flushVolumeMl(v: { value: number; unit: string } | undefined): number | undefined {
  if (!v) return undefined;
  const u = v.unit.trim().toLowerCase();
  if (u === "ml") return v.value;
  if (u === "l") return v.value * 1000;
  return undefined;
}

/** The method answers of one plan point, only what is stated. Undefined when the point has no answer the view can use. */
/**
 * The tag drawn next to a part added only for the study: "PPQ only" at a PPQ project, "study only" at every other project stage. When the
 * project stage is not set the old rule stays (the point's own type decides), so nothing is guessed. `stage` is the project stage key.
 */
export function studyTagFor(stage: string | undefined, pointIsPpq: boolean): "PPQ only" | "study only" {
  if (stage === undefined) return pointIsPpq ? "PPQ only" : "study only";
  return stage === "ppq" ? "PPQ only" : "study only";
}

export function sampleMethodView(point: SamplingPoint | undefined, stage?: string): SampleMethodView | undefined {
  const m = point?.method;
  if (!point || !m) return undefined;
  const out: SampleMethodView = { text: "" };
  if (m.access) {
    out.access = m.access;
    out.accessText = m.access === "other" ? (m.accessOther ?? "").trim() || "other" : ACCESS_WORDS[m.access];
  }
  // A Y-connector is an addition to the assembly by nature, so it is drawn as one unless the plan says it was not added for the study.
  if (m.added?.forStudyOnly === true || (m.access === "added_y_connector" && m.added?.forStudyOnly !== false)) {
    out.addedForStudy = true;
    out.studyTag = studyTagFor(stage, Boolean(point.type?.startsWith("ppq")));
  }
  if (m.added?.inCommercialAssembly !== undefined) out.inCommercialAssembly = m.added.inCommercialAssembly;
  if (m.added?.removedAfter !== undefined) out.removedAfter = m.added.removedAfter;
  const f = m.flush;
  if (f?.practice && f.practice !== "none_stated_reason") {
    const ml = flushVolumeMl(f.volume);
    out.flush = { practice: f.practice, ...(ml !== undefined ? { volumeMl: ml } : {}), ...(f.volume ? { volumeText: `${f.volume.value} ${f.volume.unit}` } : {}), ...(f.discardTo?.trim() ? { discardTo: f.discardTo.trim() } : {}) };
  }
  if (m.shared?.pointIds?.length) out.sharedWith = [...m.shared.pointIds];
  if (m.shared?.flushBetween !== undefined) out.flushBetween = m.shared.flushBetween;
  if (m.closedSystem) out.closedSystem = m.closedSystem;
  const has = out.access || out.addedForStudy || out.flush || out.sharedWith || out.flushBetween !== undefined || out.closedSystem || out.inCommercialAssembly !== undefined || out.removedAfter !== undefined;
  if (!has) return undefined;
  const bits: string[] = [];
  if (out.accessText) bits.push(out.accessText);
  if (out.addedForStudy) bits.push(`added for ${out.studyTag === "PPQ only" ? "PPQ" : "the study"} only`);
  if (out.inCommercialAssembly !== undefined) bits.push(out.inCommercialAssembly ? "in the commercial assembly" : "not in the commercial assembly");
  if (out.removedAfter !== undefined) bits.push(out.removedAfter ? "removed afterwards" : "not removed afterwards");
  if (out.sharedWith) bits.push(`shared with ${out.sharedWith.join(", ")}`);
  if (out.flushBetween !== undefined) bits.push(out.flushBetween ? "flushed between samples" : "not flushed between samples");
  if (out.flush) {
    const what = out.flush.practice === "flush_volume" ? "flush" : "first draw discarded";
    bits.push(`${what}${out.flush.volumeText ? ` ${out.flush.volumeText}` : " (volume not stated)"}${out.flush.discardTo ? ` to ${out.flush.discardTo}` : ""}`);
  }
  if (out.closedSystem) bits.push(out.closedSystem);
  out.text = bits.join(", ");
  return out;
}

