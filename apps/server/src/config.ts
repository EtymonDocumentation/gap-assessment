/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** Thrown for a problem the operator can fix (missing folder, missing config); shown as plain text, no stack. */
export class ConfigError extends Error {}

export const configSchema = z
  .object({
    storage: z.enum(["server", "client"]),
    maxUploadMB: z.number().int().min(1).max(1024),
  })
  .strict();

export type ServerConfig = z.infer<typeof configSchema>;

export function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

/** Reads <data>/config.json. There is no default: only `admin init` creates the file. */
export async function loadConfig(dataDir: string): Promise<ServerConfig> {
  let text: string;
  try {
    text = await readFile(configPath(dataDir), "utf8");
  } catch {
    throw new ConfigError(
      `There is no config.json in the data folder (${dataDir}). Create the folder's settings first with: ` +
        `admin init --data <dir> --storage server|client --max-upload-mb <n>`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError(`config.json in ${dataDir} is not valid JSON.`);
  }
  const res = configSchema.safeParse(raw);
  if (!res.success) {
    const why = res.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
    throw new ConfigError(`config.json in ${dataDir} is not valid (${why}).`);
  }
  return res.data;
}
