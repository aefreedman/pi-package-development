# `auditing-pi-packages` behavioral eval

This opt-in suite compares an **available** target skill with a distinct no-skill **baseline**. It has not been run against a provider.

## What it grades

`--skill` makes the copied skill available to Pi; it does not prove that Pi recursively loaded `SKILL.md`, that the model activated it, or that it read any referenced file. Available positive cases therefore grade observable agent compliance: exact successful native `read` calls for all required installed-package references and the resulting workflow/scope behavior. Available negative controls pass only when no audit-specific installed reference is read. Baseline is reported separately, not treated as evidence of activation.

An unavailable-reference qualification accepts only an attempted `read` of an exact staged installed path in unavailable mode with a missing-file error (`ENOENT`, “no such file”, “cannot find file”, or “file not found”). Separately, ordinary read-only `ENOENT` probes for optional files are expected only when the requested path is safely contained in the case-declared consumer target package. Permission failures, malformed/traversing paths, consumer-CWD reference fallback, sibling/out-of-scope paths, non-read failures, and unrelated missing paths remain unexpected.

The noninteractive JSON runner cannot demonstrably execute an interactive `/skill:name` command. It deliberately has no `forced` condition and does not fake one by placing slash-command text in the prompt.

## Isolation and evidence

Every trial uses a fresh temporary workspace with separate `consumer/` and `installed-package/` trees. Pi starts in `consumer/`; each case declares its one scoped consumer target package, while required references exist only beneath the copied installed package. Native `read` is the only tool; context files, extensions, approval, unrelated skills, and stdin are disabled. Consumer-CWD reference fallbacks are rejected.

Mandatory result evidence always retains complete tool arguments, failed-read error causes, and the complete final answer. Missing mandatory evidence fails the trial. Optional stderr and JSONL diagnostics are bounded and opt-in (`--include-raw`, `--include-events`). The temporary copy is not an OS sandbox.

## Run deliberately

```sh
node --experimental-strip-types evals/auditing-pi-packages/run-eval.ts --condition available --trials 1
```

Use provider trials only after reviewing criteria and fixtures. `latest-results.json` is transient and excluded from Git and npm packaging.
