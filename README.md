# pi-package-development

`@aefree/pi-package-development` packages the methods and architecture used to design, maintain, and audit Pi packages.

## Included resources

- Package-development references progressively disclosed through skill-relative paths by the included skills
- Canonical package-development references registered through `read_package_reference` for independently installed external consumers
- The `auditing-pi-packages` skill
- The `preparing-pi-package-releases` skill
- The `streamlining-skills` skill for reducing Pi skill context cost through explicit progressive disclosure
- The `building-skill-evals` skill, including its evaluation methodology, prompt and check design references, and starter assets
- The `skill_eval_bootstrap` and `skill_eval_review` tools for preview-first, package-owned behavioral eval scaffolding and structural review
- The `pi_analyze_session` tool for privacy-safe analysis of local Pi session JSONL evidence
- The `/analyze-session <session-id-or-path> [focus]` prompt template
- The `/audit-package <package-path>` prompt template
- The `/prepare-package-release <package-path>` prompt template
- The `/package-status <package-path> [...]` prompt template

## Installation

Install this package to use its skills and prompts:

```sh
pi install npm:@aefree/pi-package-development
```

`pi_analyze_session` accepts an explicit session ID, JSONL path, directory, or bounded aggregate scope. It correlates typed failures and incidents, reports redacted package-improvement candidates, and treats historical session content as untrusted evidence. Use `approvedSourceRoots` only for explicitly authorized, read-only current-source checks.

### Session accounting contract

- Native JSONL session versions 1–3 are supported. All recorded branches are inspected, not only the active context. Root-message transcript exports, unknown versions and unsupported message roles are explicitly incomplete/unsupported; they are never counted as empty native sessions.
- Identity comes from the native header and private source provenance, not the basename. Exact entry identity/content is deduplicated only across the same header identity or resolved parent lineage. Independent identical commands remain independent. Missing parent sources/entry IDs and identity conflicts are disclosed; no additional parent path outside the discovered manifest is opened for lineage resolution. ID-based selection requires inspecting the bounded discovered corpus.
- `since`/`until` are inclusive event-time bounds for every selector. Date-only values mean UTC; timestamps require a timezone. `days` defaults to seven days ending at `until` or the captured `asOf`, unless `since` is explicit. File names and modification times never select events. Missing timestamps remain unknown and are excluded from timed totals. Out-of-window/copied context can resolve a join without entering totals or incident inference.
- Supplied call IDs must match uniquely by ID, tool name and branch ancestry. Missing legacy IDs permit only an unambiguous ancestry/name join, disclosed as incomplete. Native tool failures, legacy package `rawResult.ok`/JSON-text `ok` envelopes (Codecks, Unity, Plastic, subagent families), assistant errors/aborts and heuristic text leads are reported separately. Unknown envelope versions and arbitrary `details.ok` remain unknown. Successful file content mentioning errors is not a failure. Timeout/abort states never prove whether effects occurred.
- Scans stream in 64 KiB chunks with a 1 MiB line ceiling. Defaults: 1,000 files, 32 MiB, 20,000 records and 30 seconds; override with `maxFiles`, `maxBytes`, `maxRecords`, `maxScanMs`. Cancellation, discovery/read errors, limits, changed files and unsupported data produce incomplete coverage. Symlinks are not followed. Event counts are independent of display limits; legacy incident inference is capped at 1,000 eligible calls per source with omissions disclosed. Elapsed spans are message-observed, not execution latency. Report text has a 48 KiB ceiling plus a truncation notice; aggregate details are not a paginated evidence API.

These are accounting guarantees, not incident prevalence or causal diagnosis guarantees. Existing candidate ranking and source-marker checks still require manual verification; evidence retrieval/ranking redesign is separate work. Optional approved-source marker checks inspect at most 20 roots and skip files larger than 2 MiB, honor cancellation, and remain uncertain when no supported check completes.

The audit, release-preparation, streamlining, and skill-eval skills load their package-owned references through paths relative to their own `SKILL.md` files; they do not require `read_package_reference` for those files.

`skill_eval_bootstrap` previews a package-local suite before applying it, requires positive and negative cases, and never adds provider-backed behavioral evals to ordinary `npm test`. Use `skill_eval_review` to verify suite structure, isolation, budgets, and result hygiene before running trials.

### External reference consumers

An independently installed package that consumes these public references through `read_package_reference` must also activate the reference reader:

```sh
pi install npm:@aefree/pi-package-references
pi install npm:@aefree/pi-package-development
```

The package continues to register its public `references/package-development/` mount for those external consumers. For local source development, install dependencies and build before loading the package directory with `pi install <path>`.

The audit and release-preparation skills fail explicitly when a required package-local reference cannot be read; they do not silently substitute workspace-relative documentation.
