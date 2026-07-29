# `auditing-pi-packages` behavioral eval

This package-owned, opt-in suite checks the audit skill and its adjacent `/package-status` prompt boundary. It is not part of `npm test` and has not been run against a provider.

## Covered behavior

- The audit skill natively reads all three required package-local references through `read`, without `read_package_reference`.
- A genuinely failed required local read must be qualified before a policy- or convention-complete claim.
- An explicitly named package path is acknowledged without reading the synthetic sibling package.
- The adjacent `/package-status` request is a negative trigger control for the audit skill and must not read the sibling package.

## Isolation and safety

Each trial copies a synthetic fixture, the target skill, and its package-local references into a fresh temporary directory, declines context files and project approval, disables all skills except the copied target skill, closes stdin, and permits only native `read`. Cases marked `local_reference_mode: "unavailable"` remove the copied required references while retaining `read`, so qualification is accepted only when an attempted local read actually fails. No extensions, shell, or mutation tools are enabled. The temporary copy is not an OS sandbox; run only trusted fixtures locally and use OS isolation for unattended work.

Raw answers and event traces remain opt-in runner flags and must not be committed.

## Run deliberately

```sh
node --experimental-strip-types evals/auditing-pi-packages/run-eval.ts --condition available --trials 1
```

Use one trial for a pilot and 3–5 per condition only after fixture and criterion review. Compare `available` with `baseline`; a baseline pass is evidence, not an eval failure. `latest-results.json` is transient and excluded locally from Git and npm packaging.
