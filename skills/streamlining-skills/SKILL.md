---
name: streamlining-skills
description: Streamline Pi skills by keeping SKILL.md as a concise routing spine, moving task-specific detail into on-demand references, and validating Pi-compatible frontmatter and paths. Use when a Pi skill has become large, repetitive, or expensive to load.
---

# Streamlining Pi Skills

## Purpose

Reduce the context cost of Pi skills without weakening their workflows or safety constraints.

## Pi loading model

- Pi always discovers skill `name` and `description` as routing metadata.
- Pi loads the selected skill's complete `SKILL.md`; linked reference files are not loaded automatically.
- Keep universal instructions in `SKILL.md`. Put task-specific details in reference files and tell the agent exactly when to read each one.
- Use ordinary relative Markdown paths resolved from the skill directory. Do not use harness-specific `@file` syntax or imply recursive automatic loading.
- Load only references relevant to the active task. Once loaded, their applicable instructions are mandatory.

## Workflow

1. Identify the exact skill or explicitly authorized skill set. Do not scan unrelated sibling repositories or every installed skill by default.
2. Measure the current spine and map each section to its trigger or workflow.
3. Keep purpose, routing, minimal workflow, and universal safety constraints in `SKILL.md`.
4. Move substantial task-specific examples, edge cases, API details, checklists, and recovery guidance into short topical files under `references/`.
5. Add a routing table that states when each reference must be read. Avoid circular or load-everything chains.
6. Validate frontmatter and paths against Pi's current skill documentation and the package's local conventions.
7. Update tests that intentionally assert guidance location so they inspect the routed reference corpus rather than forcing all guidance back into `SKILL.md`.
8. Compare the refactored corpus with the source and run package-local validation from the directory containing `package.json`.

## Reference files (load on demand)

- For the refactoring checklist, read [references/checklist.md](references/checklist.md).
- For Pi frontmatter and discovery rules, read [references/frontmatter.md](references/frontmatter.md).
- For deciding between another skill and a reference file, read [references/ref-splitting.md](references/ref-splitting.md).
- For optional section-organization heuristics, read [references/section-normalization.md](references/section-normalization.md).
