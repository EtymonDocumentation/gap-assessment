/**
 * MIL-STD-414 (11 June 1957, including Notice 1): Section B, standard deviation method.
 * Table A-2 (code letters), B-1 (k, normal and tightened), B-2 (k, reduced), B-3 (M, normal and
 * tightened) and B-4 (M, reduced), stored as data.
 *
 * SOURCE COPY: the typeset scan of MIL-STD-414 held at archive.org (item "MIL-STD-414");
 * A-2 = printed page 4, B-1 = p. 39, B-2 = p. 40, B-3 = p. 45, B-4 = p. 46. US Department of
 * Defense standard (public domain). Equivalent to ANSI/ASQ Z1.9, which is a licensed document:
 * confirm against your licensed copy before relying on a plan.
 *
 * HOW THE TABLES WERE CHECKED (see test/stats/variables.test.ts):
 *  - 374 non-arrow k cells of B-1 (normal and tightened) agree with the independent
 *    "Planesmuestra" R package data (Montgomery 2005).
 *  - The standard prints reduced values as the normal values of the next AQL at the same sample
 *    size (B-2 vs B-1, B-4 vs B-3); the tests re-derive that relation from the transcription,
 *    which cross-checks the whole of B-2 and B-4 and B-3 columns .065 to 15.00.
 *  - Table B-3 column .04 has no second source (single-source transcription).
 *
 * null = the cell holds an arrow in the standard: "use the first sampling plan below the arrow,
 * that is, both sample size as well as k (or M)".
 * Columns follow AQL_VALUES_414 for the normal tables and the first 13 of them (.04 to 10.00)
 * for the reduced tables. TIGHTENED inspection has no table of its own: the standard prints the
 * tightened AQL under the normal column that is one step lower (.065 under .04 ... 15.00 under 10.00).
 */
export const CODE_LETTERS_414 = ["B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q"] as const;
export type CodeLetter414 = (typeof CODE_LETTERS_414)[number];

export const AQL_VALUES_414 = [0.04, 0.065, 0.10, 0.15, 0.25, 0.40, 0.65, 1.00, 1.50, 2.50, 4.00, 6.50, 10.00, 15.00] as const;

/** Sample sizes of Tables B-1 and B-3 by code letter. */
export const SAMPLE_SIZE_414: Record<CodeLetter414, number> = {B:3,C:4,D:5,E:7,F:10,G:15,H:20,I:25,J:30,K:35,L:40,M:50,N:75,O:100,P:150,Q:200};
/** Sample sizes of Tables B-2 and B-4 (reduced inspection) by code letter. */
export const SAMPLE_SIZE_414_REDUCED: Record<CodeLetter414, number> = {B:3,C:3,D:3,E:3,F:4,G:5,H:7,I:10,J:10,K:15,L:20,M:20,N:25,O:30,P:50,Q:75};

/** Table A-2: lot size upper bounds (last row open ended) and letters for levels I to V. */
export const TABLE_A2_LOT_MAX = [8,15,25,40,65,110,180,300,500,800,1300,3200,8000,22000,110000,550000,null] as const;
export const TABLE_A2: Record<string, string> = {
  I:  "BBBBBBBBCDEFGHIII",
  II: "BBBBBBCDEFGHIJKKK",
  III:"BBBBCDEFGHIJLMNOP",
  IV: "BBCDEFGHIJKLMNOPQ",
  V:  "CDEFGHIJKLLMNOPQQ",
};

