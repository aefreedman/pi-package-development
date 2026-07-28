# Public npm Release Readiness

Use this guide to prepare evidence and decisions for a public npm release. It defines safety gates and a decision framework; it does not impose package-shape preferences that the repository has not established.

## Established gates

A package is not ready for public npm publication until all of these are true:

- Work is performed from the package's manifest root.
- The package has explicit release intent; exploratory changes remain under `## Unreleased`.
- `private: true` has been removed only as part of an authorized release preparation.
- Every runtime dependency can resolve in a clean consumer installation.
- Build and applicable deterministic tests pass.
- Publishable source, documentation, skills, prompts, agents, references, tests, fixtures, screenshots, binary assets, configuration, and lockfiles have been reviewed for secrets and sensitive information.
- `npm pack --dry-run` has been run and every included path reviewed.
- The packed artifact contains all runtime resources and excludes unintended private or workspace-only material.
- The version and changelog describe the complete intended release rather than intermediate attempts.
- Actual publication has separate explicit authorization.

For a scoped package intended to be public, verify that first publication uses public access. Do not infer npm credentials, account permissions, 2FA handling, provenance, or CI configuration; report what the environment requires.

## Package-specific decisions

Derive these from package evidence rather than enforcing a universal rule:

- whether authored TypeScript, tests, fixtures, evals, or lockfiles ship;
- whether generated output is committed or produced during packaging;
- whether a dependency should be published independently or bundled;
- dependency publication order;
- npm dist-tag or prerelease use;
- provenance and release automation;
- package-specific post-publication checks.

Document each consequential decision with its evidence and consumer impact. Ask only when repository evidence and established requirements do not determine a safe answer.

## Dependency readiness

For every runtime import and loaded Pi resource:

1. Identify the declaring dependency.
2. Confirm that a clean consumer can obtain the required package and version.
3. If the dependency is unpublished, stop and present supported options rather than substituting a local path in release metadata.
4. Prefer independent publication when the dependency has its own public contract or is shared by multiple packages.
5. Bundle only when it is intentionally implementation-private and Pi's package resource-loading rules are satisfied.

Local sibling installs are useful validation aids but are not evidence that registry consumers can install the package.

## Artifact review

Inspect both metadata and bytes represented by the tarball inventory. Check at minimum:

- package name, version, description, license, repository, exports, engines, and `pi` declarations;
- extension entry points and required build output;
- skill, prompt, theme, reference, and asset paths;
- README installation and failure behavior;
- source maps and generated declarations for machine paths or unintended source disclosure;
- fixtures and eval data for private content;
- dependency and peer-dependency classifications.

A successful dry run proves that npm can construct a tarball, not that the tarball is safe or functional.

## Validation evidence

Prefer a clean-install or packed-artifact smoke test when practical. At minimum record:

- commands run and their working directory;
- build and test outcomes;
- dry-run tarball inventory review;
- unresolved warnings or vulnerabilities and whether they affect consumers;
- dependencies that must be released first;
- checks intentionally not run.

## Authorization boundary

Release preparation may inspect files, run non-publishing validation, and draft changes when requested. Do not change a version, convert `## Unreleased`, remove a publication guard, create a VCS release, push, or run `npm publish` unless the user's request authorizes that operation. When authorization is ambiguous, leave a readiness report and proposed edits instead of publishing.
