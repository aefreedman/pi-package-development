# Pi Skill Frontmatter

Use Pi's current skill documentation as the authority. Package-local validation may impose additional conventions.

## Required fields

- `name`: 1–64 characters, lowercase letters/numbers/hyphens, with no leading, trailing, or consecutive hyphen.
- `description`: 1–1024 characters describing both capability and when Pi should load it. Skills without a description are not loaded.

Pi permits a skill name to differ from its parent directory, although matching remains a useful portability convention for Agent Skills consumers.

## Optional Pi fields

- `license`
- `compatibility`
- `metadata`
- `allowed-tools`: experimental, space-delimited convenience metadata; not a safety boundary.
- `disable-model-invocation`: hides the skill from automatic model routing when `true`; users may still invoke its command.

Pi ignores unknown frontmatter fields. Do not remove package-specific fields merely because they are unfamiliar: first verify whether package tooling or another supported harness consumes them.

## Description guidance

The description is always-visible routing metadata. Keep it concise but specific enough to distinguish the skill from neighboring skills. Put procedural instructions in the body, not the description.

## Validation

- Check the current Pi documentation rather than relying on a copied frontmatter registry.
- Preserve intentional cross-harness compatibility unless the user asks for Pi-only normalization.
- Treat Pi warnings as evidence to inspect, not automatic authorization to rewrite fields.
