# Pi Package Development Conventions

## Authority labels

Audit every statement according to its authority:

- **Pi requirement:** behavior required by Pi discovery or loading.
- **Package contract:** behavior required by this package's public API or runtime contract.
- **Workspace convention:** a rule adopted by the `pi-packages` workspace.
- **Recommendation:** a preferred default with potentially valid exceptions.

Do not present a recommendation as a requirement. Record justified exceptions rather than forcing uniformity.

## Repository boundary

**Workspace convention:** each publishable child package is an independent repository. The parent `pi-packages` repository coordinates them and must not commit child folders as content or gitlinks.

**Workspace convention:** package validation runs from the child package's manifest root. Releases, pushes, publication, version changes, and non-fast-forward integration require separate authorization.

## Pi resource declaration

**Pi requirement:** packages may expose extensions, skills, prompts, and themes through conventional directories or the `pi` manifest. Prefer an explicit `pi` manifest when publish scope or resource inclusion should be reviewable.

**Pi requirement:** skill discovery is recursive for directories containing `SKILL.md`; prompt discovery from a conventional `prompts/` directory is non-recursive unless paths are explicitly declared.

**Recommendation:** keep each skill's `SKILL.md` a concise workflow spine. Put substantial package-local detail in skill-relative references and load it only when needed.

**Recommendation:** when a skill consumes a reference owned by its own package, use native progressive disclosure with a path resolved relative to that skill's `SKILL.md`. Do not route same-package skill references through `read_package_reference`.

**Recommendation:** use package-qualified public references through `read_package_reference` only for guidance consumed across independently installed packages. Do not rely on unknown installation paths or duplicate canonical policy into each consumer.

## Ownership and references

**Recommendation:** the package that defines a method or policy owns its canonical reference. Infrastructure packages should own transport and addressed-read contracts, not unrelated domain policy.

**Package contract:** packages publishing references through `@aefree/pi-package-references` explicitly mount public prefixes, unregister lifecycle registrations, and treat unavailable mandatory references as a visible failure.

**Recommendation:** prompts should be thin entry points. Skills own reusable operational workflows; references own stable domain knowledge; extensions own runtime behavior and tools. Read a public package reference only when a prompt, skill, or agent has a known need for that exact supporting document.

## Dependencies and build output

**Pi requirement:** runtime imports belong in `dependencies`. Pi framework packages imported by extensions belong in `peerDependencies` with `*` ranges and should not be bundled.

**Pi requirement:** separately installed Pi packages do not share module roots. A package that loads another package's Pi resources must include it in `dependencies` and `bundledDependencies`, then declare the bundled resource paths explicitly.

**Recommendation:** TypeScript extensions may expose a source shim under `extensions/` that imports built code from `dist/`. Ensure a fresh package install can build or includes the required build output.

**Recommendation:** generated output must be reproducible and should not be the only copy of authored policy, tests, prompts, skills, or references.

## Documentation

**Workspace convention:** workspace plans, private research, migration notes, and machine-specific material belong under the parent `docs/` tree, not in a child package.

**Workspace convention:** child `docs/`, README content, references, examples, and assets must be intentionally public and safe to publish.

**Recommendation:** README files explain package purpose, installation, activated resources, dependencies, and important failure behavior. Keep detailed agent guidance in skills or references rather than duplicating it in README prose.

## Tests and evals

**Recommendation:** deterministic contract and lifecycle behavior belongs in automated tests. Agent behavior belongs in package-owned behavioral evals with positive and negative cases.

**Recommendation:** fixtures contain synthetic, publish-safe data. Tests must not depend on arbitrary sibling repositories, private home-directory state, or network access unless that dependency is explicit and controlled.

## Publishing and secrets

**Workspace convention:** before public release, inspect source, docs, skills, prompts, agents, tests, fixtures, screenshots, binary assets, configuration, and lockfiles for secrets or sensitive information.

**Workspace convention:** run `npm pack --dry-run` from the package root and review every included file.

**Workspace convention:** unreleased changes stay under a top-level `## Unreleased` changelog section. Change versions only for an explicitly requested release or a task requiring one final release version.