/** Table B-1: k for normal (and, one AQL column shifted, tightened) inspection, Form 1. */
export const K_NORMAL_414: Record<CodeLetter414, readonly (number | null)[]> = {
  B: [null, null, null, null, null, null, null, null, null, 1.12, 0.958, 0.765, 0.566, 0.341],
  C: [null, null, null, null, null, null, null, 1.45, 1.34, 1.17, 1.01, 0.814, 0.617, 0.393],
  D: [null, null, null, null, null, null, 1.65, 1.53, 1.4, 1.24, 1.07, 0.874, 0.675, 0.455],
  E: [null, null, null, null, 2.0, 1.88, 1.75, 1.62, 1.5, 1.33, 1.15, 0.955, 0.755, 0.536],
  F: [null, null, null, 2.24, 2.11, 1.98, 1.84, 1.72, 1.58, 1.41, 1.23, 1.03, 0.828, 0.611],
  G: [2.64, 2.53, 2.42, 2.32, 2.2, 2.06, 1.91, 1.79, 1.65, 1.47, 1.3, 1.09, 0.886, 0.664],
  H: [2.69, 2.58, 2.47, 2.36, 2.24, 2.11, 1.96, 1.82, 1.69, 1.51, 1.33, 1.12, 0.917, 0.695],
  I: [2.72, 2.61, 2.5, 2.4, 2.26, 2.14, 1.98, 1.85, 1.72, 1.53, 1.35, 1.14, 0.936, 0.712],
  J: [2.73, 2.61, 2.51, 2.41, 2.28, 2.15, 2.0, 1.86, 1.73, 1.55, 1.36, 1.15, 0.946, 0.723],
  K: [2.77, 2.65, 2.54, 2.45, 2.31, 2.18, 2.03, 1.89, 1.76, 1.57, 1.39, 1.18, 0.969, 0.745],
  L: [2.77, 2.66, 2.55, 2.44, 2.31, 2.18, 2.03, 1.89, 1.76, 1.58, 1.39, 1.18, 0.971, 0.746],
  M: [2.83, 2.71, 2.6, 2.5, 2.35, 2.22, 2.08, 1.93, 1.8, 1.61, 1.42, 1.21, 1.0, 0.774],
  N: [2.9, 2.77, 2.66, 2.55, 2.41, 2.27, 2.12, 1.98, 1.84, 1.65, 1.46, 1.24, 1.03, 0.804],
  O: [2.92, 2.8, 2.69, 2.58, 2.43, 2.29, 2.14, 2.0, 1.86, 1.67, 1.48, 1.26, 1.05, 0.819],
  P: [2.96, 2.84, 2.73, 2.61, 2.47, 2.33, 2.18, 2.03, 1.89, 1.7, 1.51, 1.29, 1.07, 0.841],
  Q: [2.97, 2.85, 2.73, 2.62, 2.47, 2.33, 2.18, 2.04, 1.89, 1.7, 1.51, 1.29, 1.07, 0.845],
};

/** Table B-3: maximum allowable percent nonconforming M, normal/tightened, Form 2. */
export const M_NORMAL_414: Record<CodeLetter414, readonly (number | null)[]> = {
  B: [null, null, null, null, null, null, null, null, null, 7.59, 18.86, 26.94, 33.69, 40.47],
  C: [null, null, null, null, null, null, null, 1.53, 5.5, 10.92, 16.45, 22.86, 29.45, 36.9],
  D: [null, null, null, null, null, null, 1.33, 3.32, 5.83, 9.8, 14.39, 20.19, 26.56, 33.99],
  E: [null, null, null, null, 0.422, 1.06, 2.14, 3.55, 5.35, 8.4, 12.2, 17.35, 23.29, 30.5],
  F: [null, null, null, 0.349, 0.716, 1.3, 2.17, 3.26, 4.77, 7.29, 10.54, 15.17, 20.74, 27.57],
  G: [0.099, 0.186, 0.312, 0.503, 0.818, 1.31, 2.11, 3.05, 4.31, 6.56, 9.46, 13.71, 18.94, 25.61],
  H: [0.135, 0.228, 0.365, 0.544, 0.846, 1.29, 2.05, 2.95, 4.09, 6.17, 8.92, 12.99, 18.03, 24.53],
  I: [0.155, 0.25, 0.38, 0.551, 0.877, 1.29, 2.0, 2.86, 3.97, 5.97, 8.63, 12.57, 17.51, 23.97],
  J: [0.179, 0.28, 0.413, 0.581, 0.879, 1.29, 1.98, 2.83, 3.91, 5.86, 8.47, 12.36, 17.24, 23.58],
  K: [0.17, 0.264, 0.388, 0.535, 0.847, 1.23, 1.87, 2.68, 3.7, 5.57, 8.1, 11.87, 16.65, 22.91],
  L: [0.179, 0.275, 0.401, 0.566, 0.873, 1.26, 1.88, 2.71, 3.72, 5.58, 8.09, 11.85, 16.61, 22.86],
  M: [0.163, 0.25, 0.363, 0.503, 0.789, 1.17, 1.71, 2.49, 3.45, 5.2, 7.61, 11.23, 15.87, 22.0],
  N: [0.147, 0.228, 0.33, 0.467, 0.72, 1.07, 1.6, 2.29, 3.2, 4.87, 7.15, 10.63, 15.13, 21.11],
  O: [0.145, 0.22, 0.317, 0.447, 0.689, 1.02, 1.53, 2.2, 3.07, 4.69, 6.91, 10.32, 14.75, 20.66],
  P: [0.134, 0.203, 0.293, 0.413, 0.638, 0.949, 1.43, 2.05, 2.89, 4.43, 6.57, 9.88, 14.2, 20.02],
  Q: [0.135, 0.204, 0.294, 0.414, 0.637, 0.945, 1.42, 2.04, 2.87, 4.4, 6.53, 9.81, 14.12, 19.92],
};

