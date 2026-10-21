import { loadCatalog } from "./catalog";
import raw from "../catalog/catalog.yaml";

/**
 * The validated process-model catalog (entry point "@gap/process-model/catalog"). It is a separate entry point from the
 * package root because it reads a YAML file: a consumer that only needs the types and schemas (the laptop server, for
 * example) does not pull the catalog in. Validation runs when the module loads, so a bad catalog stops the build.
 * In the published package the YAML is converted to JSON by the build script; the source stays YAML for people to edit.
 */
export const catalog = loadCatalog(raw);
