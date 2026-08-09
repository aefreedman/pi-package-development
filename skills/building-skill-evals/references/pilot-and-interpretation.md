# Pilots and interpretation

## Manual pilot

Run a few explicit skill invocations before scaling the suite. Watch for hidden dependencies, missing fixture evidence, passive guidance the model fails to follow, and unexpected scope expansion. Convert confirmed failures into cases or deterministic tests.

## Suggested progression

1. One available-condition trial for 2–4 representative cases.
2. Fix harness, fixture, and criterion defects.
3. One available trial across the prompt set.
4. Compare available and baseline on representative cases.
5. Run 3–5 trials per condition once the suite is stable.
6. Add supported models or harnesses deliberately rather than multiplying the first pilot's cost.

## Interpret distributions

Report per-case pass rates and failure signatures. Do not claim reliability from one pass. Separate:

- trigger failures
- outcome failures
- instruction-fidelity failures
- efficiency regressions
- infrastructure failures

A baseline that passes is useful evidence, not an eval failure. Compare the quality and cost distributions. If the baseline consistently matches the available skill across the full rubric, review whether the skill can be simplified or retired.

## Regression graduation

When cases become stable, preserve them as regressions. Every confirmed user-reported failure should normally add or strengthen a case. Keep behavioral evals opt-in unless a dedicated, budgeted CI job is explicitly designed for them.

## Result hygiene

Store concise summaries when useful, but ignore transient `latest-results.json` and raw event streams. Before retaining artifacts, scan for prompts, file content, secrets, machine paths, provider identifiers, and private project details.
