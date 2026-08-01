# Changelog

## Unreleased

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
