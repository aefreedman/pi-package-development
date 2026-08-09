# Check design

## Prefer deterministic evidence

Use the cheapest reliable evidence source:

1. process exit and structured test results
2. parsed files, ASTs, schemas, or API responses
3. filesystem snapshots and changed-path allowlists
4. exact or bounded semantic patterns
5. model-assisted judging only for genuinely qualitative outcomes

## Check properties

A good check is:

- observable from the case output or fixture
- specific to the intended requirement
- resilient to equivalent valid implementations
- named by the behavior it proves
- accompanied by a failure message that helps diagnosis

Avoid checks that merely assert the agent used one exact tool sequence. Tool-use observations are useful efficiency and debugging evidence, but the primary grade should be the outcome. Check command ordering only when order is itself a safety or correctness invariant.

## Evidence ladder

Add the lightest evidence that closes the current risk:

1. file/schema/API assertions
2. compilation or focused tests
3. repository cleanliness against an explicit changed-path allowlist
4. runtime smoke checks, such as starting a service and probing one endpoint
5. broader end-to-end or browser checks

Also test permission regressions when least privilege is part of the skill contract. Heavier checks should remain selective because they add runtime, flakiness, and cleanup risk.

## Trigger checks

For Pi's available condition, skill loading can be observed through the structured event stream when the agent reads the target `SKILL.md`. A forced invocation does not need that read, because Pi expands the skill command directly. Baseline trigger checks should be reported as not applicable rather than counted as failures.

## Model-assisted judges

Use a judge only when deterministic evidence cannot capture the requirement. Constrain it to a typed schema, record the judge model/version and rubric, and keep raw evaluated content bounded and redacted. Do not let a judge replace compilation, tests, schema validation, or other stronger evidence.

Prefer a two-pass design:

1. the execution pass runs the skill and captures trace metrics plus artifacts
2. a separate read-only judge inspects only the bounded artifacts required by a small rubric and returns schema-validated per-check results

Keep deterministic and judge scores separate so a persuasive qualitative response cannot hide a failed build or missing artifact. Pi does not depend on Codex's `--output-schema`; package runners should validate the judge's structured response themselves.

## Avoid overfitting

When an eval fails, ask in this order:

1. Is the fixture complete and realistic?
2. Is the criterion measuring the intended outcome?
3. Is the check implementation correct?
4. Is the prompt ambiguous?
5. Did the runner or harness fail?
6. Only then: does the skill need to change?
