// Applies (and afterwards restores) the "publishConfig" overrides of package.json for npm, which does not apply them itself:
// main, types and exports point to dist/ in the packed package, to the TypeScript source in the workspace.
// Used by the prepack and postpack scripts. The package is private today, so nothing is published.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "package.json");
const backup = join(root, "package.json.orig");

if (process.argv[2] === "apply") {
  copyFileSync(file, backup);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const { main, types, exports } = pkg.publishConfig ?? {};
  Object.assign(pkg, { main, types, exports });
  delete pkg.publishConfig.main;
  delete pkg.publishConfig.types;
  delete pkg.publishConfig.exports;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
} else if (process.argv[2] === "restore" && existsSync(backup)) {
  copyFileSync(backup, file);
  rmSync(backup);
}
