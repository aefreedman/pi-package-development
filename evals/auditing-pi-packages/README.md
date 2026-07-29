# `auditing-pi-packages` behavioral eval

This package-owned, opt-in suite checks the audit skill and its adjacent `/package-status` prompt boundary. It is not part of `npm test` and has not been run against a provider.

## Covered behavior

- The audit skill natively reads all three required package-local references through `read`, without `read_package_reference`.
- A genuinely failed required local read must be qualified before a policy- or convention-complete claim.
- An explicitly named package path is acknowledged without reading the synthetic sibling package.
- The adjacent `/package-status` request is a negative trigger control for the audit skill and must not read the sibling package.

## Isolation and safety

Each trial uses separate `consumer/` and `installed-package/` directories in a fresh temporary directory. The synthetic fixture is staged only in `consumer/`; the target skill and its package-local references are staged only in `installed-package/`, preserving their package-relative layout. The runner starts Pi from `consumer/`, preflights that no required reference exists there, and accepts local-reference checks only when a `read` resolves to the staged installed-package file. Cases marked `local_reference_mode: "unavailable"` remove that staged required file while retaining `read`, so qualification is accepted only when an attempted installed-package read actually fails. Context files and project approval are declined, all skills except the copied target skill are disabled, stdin is closed, and only native `read` is permitted. No extensions, shell, or mutation tools are enabled. The temporary copy is not an OS sandbox; run only trusted fixtures locally and use OS isolation for unattended work.

Raw answers and event traces remain opt-in runner flags and must not be committed.

## Run deliberately

```sh
node --experimental-strip-types evals/auditing-pi-packages/run-eval.ts --condition available --trials 1
```

Use one trial for a pilot and 3–5 per condition only after fixture and criterion review. Compare `available` with `baseline`; a baseline pass is evidence, not an eval failure. `latest-results.json` is transient and excluded locally from Git and npm packaging.
