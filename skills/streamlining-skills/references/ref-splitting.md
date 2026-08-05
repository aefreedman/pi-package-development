# Skill versus Reference Splitting

## Keep in SKILL.md

- Purpose and trigger boundaries
- Minimal workflow and routing
- Universal safety, authorization, and trust constraints
- Instructions that apply to nearly every invocation
- Explicit links describing when each reference must be read

## Move to references

- Workflow-specific API or tool details
- Long examples, edge cases, recovery procedures, tables, and checklists
- Detailed rules used by only one operation family
- Repeated guidance that can have one clear owner

References are progressive disclosure only when `SKILL.md` does not instruct the agent to load all of them. Pi does not automatically load linked files.

## Create a separate skill when

Prefer another skill only when the capability has a distinct user trigger, a substantial independent workflow, a meaningfully different tool set, and little need for the original skill's body. Separate skills add always-visible routing descriptions and can create trigger ambiguity, so do not split solely because a file is long.

## Use assets or scripts when

- Put templates or files consumed as workflow inputs/outputs under `assets/`.
- Put deterministic executable helpers under `scripts/`.
- Do not hide behavioral instructions in assets or scripts that the routing spine never identifies.

## Splitting rules

- Use short topical filenames and ordinary relative Markdown links.
- Avoid circular references and nested load-everything chains.
- Keep each rule in one authoritative location where practical.
- Update tests and documentation when guidance moves.
