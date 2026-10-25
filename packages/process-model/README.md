# @gap/process-model

The shared fill/finish process model. It describes WHAT a process is made of and how a value about it is recorded. It does not
say how a tool compares, reports or documents it. The gap assessment tool uses it today; the technical requirements document (TRD)
tool and the master batch record (MBR) tool are meant to read the same model and the same project files.

Version 1.0.0. The package is `private: true` for now (it is used inside this repository through npm workspaces). Nothing is
published; the package is prepared so that publishing later is one command (see "Publishing later").

## What is in it

| Area | Files | What it gives you |
| --- | --- | --- |
| Types and project schema | `types.ts`, `schema.ts` | `Project`, `Entry`, `Source`, `UnitOperation`, the zod schemas, `parseProject()` with migrations, `SCHEMA_VERSION` |
| Entries | `entries.ts`, `paths.ts` | `resolveEntry()` (follows "same as SU", labels a TBD best guess provisional), references (`parseRef`, `getEntry`), fingerprints, verification |
| Sources | `sources.ts` | add, attach, detach and update sources of a value |
| Units | `units.ts` | quantities, ranges and unit conversion |
| Custom items | `custom.ts` | the keys of unit operations and items a project adds (`x_...`) |
| Catalog | `catalog.ts`, `catalog/catalog.yaml` | unit operations, stage groups, field labels and option sets; `loadCatalog()` validates it |
| Conditions | `condition.ts` | the shape of "applicable when" conditions (the evaluator stays with the tool that has a project) |
| TRD seed | `trd-seed.ts` | `trdSeedSchema`, `parseTrdSeed()`, the format `gap-assessment.trd-seed` 1.0.0 |
| Version | `version.ts` | `PROCESS_MODEL_VERSION` |

Two entry points:

- `@gap/process-model`: everything above except the catalog data. It needs no YAML loader, so a server can import it as plain TypeScript.
- `@gap/process-model/catalog`: the validated `catalog` object. Its source is `catalog/catalog.yaml`; the build converts it to JSON for plain Node.

## What is deliberately NOT in it

Everything that exists only because two sides are compared stays in the gap assessment (`content/` and `@gap/engine`):

- comparison rules, severities, comparison categories and validation activities (`content/catalog/gap-overlay.yaml` holds the activities and categories that used to share the catalog file),
- the interview questions, the document wording and templates,
- the gap register, the review and export workflow, the Word and HTML renderers.

The rule of thumb is: if a TRD tool reading one receiving-unit process would not need it, it does not belong here.

## Side-agnostic rule

The model never assumes there are two sides. A project file carries a `source` and a `target` process because the gap
assessment compares them, but nothing in the catalog, the schemas of one entry, or the TRD seed requires both. User-facing
wording says SU (sending unit) and RU (receiving unit); data keys stay `source` and `target`.

## No defaults

The catalog supplies options, never answers. A value that nobody recorded is `not_established` and stays visible as such; a TBD
best guess is read as provisional and is never stored as a value. `parseTrdSeed()` enforces these rules on the seed format, so a
seed that puts a value on a not-established field is refused.

## How other tools use it

```ts
import { parseProject, resolveEntry, parseTrdSeed } from "@gap/process-model";
import { catalog } from "@gap/process-model/catalog";

const project = parseProject(JSON.parse(text)); // migrates older project files
const seed = parseTrdSeed(seedText);            // a TRD seed exported by the gap assessment tool
```

The only runtime dependency is `zod`. A test (`test/package.test.ts`) scans the sources and fails if the package imports
anything else, so it can be lifted out of this repository without untangling.

## Versioning (semver)

`PROCESS_MODEL_VERSION` equals the version in `package.json` (a test keeps them equal). The catalog (`catalog.version`, the
content version) and the project schema (`SCHEMA_VERSION`) have their own versions.

- Major: removing or renaming an export, a schema field or a catalog key; changing what a field means; raising the required
  project schema in a way an older reader cannot open.
- Minor: a new export, an optional schema field, a new catalog unit operation, item or option.
- Patch: wording fixes and bug fixes that do not change a result's meaning.

`test/package.test.ts` holds a snapshot of the exported names and of the shape of Entry, Source and the catalog. A change to it
is a change to the public interface and needs a version decision in the same commit, and a line in `CHANGELOG.md`.

The TRD seed format has its own version (`TRD_SEED_VERSION`, in `meta.formatVersion`). A reader accepts any `1.x` file; a new
optional field is a minor change, anything else is a new major format.

## Building and publishing later

```
npm run build -w @gap/process-model     # writes dist/ (JavaScript, .d.ts, catalog.json); dist/ is not committed
```

`npm pack` and `npm publish` run `prepack`, which builds `dist/` and temporarily swaps the entry points in `package.json` to the
built files (`publishConfig`); `postpack` restores them. To publish, remove `"private": true` first, and decide on the package
scope and registry. Nothing in the repository does this today.
