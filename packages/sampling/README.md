# @gap/sampling

Sampling plans for PPQ (process performance qualification) protocols. Proof of concept: not validated, not for GMP use.

- `src/stats/` the statistics: five pure methods that each return a `SampleSizeResult` (sample size, `working` steps for the document,
  `citation`, and `problems`). A missing or invalid input gives `ok: false` and plain-language problems; nothing is defaulted or guessed.
- `src/plan/` the plan logic over the plan data of `@gap/process-model`.

Depends only on `zod` and `@gap/process-model`. It never imports the engine, content, renderers or apps (a test scans the imports).

## Methods

| Function | Method | Source |
| --- | --- | --- |
| `companyTablePlan` | The company's own lot-size table (never extrapolated) | the table's own name, version and document reference |
| `fixedCountPlan` | A count the project fixes, with its basis | the basis text |
| `confRelPlan` | Smallest n with P(X <= c given n, 1 - R) <= 1 - C (binomial, log space, search capped at 1,000,000) | the formula |
| `aqlPlan` | Attributes, single sampling, MIL-STD-105E Table I and II-A/B/C with the arrow rule | MIL-STD-105E (public domain); equivalent to ANSI/ASQ Z1.4 |
| `variablesPlan` | Variables, standard deviation method, MIL-STD-414 Section B: Form 1 (k), Form 2 (M) | MIL-STD-414 (public domain); equivalent to ANSI/ASQ Z1.9 |

The tables are data in `src/stats/tables/`, each with a header naming the source copy. They are cited, never copied from the
licensed ANSI/ASQ or ISO documents: confirm every plan against your licensed copy.

### Not supported in this version

MIL-STD-414: the range method (Section C), variability known (Section D), different AQLs for the upper and lower limit (Example B-4 plan),
AQLs other than the standard's 14 values (no conversion table A-1), and the estimation of the lot fraction nonconforming (Table B-5,
needed only to judge a lot, not to set the plan). MIL-STD-105E: double and multiple sampling, switching rules between normal, tightened
and reduced (the user chooses the severity), Table III onwards.

### Inspection levels

MIL-STD-105E has S-1 to S-4 and I to III. MIL-STD-414 has I to V (IV is its normal level). The two are separate types
(`AqlLevel`, `VarLevel`); no mapping between them is invented.

### Tightened inspection in MIL-STD-414

The standard prints the tightened AQL under the normal column one step lower (tightened .065 is read in the normal .04 column).
There is therefore no tightened plan for AQL .04, and no reduced plan for AQL 15 (Tables B-2 and B-4 end at 10).

## Checks

`test/stats` holds the tests: known values from the standards and their worked examples, monotonicity, table integrity (every cell
resolves, arrows never loop), the import scan, and the public API snapshot. The 105E and 414 tables are also checked cell by cell against
a second source (the Planesmuestra R package) and against the standard's own reduced-equals-next-AQL relation.

## Versioning

`SAMPLING_STATS_VERSION` equals `package.json` `version`. Changing a table value or the wording of a result is a version change; see
CHANGELOG.md.
