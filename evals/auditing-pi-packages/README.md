# `auditing-pi-packages` behavioral eval

This opt-in suite compares an **available** target skill with a distinct no-skill **baseline**. It has not been run against a provider.

## What it grades

`--skill` makes the copied skill available to Pi; it does not prove that Pi recursively loaded `SKILL.md`, that the model activated it, or that it read any referenced file. Available positive cases therefore grade observable agent compliance: exact successful native `read` calls for all required installed-package references and the resulting workflow/scope behavior. Available negative controls pass only when no audit-specific installed reference is read. Baseline is reported separately, not treated as evidence of activation.

A missing-reference case qualifies only an attempted `read` of the exact staged installed path in unavailable mode whose error is a missing-file error (`ENOENT`, “no such file”, “cannot find file”, or “file not found”). Other errors remain unexpected.

The noninteractive JSON runner cannot demonstrably execute an interactive `/skill:name` command. It deliberately has no `forced` condition and does not fake one by placing slash-command text in the prompt.

## Isolation and evidence

Every trial uses a fresh temporary workspace with separate `consumer/` and `installed-package/` trees. Pi starts in `consumer/`; required references exist only beneath the copied installed package. Native `read` is the only tool; context files, extensions, approval, unrelated skills, and stdin are disabled. Consumer-CWD reference fallbacks are rejected.

Mandatory result evidence always retains complete tool arguments, failed-read error causes, and the complete final answer. Missing mandatory evidence fails the trial. Optional stderr and JSONL diagnostics are bounded and opt-in (`--include-raw`, `--include-events`). The temporary copy is not an OS sandbox.

## Run deliberately

```sh
node --experimental-strip-types evals/auditing-pi-packages/run-eval.ts --condition available --trials 1
```

Use provider trials only after reviewing criteria and fixtures. `latest-results.json` is transient and excluded from Git and npm packaging.
