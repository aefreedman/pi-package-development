# Streamlining Checklist

## Audit

- Confirm the exact skill scope authorized by the user.
- Record line/word size and section headings before editing.
- Identify universal constraints that must remain in `SKILL.md`.
- Identify task-specific examples, edge cases, API details, recovery procedures, and duplicated material.
- Inspect package tests that assert guidance text or file locations.

## Refactor

- Keep `SKILL.md` as a concise routing spine, not an arbitrary line-count target.
- Move substantial task-specific guidance to short, named files under `references/`.
- Use `assets/` for files intended as output inputs/templates rather than instructions the agent must read.
- Use `scripts/` for deterministic helper programs.
- Add explicit “when to read” routing from `SKILL.md`.
- Preserve safety constraints and avoid circular or unconditional reference chains.

## Verify

- Compare the complete spine-plus-reference corpus against the source for lost requirements.
- Confirm every linked path resolves relative to the skill directory.
- Validate required Pi frontmatter and any package-local conventions.
- Ensure tests inspect the appropriate reference corpus instead of requiring all text in `SKILL.md`.
- Confirm unrelated skills and repositories were not modified.
- Before running npm commands, confirm the working directory contains the target package's `package.json`.
