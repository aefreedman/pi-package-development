# Public npm Release Readiness

Use this guide to prepare evidence and decisions for a public npm release. It defines safety gates and a decision framework; it does not impose package-shape preferences that the repository has not established.

## Established gates

A package is not ready for public npm publication until all of these are true:

- Work is performed from the package's manifest root.
- The package has explicit release intent; exploratory changes remain under `## Unreleased`.
- `private: true` has been removed only as part of an authorized release preparation.
- Every runtime dependency can resolve in a clean consumer installation.
- Build and applicable deterministic tests pass.
- The complete public repository tree and the npm tarball have been reviewed as separate exposure surfaces for secrets, sensitive information, and internal-only material.
- `npm pack --dry-run` has been run, its inventory grouped by content class and size, and every included class has a concrete consumer-facing purpose.
- The packed artifact contains all runtime resources and excludes repository-only development material unless its consumer value is explicit and tested.
- The version and changelog describe the complete intended release rather than intermediate attempts.
- An initial release describes only behavior actually available in that release; it does not present unpublished predecessors, internal migrations, or abandoned names as public history.
- The exact commit intended for publication—not merely an equivalent working tree—has passed final validation.
- Actual publication has separate explicit authorization.

For a scoped package intended to be public, verify that first publication uses public access. Do not infer npm credentials, account permissions, 2FA handling, provenance, or CI configuration; report what the environment requires.

## Public repository and consumer artifact

Treat the GitHub repository and npm tarball as separate products:

- The public repository may intentionally contain tests, behavioral evals, fixtures, CI workflows, contributor guidance, security policy, and maintainer tooling.
- The npm tarball should contain only runtime files, public APIs, loaded Pi resources, required legal/user documentation, and intentionally supported debugging material.
- Owning a file in the package repository does not establish that npm consumers need it.

For every packed top-level class, record its file count, size, consumer purpose, and keep/exclude decision. Default tests, evals, test fixtures, CI configuration, contributor/security documents, planning notes, migration notes, and one-time release instructions to repository-only. Keep one only when repository evidence establishes a concrete consumer contract, such as exported conformance fixtures or public examples loaded at runtime. Verify the exception rather than applying a blanket exclusion.

When a package ships authored source alongside generated output, identify why both are needed. Examples include a Pi TypeScript extension that imports authored source at runtime or source maps intentionally supported for debugging. Otherwise prefer the smallest coherent artifact rather than publishing duplicate implementation forms by inertia.

## Initial-release narrative hygiene

Before a package's first public release, review README, changelog, package description, public docs, examples, test names, and user-visible diagnostics as if no predecessor existed. Terms such as “removed,” “renamed,” “legacy,” “hard cut,” “migration,” “compatibility alias,” or a former package/tool name require evidence that users of an earlier public version actually encountered that state. Rewrite unpublished development history as a direct description of the initial public behavior.

Do not create or retain a release-operator document merely to preserve instructions for the current bootstrap. Keep maintainer documentation only when it is an enduring, repository-appropriate process that will remain useful for future releases. Put executable invariants in validated automation where practical.

For a repository required to begin with fresh public history, inspect the commits and refs intended for push, not only the working tree. Rebuild or rewrite locally only when authorized, then rerun final validation against the resulting exact commit.

## npm authentication and trusted publishing

Prefer npm trusted publishing through OpenID Connect (OIDC) for steady-state CI releases instead of long-lived write tokens. Treat authentication as a separate gate from package readiness: `npm pack --dry-run` and `npm publish --dry-run` do not prove that an OTP, token, or trusted-publisher configuration will authorize a real publish.

For GitHub Actions trusted publishing, verify rather than assume:

- the npm package trusts the exact GitHub owner, repository, and workflow filename; npm expects only the filename under `.github/workflows/`, including its `.yml` or `.yaml` extension;
- the workflow has `id-token: write`, runs on a GitHub-hosted runner, and uses npm 11.5.1 or later with Node.js 22.14.0 or later;
- `package.json` has a repository URL matching the authorized GitHub repository;
- the npm configuration allows the intended action (`npm publish`, staged publishing, or both) and names the same protected environment when one is configured;
- no `NODE_AUTH_TOKEN` or long-lived npm write token is supplied for the OIDC publish step unless a separately justified fallback path is intentionally active.

npm does not validate all trusted-publisher fields when they are saved; exact-identity errors can surface only during publication. Trusted publishing authorizes publishing, not installation of private dependencies. Reusable workflows add caller-identity and permission constraints; verify the calling workflow rather than assuming the workflow containing `npm publish` is the trusted identity. Current hosted-provider and runner support can change, so re-check npm's documentation when implementing or repairing automation.

Automatic npm provenance is expected only when the registry's current conditions are met, including trusted publishing from a public repository for a public package. Absence of provenance on a manual bootstrap release is not proof that later OIDC configuration is broken.

### First-publication bootstrap

A package-level trusted publisher may not be configurable until the package exists on npm. For a new package:

