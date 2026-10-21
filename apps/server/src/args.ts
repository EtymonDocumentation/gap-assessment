/** Small command-line parser shared by the server and the admin CLI: `--name value`, `--flag`, and plain words. */

export interface ParsedArgs {
  positional: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[], flagNames: string[] = []): ParsedArgs {
  const out: ParsedArgs = { positional: [], options: new Map(), flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      out.positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (flagNames.includes(name)) {
      out.flags.add(name);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`The option --${name} needs a value.`);
    out.options.set(name, value);
    i++;
  }
  return out;
}

/** A mistake in how the command was typed; shown as plain text. */
export class UsageError extends Error {}

/** The server's options from its command line. --data is required: there is no default data folder. */
export function serverOptionsFromArgs(argv: string[]): { dataDir: string; port: number; webDir?: string } {
  const args = parseArgs(argv);
  const dataDir = args.options.get("data");
  if (!dataDir) {
    throw new UsageError("--data <dir> is required: the folder that holds the accounts and projects (outside the repository).");
  }
  const port = Number(args.options.get("port") ?? "8787");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be a number from 0 to 65535.");
  const webDir = args.options.get("web");
  return { dataDir, port, ...(webDir ? { webDir } : {}) };
}
