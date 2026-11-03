import type { MbrRecord, Project } from "@gap/process-model";
import { sampleIdsTakenAt } from "./mbr";
import { ppqOnlyLeftOut, leftOutSentence } from "./stage-chain";
import { projectStage, type ProgramStage } from "./stage";

/*
 * Which batch-record items are PPQ-only, and which of them the project stage leaves out (job L2).
 * GMP reason: the hold and time challenges and the extra PPQ samples belong to the PPQ lots; a clinical, engineering or routine batch
 * does not repeat them. NOTHING is deleted: a left-out item stays in the saved record, is listed in the document and the app, and the
 * author can switch it back on with "Include anyway" (record.includeAnyway). An unset stage leaves nothing out (wider wording).
 */

export interface MbrStageItem {
  id: string;
  kind: "step" | "parameter" | "sample";
  /** Where it sits: "Section title, block title". */
  where: string;
  /** Short words for the item. */
  text: string;
  /** True when the author switched it back on. */
  includedAnyway: boolean;
}

export interface MbrStageView {
  stage: ProgramStage | undefined;
  /** PPQ-only items that are out of the document now. */
  leftOut: MbrStageItem[];
  /** PPQ-only items that the author kept in at this stage. */
  keptIn: MbrStageItem[];
  /** "3 PPQ-only items are left out because the project stage is Clinical." Empty when nothing is left out. */
  sentence: string;
}

/** Every PPQ-only item of the record, whatever the stage. */
export function mbrPpqOnlyItems(project: Project, rec: MbrRecord): MbrStageItem[] {
  const plan = rec.planId ? project.sampling.plans.find((p) => p.id === rec.planId) : undefined;
  const ppqPoint = (id: string): boolean => {
    const pt = plan?.points.find((p) => p.id === id);
    return !!pt && (pt.afterPpq === "ppq_only" || pt.type === "ppq_enhanced");
  };
  const kept = new Set(rec.includeAnyway ?? []);
  const out: MbrStageItem[] = [];
  for (const s of rec.sections) {
    for (const b of s.blocks) {
      const where = `${s.title}, ${b.title}`;
      for (const st of b.steps) {
        const ids = sampleIdsTakenAt(st);
        if (ids.length && ids.every(ppqPoint)) out.push({ id: st.id, kind: "step", where, text: st.text.replace(/\[\[step:[^\]]*\]\]/g, "").trim().slice(0, 120), includedAnyway: kept.has(st.id) });
      }
      for (const r of b.params) if (r.studyPoint) out.push({ id: r.id, kind: "parameter", where, text: `${r.label}: hold or time challenge`, includedAnyway: kept.has(r.id) });
      for (const r of b.samples) if (ppqPoint(r.pointId)) out.push({ id: r.id, kind: "sample", where, text: `Sample ${r.pointId}: ${r.test}`, includedAnyway: kept.has(r.id) });
    }
  }
  return out;
}

/** The ids the document leaves out for this record at the project's stage. */
export function mbrLeftOutIds(project: Project, rec: MbrRecord): Set<string> {
  return new Set(mbrStageView(project, rec).leftOut.map((i) => i.id));
}

export function mbrStageView(project: Project, rec: MbrRecord): MbrStageView {
  const stage = projectStage(project);
  const all = mbrPpqOnlyItems(project, rec);
  if (!ppqOnlyLeftOut(stage)) return { stage, leftOut: [], keptIn: [], sentence: "" };
  const leftOut = all.filter((i) => !i.includedAnyway);
  const keptIn = all.filter((i) => i.includedAnyway);
  return { stage, leftOut, keptIn, sentence: leftOut.length ? leftOutSentence(stage, leftOut.length) : "" };
}
