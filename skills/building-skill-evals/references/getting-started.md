# Getting started

`@aefree/pi-package-development` helps a package create and review behavioral evals for one Pi skill. The generated suite stays in the target package and remains understandable without this package installed.

## Design a small first suite

1. Inspect the target `SKILL.md` and collect concrete failures or corrections.
2. Define must-pass outcome, process, style, trigger, and efficiency criteria.
3. Choose at least one relevant prompt and one adjacent or unrelated negative control.
4. Preview `skill_eval_bootstrap`; inspect its paths and safety settings before applying.
5. Replace the placeholder fixture and checks with package-specific evidence.
6. Run `skill_eval_review` before invoking a model.
7. Pilot one trial, fix harness or criterion defects, and only then expand to 3–5 trials and a baseline comparison.

## Prompt kinds and runner conditions

Prompt kinds describe user intent:

- `explicit`: names or directly requests the skill
- `implicit`: describes the core intent without naming it
- `contextual`: embeds the intent in realistic surrounding details
- `negative-control`: should not select the skill

Runner conditions answer a different question:

- `available`: can the agent select and use the skill?
- `baseline`: what happens when the skill is unavailable?
- `forced`: can the skill body solve the case once selection is removed from the test?

An explicit prompt under `available` is therefore different from a `forced` run. A mature suite normally contains several prompt kinds and compares conditions without collapsing them into one score.

## Evidence strategy

Start with deterministic checks over artifacts, file changes, structured events, compilation, or focused tests. Add runtime smoke checks only where they reduce a concrete risk. For qualitative style or convention requirements, use a separate read-only judge with a small typed rubric and keep its score separate from deterministic results.

Generated runs are provider-backed, nondeterministic, and potentially costly. They remain opt-in and are not added to ordinary `npm test`.

See [Methodology and sources](methodology.md) for the rationale and adaptations behind this workflow.
