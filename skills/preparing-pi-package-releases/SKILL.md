---
name: preparing-pi-package-releases
description: Assess and prepare Pi packages for public npm release using evidence-driven build, dependency, secret, tarball, and consumer-readiness checks. Use for release readiness or npm publication preparation; publication itself requires explicit authorization.
---

# Preparing Pi Package Releases

Prepare a package for release without inventing organization policy or silently publishing it.

## Required Reference

Before claiming release readiness, use `read_package_reference` to load this reference from `@aefree/pi-package-development`:

- `references/package-development/release-readiness.md`

If the tool or reference is unavailable, report that limitation and do not claim a policy-complete release assessment.

## Workflow

1. Resolve the exact package root and confirm it contains `package.json`.
2. Load the required release-readiness reference.
3. Inspect manifest metadata, Pi resources, exports, dependencies, README, changelog, and publish allowlists.
4. Trace runtime dependencies and identify unpublished or locally satisfied prerequisites.
5. Review every potentially packed content class for secrets and sensitive information.
6. Run focused package validation from the manifest root.
7. Run `npm pack --dry-run` and review the complete inventory.
8. When practical, validate a clean consumer or packed-artifact installation.
9. Report blockers, package-specific decisions, evidence, and the exact next authorized step.

## Decision Discipline

- Apply established safety gates; derive package-shape choices from repository evidence.
- Do not require provenance, lockfile inclusion, source publication, test publication, bundling, or a tag strategy without supporting evidence.
- Local sibling dependencies do not establish npm consumer readiness.
- Distinguish package defects from environment, account, and registry prerequisites.

## Mutation Boundary

Do not change versions, convert `## Unreleased`, remove `private: true`, commit, push, create releases, or publish unless the user's request explicitly authorizes the specific operation. Release preparation and `npm publish` are separate operations.

## Output

Report, in order:

1. release blockers;
2. required corrections;
3. package-specific decisions and recommendations;
4. validation evidence;
5. unverified checks;
6. proposed release order and next step.
