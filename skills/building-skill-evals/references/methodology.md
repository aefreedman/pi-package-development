# Skill eval methodology

This workflow adapts outcome-first practices from Philipp Schmid's [Practical Guide to Evaluating and Testing Agent Skills](https://www.philschmid.de/testing-skills) and OpenAI's [Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills) to package-owned Pi skills. The sources inform the methodology; Pi's runner, event lifecycle, permission model, and package-local ownership remain independent implementations.

## Skill type

- **Capability skill:** supplies knowledge or execution patterns the base model may eventually learn. Baseline comparison can reveal retirement readiness.
- **Preference skill:** encodes a team's chosen workflow. It remains valuable only while evals show fidelity to that workflow.
- **Mixed skill:** supplies both specialized capability and project/package preferences. Grade those dimensions separately when practical.

## Success dimensions

Define these before writing cases:

1. **Outcome:** Is the produced result usable and correct? Prefer compilation, parsed output, file state, API response, or another observable artifact.
2. **Process and instruction fidelity:** Did the run preserve required steps, constraints, safety policies, and current APIs without overfitting to one equivalent tool sequence?
3. **Style and conventions:** Does the artifact follow package-specific structure, naming, prose, or implementation conventions?
4. **Triggering:** Does an available skill load for relevant user intent and stay unloaded for unrelated work?
5. **Efficiency:** Did the run avoid unnecessary retries, tool thrashing, excessive tokens, latency, and cost?

## Conditions

- **Baseline:** the skill is unavailable. This measures incremental value and whether the skill may be obsolete.
- **Available:** only skill metadata is initially present; the agent decides whether to load the body. This measures trigger quality plus skill quality.
- **Forced:** invoke the skill explicitly. This isolates instruction-body quality from automatic selection. Forced runs are normally meaningful only for relevant prompts.

Do not collapse these into one score. A skill can have strong instructions but weak triggering, or trigger correctly while providing no improvement over baseline.
