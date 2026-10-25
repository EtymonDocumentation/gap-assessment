import { z } from "zod";

/*
 * TRD write-ups (project schema 1.20.0, TRD format 1.2.0, write-up library format 1.1.0). Module "trd".
 *
 * A write-up is the prose of the TRD for one unit operation (the "Process description" of a step) or for one TRD-level section
 * (introduction, scope, fill weights ...). It is kept as an ordered list of PARTS so a part can be edited, removed, switched on or
 * off, and compared with the library one by one.
 *
 * Design notes (the why):
 *  - A BLANK is written {{fieldKey|Fallback label}} in the text. The key names the project or TRD value that can fill it; the label
 *    is what the reader sees while it is empty. A blank with no known value stays visible: nothing is filled in on the team's behalf.
 *  - THE RECORD KEEPS ITS OWN COPY of the library write-up and the version it was copied from, like the MBR step blocks and the risk
 *    method. A library edit never reaches a TRD by itself; the TRD shows "Update from library" and the author chooses.
 *  - OPTIONAL PARTS are load-outs with a plain condition label ("include if the product is diluted"). They start switched off.
 *    Nothing here is a rule: no part is required and nothing blocks saving or export.
 *  - The text never states a regulatory filing category. Where a change needs one, the only wording is
 *    "Requires regulatory affairs assessment".
 */

export const TRD_WRITEUP_FORMAT_VERSION = "1.1.0";

/*
 * Figures (format 1.1.0). A figure part in the LIBRARY is a place and a caption ("Figure: stopper position measurement") with no
 * picture: pictures belong to one TRD, never to the shared library. In a TRD the author may attach a PNG or JPEG to it. The picture is
 * kept INSIDE the project file as base64 (the project has no other file store: sources keep only a name and a hash), so a project file
 * stays one self-contained file. Because of that the size is limited: 2 MB per picture and 10 MB of pictures per TRD, which keeps the
 * project file well under the 25 MB the server accepts for one project (base64 adds a third).
 */
export const TRD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const TRD_IMAGES_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const TRD_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;
export type TrdImageType = (typeof TRD_IMAGE_TYPES)[number];

export const trdImageSchema = z
  .object({
    mime: z.enum(TRD_IMAGE_TYPES),
    /** The picture's bytes as base64, without a "data:" prefix. */
    data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, "The picture data is not valid base64"),
    /** Size of the picture file in bytes (the limit applies to this, not to the base64 text). */
    bytes: z.number().int().min(1).max(TRD_IMAGE_MAX_BYTES, "A picture can be at most 2 MB"),
    /** Pixel size, read from the file itself, so the export keeps the aspect ratio without drawing the picture. */
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    /** The file name it was added with (a pasted screenshot has none). Shown to the author; never part of the document text. */
    name: z.string().optional(),
    /** SHA-256 of the file, so the change log can say which picture was attached without holding its bytes. */
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .superRefine((i, ctx) => {
    // Base64 of N bytes is exactly 4 * ceil(N / 3) characters, so a stated size that does not fit the data is a damaged picture.
    if (i.data.length !== Math.ceil(i.bytes / 3) * 4) ctx.addIssue({ code: "custom", message: "The picture data does not match its stated size" });
  });
export type TrdImage = z.infer<typeof trdImageSchema>;

/** What a part of a write-up is. "subsection" is a numbered sub-heading, "heading" an un-numbered bold heading. */
export const TRD_PART_KINDS = ["paragraph", "bullet", "step", "note", "subsection", "heading", "table", "figure"] as const;
export type TrdPartKind = (typeof TRD_PART_KINDS)[number];

export const TRD_PART_KIND_LABELS: Record<TrdPartKind, string> = {
  paragraph: "Paragraph",
  bullet: "Bullet",
  step: "Lettered step",
  note: "Note",
  subsection: "Numbered sub-heading",
  heading: "Heading",
  table: "Table",
  figure: "Figure",
};

const partId = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** One part as the library holds it. */
export const trdLibraryPartSchema = z.object({
  /** Stable inside the write-up, so an update from the library can tell a changed part from a new one. */
  id: partId,
  kind: z.enum(TRD_PART_KINDS),
  /** Body text with {{key|Label}} blanks and **bold**. For a sub-heading or heading, the title is `title` and the text may be empty. */
  text: z.string(),
  title: z.string().optional(),
  /** A table: its column heads and its starting rows. A cell may hold a blank {{key|Label}} like any text. */
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
  /** A figure: the words printed under it after "Figure N." and its alternative text (what the picture shows, for a screen reader). */
  caption: z.string().optional(),
  alt: z.string().optional(),
  /** Present: the part is optional, off until switched on. The condition is plain words for the author. */
  optional: z.object({ condition: z.string().min(1) }).optional(),
});
export type TrdLibraryPart = z.infer<typeof trdLibraryPartSchema>;

/** Where a TRD-level section that belongs to the process overview sits among the steps. */
export const trdPlacementSchema = z.object({ where: z.enum(["after", "before", "last"]), unitOp: z.string().optional() });
export type TrdPlacement = z.infer<typeof trdPlacementSchema>;

const writeupContent = {
  title: z.string().min(1),
  /** Short plain note on when the write-up fits ("process has a bioburden-reduction step"). A hint, never a rule. */
  appliesWhen: z.string().optional(),
  parts: z.array(trdLibraryPartSchema),
  /** The whole write-up may be not applicable (a dilution buffer section when dilution is done elsewhere). */
  notApplicable: z.object({ condition: z.string().min(1), text: z.string() }).optional(),
};

export const trdLibraryVersionSchema = z.object({ version: z.number().int().min(1), ...writeupContent, at: z.string().optional(), by: z.string().optional() });
export type TrdLibraryVersion = z.infer<typeof trdLibraryVersionSchema>;

export const trdLibraryWriteupSchema = z
  .object({
    /** wu_<unit op> for a unit operation, sec_<key> for a TRD-level section. */
    id: partId,
    version: z.number().int().min(1),
    kind: z.enum(["unitOp", "section"]),
    /** Catalog unit-operation key (kind unitOp) or the section key (kind section). */
    key: z.string().min(1),
    ...writeupContent,
    /** For a TRD-level section that sits inside the process overview. Absent: a top-level section of its own. */
    placement: trdPlacementSchema.optional(),
    /** False: not copied into a new TRD by itself; the author adds it from the library when needed. */
    autoAdd: z.boolean().optional(),
    custom: z.boolean().optional(),
    at: z.string().optional(),
    by: z.string().optional(),
    /** Earlier versions in full, newest last. */
    history: z.array(trdLibraryVersionSchema).optional(),
  })
  .superRefine((w, ctx) => {
    const seen = new Set<string>();
    for (const p of w.parts) {
      if (seen.has(p.id)) ctx.addIssue({ code: "custom", message: `Write-up ${w.id}: part ${p.id} appears twice` });
      seen.add(p.id);
    }
  });
export type TrdLibraryWriteup = z.infer<typeof trdLibraryWriteupSchema>;

export const trdLibraryFileSchema = z
  .object({ formatVersion: z.string(), libraryVersion: z.string().optional(), writeups: z.array(trdLibraryWriteupSchema) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const w of f.writeups) {
      if (seen.has(w.id)) ctx.addIssue({ code: "custom", message: `Library write-up ${w.id} appears twice` });
      seen.add(w.id);
    }
  });
