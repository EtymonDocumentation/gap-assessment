export { BUILTIN_TEMPLATE_VERSION } from "./version";
export { TemplateError } from "./errors";
export type {
  FigureRasteriser,
  HeadingMapping,
  ImportedTemplate,
  OutlineHeading,
  RenderDocxInput,
  RenderDocxResult,
  TemplateAnalysis,
  TemplateMapping,
  TemplateMode,
  TrdRenderInput,
  ToolBlock,
} from "./types";
export { importTemplateFile } from "./import";
export { mappingReport, suggestMapping, toolBlocks } from "./mapping";
export type { MappingReport } from "./mapping";
export { TAG_REFERENCE, buildDocumentTagData, buildSamplingTagData, buildTagData, tagReferenceMarkdown } from "./tags";
export type { DocumentTagData, GapTag, SamplingTagData, TagData, TagReferenceEntry } from "./tags";
export { buildStarterTemplate } from "./starter";
export { renderDocx } from "./render";
export { FIGURE_DPI } from "./types";
export { readOutlineFromPdf } from "./pdf";
export { FIXTURE_FILES } from "./fixtures";
export { buildTrdFormDocx, FORM_INTRO, FORM_PLACEHOLDER } from "./trd-form";
export { buildSamplingFormDocx, SAMPLING_FORM_INTRO } from "./sampling-form";
export { buildGapFormDocx, GAP_FORM_INTRO } from "./gap-form";
export { readTrdUpload } from "./trd-read";
export { readTrdUpload as readUpload } from "./trd-read";
export { readDataPart, writeDataPart } from "./trd-data";
export type { DataPart } from "./trd-data";
export { readTrdPdf } from "./trd-read-pdf";
export { readTrdPdf as readPdfUpload } from "./trd-read-pdf";