1. Perform the authorized first public publish manually with the account's required OTP or other approved bootstrap authentication.
2. Verify the registry version and `gitHead` against the reviewed source commit.
3. Configure the package's trusted publisher on npm.
4. Add and push the matching OIDC release workflow.
5. Use trusted publishing for subsequent versions.

Do not claim that configuring OIDC after the bootstrap retroactively adds provenance to the already-published version.

## Release identity and partial-success recovery

Treat npm version, source commit, Git tag, and GitHub release as one release identity. Public npm versions are effectively immutable, while network or provider failures can leave only some release artifacts created.

Before a first attempt and every retry, inspect:

- `npm view <name>@<version> version gitHead --json`;
- the local and remote release-tag targets, dereferencing annotated tags;
- the existing GitHub release and whether it is draft or public.

Skip an existing artifact only when it resolves to the expected version and commit. Stop on mismatches; never overwrite a published version, move a release tag, or silently attach a release to a different commit. Design automation so npm publication, annotated-tag creation, and GitHub-release creation are independently resumable. Run all validation before the first irreversible release action. A draft GitHub release does not make an npm publication private or staged.

## Package-specific decisions

Derive these from package evidence rather than enforcing a universal rule:

- whether authored TypeScript, tests, fixtures, evals, or lockfiles ship, with repository ownership explicitly treated as insufficient justification;
- whether generated output is committed or produced during packaging;
- whether a dependency should be published independently or bundled;
- dependency publication order;
- npm dist-tag or prerelease use;
- bootstrap/manual authentication versus steady-state OIDC trusted publishing;
- provenance and resumable release automation;
- package-specific post-publication checks.

Document each consequential decision with its evidence and consumer impact. Ask only when repository evidence and established requirements do not determine a safe answer.

## Dependency readiness

For every runtime import and loaded Pi resource:

1. Identify the declaring dependency.
2. Confirm that a clean consumer can obtain the required package and version.
3. If the dependency is unpublished, stop and present supported options rather than substituting a local path in release metadata.
4. Prefer independent publication when the dependency has its own public contract or is shared by multiple packages.
5. Bundle only when it is intentionally implementation-private and Pi's package resource-loading rules are satisfied.

Local sibling installs are useful validation aids but are not evidence that registry consumers can install the package. Inspect the lockfile for `file:` or `workspace:` dependencies, `link: true`, and relative `resolved` paths. Regenerate contaminated lockfiles against the intended registry and prove `npm ci` in an isolated checkout without sibling repositories.

## Artifact review

Inspect both metadata and bytes represented by the tarball inventory. Check at minimum:

- package name, version, description, license, repository, exports, engines, scripts, and `pi` declarations;
- extension entry points and required build output;
- skill, prompt, theme, reference, and asset paths;
- README installation and failure behavior;
- source maps and generated declarations for machine paths or unintended source disclosure;
- whether authored source and generated output are both intentionally required;
- whether tests, evals, fixtures, workflows, contributor docs, security docs, or maintainer notes are packed and why a consumer needs each class;
- whether packed scripts or manifest entries point to files intentionally omitted from the artifact;
- dependency and peer-dependency classifications.

Summarize the result as a table:

| Packed class | Files/bytes | Consumer purpose | Decision |
|---|---:|---|---|
| Example: `dist/` | measured | Public runtime and declarations | Keep |
| Example: `evals/` | measured | Repository-only behavioral regression suite | Exclude |

A successful dry run proves that npm can construct a tarball, not that the tarball is minimal, safe, or functional.

## Validation evidence

Prefer a clean-install or packed-artifact smoke test when practical. At minimum record:

- commands run and their working directory;
- build and test outcomes;
- grouped dry-run tarball inventory with consumer-purpose decisions;
- separate public-repository and packed-artifact content scans;
- initial-release narrative review when applicable;
- isolated-checkout lockfile installation evidence when practical;
- unresolved warnings or vulnerabilities and whether they affect consumers;
- dependencies that must be released first;
- checks intentionally not run;
- authentication model and whether it was actually exercised;
- registry `gitHead`, tag target, GitHub release state, and provenance status after publication.

## Recommended release order

1. Validate source, dependencies, tests, secrets, and packed contents.
2. Confirm the exact version and source commit, then reconcile any existing npm version, tag, or GitHub release.
3. Publish through the authorized authentication path.
4. Create or confirm an annotated tag resolving to the published `gitHead`.
5. Create or confirm the GitHub release from that tag.
6. Verify registry metadata, provenance when expected, and a neutral consumer installation.

Another order is acceptable when repository policy requires it, but only when partial-success recovery preserves the same identity and never moves an existing release artifact.

## Authorization boundary

Release preparation may inspect files, run non-publishing validation, and draft changes when requested. Do not change a version, convert `## Unreleased`, remove a publication guard, create a VCS release, push, or run `npm publish` unless the user's request authorizes that operation. When authorization is ambiguous, leave a readiness report and proposed edits instead of publishing.