export type TrdLibraryFile = z.infer<typeof trdLibraryFileSchema>;

// ------------------------------------------------------------------ the record's copy

/** A part in a TRD: the library part plus what the author did with it. */
export const trdPartSchema = trdLibraryPartSchema.extend({
  /** A figure part: the attached picture. Absent: the part is an open placeholder ("Figure to be added"). */
  image: trdImageSchema.optional(),
  /** Optional parts only: true once switched on. Absent: off. */
  included: z.boolean().optional(),
  /** True once the author changed the text, so "Update from library" can say the part was edited here. */
  edited: z.boolean().optional(),
});
export type TrdPart = z.infer<typeof trdPartSchema>;

/** A value the author typed for a blank, with who and when. It wins over a value found in the project. */
export const trdBlankValueSchema = z.object({ value: z.string(), by: z.string(), at: z.string() });
export type TrdBlankValue = z.infer<typeof trdBlankValueSchema>;

export const trdWriteupSchema = z.object({
  /** WU-01, WU-02 ... never reused inside a TRD. */
  id: z.string().regex(/^WU-\d{2,}$/),
  kind: z.enum(["unitOp", "section"]),
  key: z.string().min(1),
  /** The step the write-up belongs to (kind unitOp). */
  stepId: z.string().regex(/^TS-\d{2,}$/).optional(),
  title: z.string().min(1),
  /** The library entry the write-up was copied from and the version at that time. Absent: written here. */
  libraryId: z.string().optional(),
  libraryVersion: z.number().int().min(1).optional(),
  placement: trdPlacementSchema.optional(),
  /** True once the author moved the write-up, so "Update from library" keeps the place they chose. */
  placementEdited: z.boolean().optional(),
  appliesWhen: z.string().optional(),
  parts: z.array(trdPartSchema),
  /** Library part ids the author removed, so an update from the library does not offer them again as new. */
  removed: z.array(z.string()).optional(),
  /** The whole write-up is marked not applicable (only when the library entry allows it). */
  notApplicable: z.object({ condition: z.string().min(1), text: z.string(), on: z.boolean() }).optional(),
  /** Blank key -> value typed here. */
  values: z.record(z.string(), trdBlankValueSchema).optional(),
});
export type TrdWriteup = z.infer<typeof trdWriteupSchema>;

// ------------------------------------------------------------------ blanks in text

/** A blank in text: {{fieldKey|Fallback label}}. The label is optional; the key stays visible when it is missing. */
export const BLANK_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g;

export interface BlankRef {
  key: string;
  label: string;
}

/** The blanks of a text, in order, each key once. */
export function blanksOf(text: string): BlankRef[] {
  const out: BlankRef[] = [];
  for (const m of text.matchAll(BLANK_PATTERN)) {
    const key = m[1]!;
    if (!out.some((b) => b.key === key)) out.push({ key, label: (m[2] ?? "").trim() || key });
  }
  return out;
}
