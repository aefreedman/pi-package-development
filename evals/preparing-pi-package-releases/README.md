# `preparing-pi-package-releases` behavioral eval

This package-owned, opt-in suite checks release-preparation guidance. It is separate from `npm test`, does not run automatically, and has not been run against a provider.

## Covered behavior

- The release skill natively reads its required package-local release-readiness reference through `read`, without `read_package_reference`.
- A genuinely failed required local read is explicitly qualified rather than treated as a policy-complete readiness result.
- Release preparation performs no publish, push, or version mutation; deterministic snapshots and the no-mutation tool allowlist enforce that boundary.
- An unrelated README request is a negative trigger control.

## Isolation and safety

Each trial starts from a fresh copy of the synthetic fixture, target skill, and package-local reference, declines context files and approval, disables unrelated skills, closes stdin, and exposes only native `read`. `local_reference_mode: "unavailable"` removes the copied required reference while retaining `read`, so qualification requires an attempted local read that actually fails. No extensions, shell, edit, or write tools are enabled. A temporary copy is not an OS sandbox; use trusted fixtures locally and an OS container/VM for untrusted or unattended runs.

Raw answers and event traces are opt-in diagnostics and must not be committed.

## Run deliberately

```sh
node --experimental-strip-types evals/preparing-pi-package-releases/run-eval.ts --condition available --trials 1
```

Pilot with one trial, then use 3–5 trials per condition after reviewing fixtures and criteria. Compare `available` and `baseline` without treating a baseline pass as failure. `latest-results.json` is transient and excluded locally from Git and npm packaging.
