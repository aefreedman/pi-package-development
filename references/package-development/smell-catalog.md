# Pi Package Smell Catalog

A smell is evidence requiring investigation, not automatic proof of a defect.

## Critical

### Sensitive publish content

- **Evidence:** credentials, tokens, private URLs, personal data, machine paths, proprietary screenshots, or private research in packed files.
- **Failure:** private material can be published or exposed to agents.
- **Remediation:** remove, redact, relocate, and add deterministic prevention.

### Undeclared executable behavior

- **Evidence:** active extension entry points or executable scripts absent from reviewable package metadata, or package side effects that contradict declared resources.
- **Failure:** installation activates behavior users cannot reasonably inspect or filter.
- **Remediation:** declare entry points and side effects explicitly; remove unintended activation.

## High

### Broken clean-install path

- **Evidence:** extension shim imports missing `dist`, build scripts require undeclared tools, or packed files omit runtime artifacts.
- **Failure:** the package works only in the author's checkout.
- **Remediation:** declare dependencies and include or reproducibly build required output.

### Cross-package filesystem coupling

- **Evidence:** skills, prompts, or extensions read `../sibling-package`, fixed workspace paths, or installation-layout assumptions.
- **Failure:** independently installed packages cannot consume required content reliably.
- **Remediation:** use a skill-relative reference for same-package skill content, or an explicit addressed reference, bundled dependency, or package-qualified public reference for cross-package content.

### Runtime dependency misclassification

- **Evidence:** imported runtime modules exist only in `devDependencies`, framework peers are bundled, or package resources assume separately installed modules are shared.
- **Failure:** duplicate frameworks, missing modules, or package-specific behavior across install modes.
- **Remediation:** classify runtime, peer, and bundled dependencies according to Pi package rules.

### Silent guidance fallback

- **Evidence:** a workflow claims policy compliance after a mandatory reference read failed or substitutes an arbitrary workspace document.
- **Failure:** audit or workflow results appear authoritative without their authority source.
- **Remediation:** fail visibly and qualify the result.

## Medium

### Oversized skill spine

- **Evidence:** `SKILL.md` duplicates detailed policy, examples, or provider-specific guidance that is not always needed.
- **Failure:** unnecessary context cost and inconsistent duplicated rules.
- **Remediation:** retain trigger and workflow essentials; move details to on-demand references.

### Unnecessary same-package reference reader

- **Evidence:** a skill uses `read_package_reference` for a reference that its owning package already ships alongside the skill.
- **Failure:** the workflow adds an external-reader dependency and obscures native progressive disclosure despite having a stable skill-relative path.
- **Remediation:** load the reference through a path relative to the skill's `SKILL.md`; reserve `read_package_reference` for independently installed external consumers.

### Prompt as hidden workflow engine

- **Evidence:** a prompt duplicates a procedure intended for reuse or ordinary-language activation. Supporting evidence may include documentation promising implicit activation, multiple entry points duplicating the procedure, another workflow needing to invoke it, or tests expecting non-prompt activation. Prompt size alone is not evidence.
- **Not a smell:** prompt ownership is intentional when explicit invocation is the activation boundary and repository evidence supports that design, such as documentation or tests rejecting implicit activation. If intent is not established, record an unresolved design question or omit the finding rather than inferring a defect.
- **Failure:** reusable behavior is available only through remembered manual invocation or drifts across entry points despite evidence that broader reuse is intended.
- **Remediation:** when reuse is established, move reusable behavior to a discoverable skill and keep the prompt thin. Otherwise preserve the prompt-owned boundary and, if useful, document the intentional exception.

### Mixed semantic ownership

- **Evidence:** infrastructure packages own unrelated organizational policy solely because they transport it.
- **Failure:** unclear authority, release coupling, and difficult replacement.
- **Remediation:** move canonical knowledge to the package responsible for that domain.

### Ambiguous authority

- **Evidence:** documentation mixes Pi requirements, workspace rules, and preferences without labels.
- **Failure:** agents over-enforce recommendations or ignore actual requirements.
- **Remediation:** label authority and document exceptions.

### Non-recursive prompt assumption

- **Evidence:** prompt templates are placed in nested directories but only the conventional root is declared.
- **Failure:** expected slash commands are not discovered.
- **Remediation:** flatten prompts or explicitly list nested paths in `pi.prompts`.

### Publish-scope drift

- **Evidence:** `files`, `.npmignore`, generated output, and Pi resource declarations disagree.
- **Failure:** required files are absent or unintended files are packed.
- **Remediation:** reconcile metadata and verify `npm pack --dry-run`.

## Low

### Documentation duplication

- **Evidence:** the same normative rule appears independently in README, prompt, skill, and reference files.
- **Failure:** copies drift and consume context.
- **Remediation:** establish one canonical reference and link or load it.

### Unfocused package role

- **Evidence:** package name, description, exports, and included workflows describe unrelated responsibilities.
- **Failure:** poor discoverability and unclear ownership.
- **Remediation:** clarify the role or split independently evolving capabilities.

### Weak audit evidence

- **Evidence:** findings omit paths, classify preferences as failures, or infer absence from incomplete searches.
- **Failure:** results are hard to verify and may be misleading.
- **Remediation:** cite exact evidence, authority, scope, and confidence.
