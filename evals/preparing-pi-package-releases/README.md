# `preparing-pi-package-releases` behavioral eval

This opt-in suite compares an **available** target skill with a distinct no-skill **baseline**. It has not been run against a provider.

## What it grades

`--skill` advertises the copied skill to Pi. It is not proof of recursive `SKILL.md` loading, agent activation, or package-local reference reads. Available positive cases grade observable agent compliance: an exact successful native `read` of the installed release-readiness guide plus the release safety boundary. Available negative controls pass only when no release-specific installed reference is read. Baseline results remain separate evidence rather than activation evidence.

An unavailable-reference qualification is accepted only for unavailable mode, an attempted `read` of the exact staged installed path, and a missing-file error (`ENOENT`, “no such file”, “cannot find file”, or “file not found”). Permission and other read failures are unexpected.

The noninteractive JSON runner cannot demonstrably invoke interactive `/skill:name`. There is intentionally no `forced` condition; inserting slash-command text into a prompt would not validate forced invocation.

## Isolation and evidence

Each trial creates separate temporary `consumer/` and `installed-package/` trees. Pi starts from `consumer/`; required references are copied only under `installed-package/`, and consumer-CWD fallback reads are rejected. Only native `read` is available. Context files, extensions, approval, unrelated skills, and stdin are disabled. No shell or mutation tool is enabled.

Mandatory results retain full tool arguments, failed-read error causes, and the complete final answer independent of bounded opt-in stderr or JSONL diagnostics. Missing mandatory evidence fails. A temporary fixture copy is not an OS sandbox.

## Run deliberately

```sh
node --experimental-strip-types evals/preparing-pi-package-releases/run-eval.ts --condition available --trials 1
```

Run provider trials only after fixture and criterion review. `latest-results.json` is transient and excluded from Git and npm packaging.
