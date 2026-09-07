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
- The `pi_analyze_session` and `pi_query_session` tools for bounded triage and retrieval of local Pi session JSONL evidence
- The `/analyze-session <session-id-or-path> [focus]` prompt template
- The `/audit-package <package-path>` prompt template
- The `/prepare-package-release <package-path>` prompt template
- The `/package-status <package-path> [...]` prompt template

## Installation

Install this package to use its skills and prompts:

```sh
pi install npm:@aefree/pi-package-development
```

`pi_analyze_session` accepts an explicit session ID, JSONL path, directory, or bounded aggregate scope. It reports typed observations and unreviewed signature clusters, including previously unnamed tools. Use `pi_query_session` to retrieve their evidence without reopening raw transcripts. This is an evidence workbench, not an automated diagnosis or package-ownership detector.

### Session accounting contract

- Native JSONL session versions 1–3 are supported. All recorded branches are inspected, not only the active context. Root-message transcript exports, unknown versions and unsupported message roles are explicitly incomplete/unsupported; they are never counted as empty native sessions.
- Identity comes from the native header and private source provenance, not the basename. Exact entry identity/content is deduplicated only across the same header identity or resolved parent lineage. Independent identical commands remain independent. Missing parent sources/entry IDs and identity conflicts are disclosed; no additional parent path outside the discovered manifest is opened for lineage resolution. ID-based selection requires inspecting the bounded discovered corpus.
- `since`/`until` are inclusive event-time bounds for every selector. Date-only values mean UTC; timestamps require a timezone. `days` defaults to seven days ending at `until` or the captured `asOf`, unless `since` is explicit. File names and modification times never select events. Missing timestamps remain unknown and are excluded from timed totals. Out-of-window/copied context can resolve a join without entering totals or incident inference.
- Supplied call IDs must match uniquely by ID, tool name and branch ancestry. Missing legacy IDs permit only an unambiguous ancestry/name join, disclosed as incomplete. Native tool failures, legacy package `rawResult.ok`/JSON-text `ok` envelopes (Codecks, Unity, Plastic, subagent families), assistant errors/aborts and heuristic text leads are reported separately. Unknown envelope versions and arbitrary `details.ok` remain unknown. Successful file content mentioning errors is not a failure. Timeout/abort states never prove whether effects occurred.
- Scans stream in 64 KiB chunks with a 1 MiB line ceiling. Defaults: 1,000 files, 32 MiB, 20,000 records and 30 seconds; override with `maxFiles`, `maxBytes`, `maxRecords`, `maxScanMs`. Cancellation, discovery/read errors, limits, changed files and unsupported data produce incomplete coverage. Symlinks are not followed. Event totals are independent of page/index limits. Index omissions are separately disclosed and make the report incomplete; query pages retain the scan's `evidenceCoverage.analysisIncomplete` flag. Elapsed spans are message-observed, not execution latency; no concurrency, recovery or mutation-causality inference is performed.

### Bounded evidence workflow (schema 2)

1. Scan with an explicit scope/window, for example `pi_analyze_session({session: "./synthetic-sessions", since: "2026-01-02", until: "2026-01-02", limitLeads: 3})`. Inspect `corpus`, `extraction`, `totals` and `evidenceCoverage`. `rows` contains unreviewed leads sorted by indexed occurrence count, not defect priority. Clusters group opaque tool identity and typed outcome (or explicitly unverified text signatures); they are not independent incidents. Session and proven lineage counts are separate.
2. Resolve any returned lead in one call: `pi_query_session({reportRef, leadRef})`. Its first packet matches the lead's representative `eventRef`. Query `{reportRef, eventRef}` for that exact packet, `{reportRef, toolRef}` for the same tool's positive/negative observations, or `{reportRef}` for all indexed events. `view: "leads"` pages the lead list. Repeat the same selector and `nextCursor` as `cursor`; cursors cannot be moved between selectors/reports. `limit` defaults to 3, maximum 10; the byte ceiling may yield fewer rows. `total` is independent of page size.
3. Inspect packet provenance: report-local source/session/lineage/entry/parent refs, physical JSONL line, original zero-based tool-call block position, timestamp and selected/copied-context flags. Strict joined calls are inline even when outside the event window; unmatched results explicitly lack a call. Up to two ancestry records supply role/time/locator context, never sibling-branch context. Field refs are stable within a report/tool so top-level argument presence/type changes can be compared; values, value-change inference, nested shapes and fields beyond eight are omitted. This is exact snapshot-relative provenance usable in follow-up queries, not a portable raw-source path. All refs must be used with their original report.
4. Agent judgment remains separate: establish actual ownership, user intent, counterexamples, historical/current applicability and authorized source/test evidence before proposing a fix. Ordinary user messages are not classified as human corrections. There is no source-marker inspection or automatic “fixed” state.

**Privacy and bounds:** both `content` and `details`, including metadata and wrapper, together serialize to at most 8 KiB per response. No source text, paths, native IDs, tool names, categories, argument keys/values or raw result details are emitted. Opaque tool refs deliberately do not reveal package ownership; this trades semantic detail for a strict omission boundary, not a claim that arbitrary text can be perfectly sanitized. Typed observations, shapes, timestamps and counts remain visible.

The private index is memory-only, local to this extension instance and requesting session scope. It retains safe packets plus private source paths/stat fingerprints, not transcript payloads. Limits: four reports, 5,000 event packets and a conservative 4 MiB serialized-index allowance per report (not a V8 heap/RSS bound). When indexing stops, all remaining observations are counted as omitted; only indexed evidence can become a lead. Lead recurrence counts describe the indexed subset, not an estimate of omitted evidence. Totals still cover the completed bounded extraction. A report expires 15 minutes after creation (not last use); an unreferenced cleanup timer removes it. Oldest reports are evicted at capacity. `pi_query_session({reportRef, release: true})`, session shutdown/reload/switch, or process exit cleans up; shutdown also invalidates scans in flight. No database, disk cache, daemon, provider or CLI execution is involved. Up to 32 retired opaque refs/reasons are retained without source data to distinguish recent expiry/staleness; older/after-restart refs are invalid.

Before a query returns, it stats only sources supporting that page (lead pages check representatives). Size, mtime, ctime, device and inode must match the scan fingerprint; missing/changed sources invalidate the report with `stale_source`. This is a metadata freshness guard, not content authentication against an adversary or an atomic filesystem snapshot. Unqueried sources are not revalidated, and newly created files are not discovered until a new scan. Invalid references/cursors, cross-session scope, cancellation and expiry throw bounded native tool errors without echoing input, rescanning or launching fallbacks. After `stale_source`, `expired_report` or `invalid_report`, explicitly rescan the authorized scope.

**Intentional API changes:** the existing tool name, explicit selection/window/budget inputs and aggregate `totals`/`corpus`/`extraction` fields remain. Diagnostic `incidents`, `candidates`, latency rankings, correction counts, raw session ID lists and source verification outputs are removed. New calls use `limitLeads` and the companion query's pagination. Resumed old calls have `focus`, `reportMode`, `filterMode`, `knownFixed`, `excludeThemes`, `approvedSourceRoots`, `limitSessions`, `limitFailures` and `limitCorrections` stripped by `prepareArguments`; none filters evidence or opens source repositories. These retired knobs are absent from the new public schema. No model-efficiency improvement or provider benchmark is claimed by deterministic retrieval tests.

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
