# Changelog

## Unreleased

### Changed

- Replace diagnostic session ranking, inferred recovery/concurrency/corrections and source-marker “fixed” claims with unreviewed typed-signature leads. Preserve selection/time/native-call accounting; intentionally retire diagnostic knobs and outputs in evidence schema 2, with resume argument compatibility documented.

### Added

- Add `pi_query_session` for one-query lead resolution, exact report-local event/call/ancestry provenance, counterexample lookup and selector-bound pagination. Bound complete result serialization to 8 KiB, omit untrusted source text and identifiers, and retain only a bounded private memory index with 15-minute expiry, explicit release, shutdown cleanup and page-source staleness checks.
- Add deterministic registration-level retrieval, privacy, paging, lifetime, provenance and negative-control regression tests plus synthetic retrieval work/byte measurements; no model/provider efficiency claim.

### Fixed

- Disclose unsupported or malformed role-specific content blocks without interpreting them as executions, and prevent supplied result IDs from binding internal missing-ID placeholders. Preserve valid sibling blocks, native states and explicit absent-ID legacy joins.
- Account for native session header identities, exact copied lineage history, unsupported containers, inclusive UTC event windows, and partial coverage with bounded cancellable JSONL scans.
- Integrate corpus accounting into session analysis, strictly join tool IDs within branch ancestry, support string/image user content and assistant terminal errors/aborts, and separate native/package outcomes from unverified text leads. Unknown formats, outcomes and incomplete joins remain explicit; message timing does not prove execution latency or timeout effects.

## 0.4.0 - 2026-08-09

### Added

- Merge the package-owned behavioral-eval workflow, starter assets, `building-skill-evals` skill, and `skill_eval_bootstrap`/`skill_eval_review` tools from `pi-skill-evals`.

## 0.3.0 - 2026-08-06

### Added

- Moved `pi_analyze_session`, `/analyze-session`, and their synthetic regression coverage from `pi-extras` into the package-development package.

## 0.2.0 - 2026-08-05

- Add the moved `streamlining-skills` skill with Pi-native discovery, frontmatter, and explicit on-demand reference guidance.
- Add the expected `.github/workflows/release.yml` trusted-publishing workflow with resumable npm/gitHead reconciliation and provenance.
- Require release preparation to separate public-repository content from npm consumer artifacts, justify each packed content class, detect local-link lockfiles and unpublished migration narratives, and avoid transient bootstrap documentation while preserving intentionally exported fixtures.
- Retire generic automatic guidance-assembly recommendations while retaining explicit package-reference guidance.
- Exclude development-only tests and behavioral evals from published npm artifacts.
- Add trusted-publishing, first-publication bootstrap, release-identity reconciliation, and partial-success recovery guidance to release preparation, with behavioral eval coverage.
- Updated the Pi development baseline to 0.83.0.

- Use skill-relative progressive disclosure for package-owned audit and release references while retaining public reference registration for independently installed consumers.
- Clarify that prompt ownership is not a smell when explicit invocation is the intentional activation boundary.
- Add `/prepare-package-release` as an explicit entry point for evidence-driven release preparation.
- Add `/package-status` for read-only package repository and publication-state checks.
- Add deterministic reference-registration lifecycle coverage.
- Add package-owned behavioral eval suites for package auditing and release preparation.
- Replace sibling-linked dependency lock entries with portable npm registry resolutions.

## 0.1.0 - 2026-07-28

- Add package-development reference publishing, package auditing guidance, and an `/audit-package` prompt.
- Add evidence-driven public npm release-readiness guidance and a release-preparation skill.
- Build the extension during package preparation and declare public npm access for eventual release.
