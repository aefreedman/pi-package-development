# Methodology and sources

The package's workflow combines established agent-skill evaluation practices with Pi-specific safety and packaging constraints.

## Primary sources

- Philipp Schmid, [Practical Guide to Evaluating and Testing Agent Skills](https://www.philschmid.de/testing-skills). This informed the outcome-first workflow, capability-versus-preference distinction, baseline comparison, repeated trials, and use of real failures as regression cases.
- OpenAI Developers, [Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills). This reinforced defining success before implementation, distinguishing outcome/process/style/efficiency goals, using explicit/implicit/contextual/negative prompts, capturing structured traces, layering deterministic and rubric-based grading, and adding heavier checks selectively.

These are methodology references, not runtime dependencies. Codex-specific commands, event names, sandbox flags, and `--output-schema` are not copied into the Pi runner.

## Pi-specific adaptations

- **Package-local ownership:** each target package owns its prompts, fixtures, checks, runner, and results. The meta package scaffolds and reviews rather than centralizing domain policy.
- **Three conditions:** baseline, available, and forced runs measure incremental value, automatic selection, and instruction-body quality separately.
- **Pi event validation:** generated runners validate Pi session-v3 JSON lifecycle events rather than Codex JSONL schemas.
- **Permission model:** generated runners decline fixture project trust and disable unrelated context, skills, and extensions. Mutating tools and extension execution require explicit configuration. Temporary fixture copies are not represented as security sandboxes.
- **Evidence hygiene:** summary results are the default. Raw responses and bounded event traces are diagnostic opt-ins because traces can expose prompts, tool arguments, file contents, provider details, and machine paths. Generated git and npm ignore rules reduce accidental retention, but maintainers must still inspect package contents before publication.
- **Behavioral-test separation:** nondeterministic provider-backed runs remain outside ordinary deterministic package tests.

## Evaluation principles

1. Define a checkable success contract before expanding the prompt set.
2. Prefer observable outcomes over one exact tool sequence.
3. Treat prompt kind and runner condition as independent axes.
4. Use deterministic evidence before model-assisted judgment.
5. Keep qualitative judges read-only, schema-validated, bounded, and separately scored.
6. Pilot cheaply, investigate failures as hypotheses, and use 3–5 trials before making reliability claims.
7. Convert confirmed real-world failures into durable regression cases.
8. Compare available behavior against baseline quality and cost; simplify or retire capability skills that no longer add measurable value.
