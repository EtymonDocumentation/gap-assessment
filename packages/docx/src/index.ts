export { BUILTIN_TEMPLATE_VERSION } from "./version";
export { TemplateError } from "./errors";
export type {
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
export { TAG_REFERENCE, buildTagData, tagReferenceMarkdown } from "./tags";
export type { GapTag, TagData, TagReferenceEntry } from "./tags";
export { buildStarterTemplate } from "./starter";
export { renderDocx } from "./render";
export { readOutlineFromPdf } from "./pdf";
export { FIXTURE_FILES } from "./fixtures";