/** Table B-2: k for reduced inspection, Form 1 (13 AQL columns, .04 to 10.00). */
export const K_REDUCED_414: Record<CodeLetter414, readonly (number | null)[]> = {
  B: [null, null, null, null, null, null, null, null, 1.12, 0.958, 0.765, 0.566, 0.341],
  C: [null, null, null, null, null, null, null, null, 1.12, 0.958, 0.765, 0.566, 0.341],
  D: [null, null, null, null, null, null, null, null, 1.12, 0.958, 0.765, 0.566, 0.341],
  E: [null, null, null, null, null, null, null, null, 1.12, 0.958, 0.765, 0.566, 0.341],
  F: [null, null, null, null, null, null, 1.45, 1.34, 1.17, 1.01, 0.814, 0.617, 0.393],
  G: [null, null, null, null, null, 1.65, 1.53, 1.4, 1.24, 1.07, 0.874, 0.675, 0.455],
  H: [null, null, null, 2.0, 1.88, 1.75, 1.62, 1.5, 1.33, 1.15, 0.955, 0.755, 0.536],
  I: [null, null, 2.24, 2.11, 1.98, 1.84, 1.72, 1.58, 1.41, 1.23, 1.03, 0.828, 0.611],
  J: [null, null, 2.24, 2.11, 1.98, 1.84, 1.72, 1.58, 1.41, 1.23, 1.03, 0.828, 0.611],
  K: [2.53, 2.42, 2.32, 2.2, 2.06, 1.91, 1.79, 1.65, 1.47, 1.3, 1.09, 0.886, 0.664],
  L: [2.58, 2.47, 2.36, 2.24, 2.11, 1.96, 1.82, 1.69, 1.51, 1.33, 1.12, 0.917, 0.695],
  M: [2.58, 2.47, 2.36, 2.24, 2.11, 1.96, 1.82, 1.69, 1.51, 1.33, 1.12, 0.917, 0.695],
  N: [2.61, 2.5, 2.4, 2.26, 2.14, 1.98, 1.85, 1.72, 1.53, 1.35, 1.14, 0.936, 0.712],
  O: [2.61, 2.51, 2.41, 2.28, 2.15, 2.0, 1.86, 1.73, 1.55, 1.36, 1.15, 0.946, 0.723],
  P: [2.71, 2.6, 2.5, 2.35, 2.22, 2.08, 1.93, 1.8, 1.61, 1.42, 1.21, 1.0, 0.774],
  Q: [2.77, 2.66, 2.55, 2.41, 2.27, 2.12, 1.98, 1.84, 1.65, 1.46, 1.24, 1.03, 0.804],
};

/** Table B-4: M for reduced inspection, Form 2 (13 AQL columns, .04 to 10.00). */
export const M_REDUCED_414: Record<CodeLetter414, readonly (number | null)[]> = {
  B: [null, null, null, null, null, null, null, null, 7.59, 18.86, 26.94, 33.69, 40.47],
  C: [null, null, null, null, null, null, null, null, 7.59, 18.86, 26.94, 33.69, 40.47],
  D: [null, null, null, null, null, null, null, null, 7.59, 18.86, 26.94, 33.69, 40.47],
  E: [null, null, null, null, null, null, null, null, 7.59, 18.86, 26.94, 33.69, 40.47],
  F: [null, null, null, null, null, null, 1.53, 5.5, 10.92, 16.45, 22.86, 29.45, 36.9],
  G: [null, null, null, null, null, 1.33, 3.32, 5.83, 9.8, 14.39, 20.19, 26.56, 33.99],
  H: [null, null, null, 0.422, 1.06, 2.14, 3.55, 5.35, 8.4, 12.2, 17.35, 23.29, 30.5],
  I: [null, null, 0.349, 0.716, 1.3, 2.17, 3.26, 4.77, 7.29, 10.54, 15.17, 20.74, 27.57],
  J: [null, null, 0.349, 0.716, 1.3, 2.17, 3.26, 4.77, 7.29, 10.54, 15.17, 20.74, 27.57],
  K: [0.186, 0.312, 0.503, 0.818, 1.31, 2.11, 3.05, 4.31, 6.56, 9.46, 13.71, 18.94, 25.61],
  L: [0.228, 0.365, 0.544, 0.846, 1.29, 2.05, 2.95, 4.09, 6.17, 8.92, 12.99, 18.03, 24.53],
  M: [0.228, 0.365, 0.544, 0.846, 1.29, 2.05, 2.95, 4.09, 6.17, 8.92, 12.99, 18.03, 24.53],
  N: [0.25, 0.38, 0.551, 0.877, 1.29, 2.0, 2.86, 3.97, 5.97, 8.63, 12.57, 17.51, 23.97],
  O: [0.28, 0.413, 0.581, 0.879, 1.29, 1.98, 2.83, 3.91, 5.86, 8.47, 12.36, 17.24, 23.58],
  P: [0.25, 0.363, 0.503, 0.789, 1.17, 1.71, 2.49, 3.45, 5.2, 7.61, 11.23, 15.87, 22.0],
  Q: [0.228, 0.33, 0.467, 0.72, 1.07, 1.6, 2.29, 3.2, 4.87, 7.15, 10.63, 15.13, 21.11],
};
