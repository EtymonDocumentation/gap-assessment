# @gap/risk

Risk assessment scoring for the quality risk management module (ICH Q9(R1)). Proof of concept: not validated, not for GMP use.

Every function is pure and returns a result with `working` (the arithmetic, in words, for the document) and `problems` (plain-language
reasons the result cannot be trusted). A missing or invalid input gives `scored: false` and a problem; nothing is defaulted or guessed.

## No defaults

There is no default method, scale, band or matrix. A method is a `RiskConfig` the person built (or copied from a load-out and edited).
A result names a band only if the person defined bands, and then reports the band label and note in the person's own words. The package
never says a risk is acceptable or not.

## Functions

| Function | What it does |
| --- | --- |
| `scoreItem(config, score)` | Scores one item for the config's method: RPN, grid cell, combined score or qualitative level |
| `configProblems(config)` | Problems in a method: band overlaps and gaps, unlabelled matrix cells, incomplete lookup, duplicate levels |
| `bandProblems(bands, range)` | Overlaps and gaps of a band list over the possible score range |
| `describeMethod(config)` | The method as data for the document: scales with level descriptions, formula, bands |
| `factorColumns(config)` | The score columns of a register (S/O/D, likelihood/severity, the factors) |
| `heatCounts(config, scores)` | Counts per matrix cell and the number not scored |

Depends only on `zod` and `@gap/process-model`. It never imports the engine, content, renderers or apps (a test scans the imports).
