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
