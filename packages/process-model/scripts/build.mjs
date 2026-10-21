// Builds dist/: JavaScript and .d.ts for the package, with the YAML catalog converted to JSON.
// The workspace itself never uses dist (it consumes the TypeScript source), so a normal development run needs no build.
// Run:  npm run build -w @gap/process-model
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

// Found by walking up from the package: TypeScript does not export its bin file, so require.resolve cannot name it.
const findUp = (rel) => {
  for (let d = root; ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", rel))) return join(d, "node_modules", rel);
    if (dirname(d) === d) throw new Error(`Cannot find ${rel}; run npm install`);
  }
};
const tsc = findUp(join("typescript", "bin", "tsc"));
const run = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], { cwd: root, stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);

// The source writes relative imports without an extension (the bundlers of this repo do not need one). Plain Node needs ".js",
// so the emitted files get it here, in the import and export statements of the .js and .d.ts files.
const fix = (text) => text.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, c) => (/\.(js|json)$/.test(spec) ? m : `${a}${spec}.js${c}`));
for (const f of readdirSync(dist)) {
  if (f.endsWith(".js") || f.endsWith(".d.ts")) writeFileSync(join(dist, f), fix(readFileSync(join(dist, f), "utf8")));
}

// The catalog entry point: the YAML source becomes JSON, validated by the same loader when the module loads.
const yaml = require("js-yaml");
mkdirSync(join(dist, "catalog"), { recursive: true });
const parsed = yaml.load(readFileSync(join(root, "catalog", "catalog.yaml"), "utf8"));
writeFileSync(join(dist, "catalog", "catalog.json"), JSON.stringify(parsed));
writeFileSync(
  join(dist, "catalog-data.js"),
  'import { loadCatalog } from "./catalog.js";\nimport raw from "./catalog/catalog.json" with { type: "json" };\nexport const catalog = loadCatalog(raw);\n',
);
writeFileSync(join(dist, "catalog-data.d.ts"), 'import type { Catalog } from "./catalog.js";\nexport declare const catalog: Catalog;\n');
cpSync(join(root, "README.md"), join(dist, "README.md"));
console.log("process-model: dist/ written");
