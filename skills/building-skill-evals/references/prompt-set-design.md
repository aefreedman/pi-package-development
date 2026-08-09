# Prompt-set design

## Start from real problems

Use concrete examples from:

- user corrections
- known bad outputs
- issue or tracker reports
- reviewed Pi sessions
- deprecated APIs or workflows the skill must prevent
- edge cases found while manually invoking the skill

Redact private content and reduce each example to the smallest fixture that retains the failure.

## Case categories

A useful first set usually contains 10–20 focused prompts across:

- core relevant requests
- ambiguous natural-language requests that should still trigger
- known failure regressions
- guardrails and preservation requirements
- alternate supported languages, platforms, or harnesses
- audit-only or no-mutation requests
- unrelated negative controls
- adjacent tasks that should select another skill

Each case declares its own criteria. Do not require every check for every prompt.

## Invocation categories

Classify relevant prompts independently from runner conditions:

- **Explicit:** the user names or directly requests the skill. This tests direct discoverability in the `available` condition; it is not the same as the runner's `forced` condition, which injects the skill command.
- **Implicit:** the user describes the core intent in ordinary language without naming the skill.
- **Contextual:** realistic surrounding details or adjacent domain language obscure the same underlying intent.
- **Negative control:** unrelated or adjacent intent that should not load the skill.

Cross these prompt kinds with conditions deliberately. For example, an explicit prompt under `available` tests direct selection, while a contextual prompt under `forced` isolates whether the skill body can solve a noisy case once loaded.

## Negative controls

Include both clearly unrelated and adjacent-but-distinct work. For example, a skill that migrates Unity agent guidance should trigger for “modernize AGENTS.md,” but not for “diagnose this failing Unity test.”

## Prompt quality

- Write prompts in user language rather than only the skill's terminology.
- Avoid embedding the desired implementation path unless that path is itself the requirement.
- Supply enough fixture evidence to make the requested outcome possible.
- Keep one main behavioral hypothesis per case.
- When a case causes tool thrashing, first check whether the fixture is incomplete before loosening an efficiency budget.
