/// <reference types="node" />
import { runAdmin } from "./admin-commands";

// Entry point of dist/admin.mjs:  node dist/admin.mjs <command> --data <dir> ...
const code = await runAdmin(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
process.exit(code);
