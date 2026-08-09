# {{SKILL_NAME}} behavioral eval

This eval is owned by this package. It is intentionally separate from deterministic `npm test` because it invokes an agent, is nondeterministic, and may incur provider costs.

A temporary fixture copy prevents accidental mutation of the source fixture, but it is **not a security sandbox**. Pi tools and configured extensions retain host-user permissions. Use only trusted, redacted fixtures during monitored local runs; use an OS container/VM sandbox with minimal mounts and credentials for untrusted or unattended evals.

## Success criteria

Before expanding the prompt set, replace this section with measurable outcomes for:

1. **Triggering** — when the skill should and should not load.
2. **Outcome** — whether the result is usable or correct.
3. **Process and instruction fidelity** — required steps, constraints, and guardrails.
4. **Style and conventions** — package-specific structure, naming, or implementation preferences.
5. **Efficiency** — bounded time, tool calls, retries, tokens, and cost.

Grade outcomes rather than requiring one exact agent path.

## Files

- `eval.config.json` controls the skill, extensions, tools, conditions, and budgets.
- `cases.json` owns prompts and per-case criteria.
- `fixtures/` contains isolated synthetic or redacted workspaces.
- `checks.ts` owns package-specific deterministic checks.
- `run-eval.ts` runs fresh Pi JSON-mode trials and writes `latest-results.json`.

## Run

```bash
npm run eval:{{EVAL_NAME}}
npm run eval:{{EVAL_NAME}} -- --condition available --trials 3
npm run eval:{{EVAL_NAME}} -- --condition all --trials 3
```

Use one trial while developing cases. Use 3–5 trials before drawing conclusions. Compare the available condition with baseline to measure incremental value. Add `forced` to `conditions` only when you need to separate skill-content quality from automatic triggering.

## Before the first real run

- Replace the starter fixture with realistic, non-sensitive examples.
- Derive positive prompts from actual failures or user corrections.
- Include explicit, implicit, and realistic contextual prompt kinds as the suite grows; these are separate from baseline/available/forced runner conditions.
- Keep unrelated negative controls.
- Add package-specific checks in `checks.ts`.
- Verify tool and cost budgets. `read` is the default; enabling `bash`, `edit`, or `write` requires `allowHostMutation: true`.
- Keep `allowExtensionExecution: false` unless reviewed target-package extension code is required.
- Pass `--include-raw` only when diagnostic answer/stderr retention is necessary; default reports are summary-only.
- Pass `--include-events` only for bounded local JSONL diagnosis. Event traces may contain prompts, tool arguments, and file content; the generated `.gitignore` and eval-local `.npmignore` exclude `latest-results.json`, but still inspect version-control and `npm pack --dry-run` output before publishing.
- Review generated files and run the package's deterministic tests.
