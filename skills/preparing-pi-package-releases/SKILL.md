---
name: preparing-pi-package-releases
description: Assess and prepare Pi packages for public npm release using evidence-driven build, dependency, secret, tarball, and consumer-readiness checks. Use for release readiness or npm publication preparation; publication itself requires explicit authorization.
---

# Preparing Pi Package Releases

Prepare a package for release without inventing organization policy or silently publishing it.

## Required Package-Local Reference

Before claiming release readiness, load the [release-readiness guide](../../references/package-development/release-readiness.md) on demand. Its path is relative to this `SKILL.md`.

Do not use `read_package_reference` for this package-owned file. Reserve it for references exposed by independently installed external packages. If the local reference cannot be read, report that limitation and do not claim a policy-complete release assessment.

## Workflow

1. Resolve the exact package root and confirm it contains `package.json`.
2. Load the required package-local release-readiness reference.
3. Inspect manifest metadata, Pi resources, exports, dependencies, README, changelog, scripts, and publish allowlists.
4. Review the public repository and npm tarball as separate surfaces: repository-owned development assets do not automatically belong in the consumer artifact.
5. For an initial public release, inspect public prose and reachable history for unpublished migration language, stale identities, private material, and one-time operator notes.
6. Trace runtime dependencies and reject lockfile entries satisfied only by local links, sibling paths, or workspace protocols unless the published consumer intentionally supports them.
7. Run focused package validation from the manifest root.
8. Run `npm pack --dry-run`, group the complete inventory by content class and size, and record a consumer-facing purpose for every included class.
9. Review both the public-repository tree and the packed bytes for secrets and sensitive information.
10. Determine the intended authentication path: first-publication bootstrap/manual authentication, steady-state OIDC trusted publishing, or an explicitly justified token fallback.
11. Reconcile release identity across the exact validated source commit, npm `gitHead`, local/remote tag, and GitHub release before proposing an attempt or retry.
12. When practical, validate `npm ci` from an isolated checkout and install the packed artifact in a neutral consumer.
13. Report blockers, package-specific decisions, evidence, and the exact next authorized step.

## Decision Discipline

- Apply established safety gates; derive package-shape choices from repository evidence.
- Package ownership is not consumer necessity. Default tests, evals, fixtures, CI files, contributor/security documents, planning notes, and one-time release instructions to repository-only unless a concrete runtime, public API, loaded-resource, legal, user-documentation, or supported debugging purpose justifies packing them.
- Do not require provenance, lockfile inclusion, source publication, test publication, bundling, or a tag strategy without supporting evidence.
- Local sibling dependencies do not establish npm consumer readiness.
- Distinguish package defects from environment, account, registry, and CI identity prerequisites.
- Never treat `npm publish --dry-run` as evidence that real-publish authentication, OTP, OIDC, or provenance works.
- For partial releases, skip an existing artifact only when its version and commit identity match; stop rather than moving tags or overwriting release identity.

## Mutation Boundary

Do not change versions, convert `## Unreleased`, remove `private: true`, commit, push, create releases, or publish unless the user's request explicitly authorizes the specific operation. Release preparation and `npm publish` are separate operations.

## Output

Report, in order:

1. release blockers;
2. required corrections;
3. package-specific decisions and recommendations;
4. a packed-content table with content class, size/count, consumer purpose, and keep/exclude decision;
5. validation evidence;
6. authentication model, trusted-publisher prerequisites, and whether real authentication was exercised;
7. npm version/`gitHead`, tag, GitHub release, and provenance reconciliation when applicable;
8. unverified checks;
9. proposed release order, recovery state, and next authorized step.
