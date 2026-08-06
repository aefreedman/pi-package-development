# pi-package-development

`@aefree/pi-package-development` packages the methods and architecture used to design, maintain, and audit Pi packages.

## Included resources

- Package-development references progressively disclosed through skill-relative paths by the included skills
- Canonical package-development references registered through `read_package_reference` for independently installed external consumers
- The `auditing-pi-packages` skill
- The `preparing-pi-package-releases` skill
- The `streamlining-skills` skill for reducing Pi skill context cost through explicit progressive disclosure
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

The audit, release-preparation, and streamlining skills load their package-owned references through paths relative to their own `SKILL.md` files; they do not require `read_package_reference` for those files.

### External reference consumers

An independently installed package that consumes these public references through `read_package_reference` must also activate the reference reader:

```sh
pi install npm:@aefree/pi-package-references
pi install npm:@aefree/pi-package-development
```

The package continues to register its public `references/package-development/` mount for those external consumers. For local source development, install dependencies and build before loading the package directory with `pi install <path>`.

The audit and release-preparation skills fail explicitly when a required package-local reference cannot be read; they do not silently substitute workspace-relative documentation.
