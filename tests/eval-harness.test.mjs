import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const audit = await import("../evals/auditing-pi-packages/checks.ts");
const release = await import("../evals/preparing-pi-package-releases/checks.ts");
const evidence = await import("../evals/harness-evidence.ts");

function context(toolCalls, condition = "available") {
  return {
    answer: "The required reference is unavailable, so I cannot claim a policy-complete audit.",
    changedPaths: [], toolCalls, toolErrors: 0, condition,
    skillAvailable: condition === "available", skillFileRead: false,
    consumerCwd: resolve("/work/consumer"), installedPackageRoot: resolve("/work/installed-package"),
  };
}

const auditReference = resolve("/work/installed-package/references/package-development/conventions.md");
const releaseReference = resolve("/work/installed-package/references/package-development/release-readiness.md");

function missingReadResult(path) {
  return JSON.stringify({ content: [{ type: "text", text: `ENOENT: no such file or directory, open '${path}'` }], details: {} });
}

function strictMissingReadResult(path) {
  return JSON.stringify({ content: [{ type: "text", text: `ENOENT: no such file or directory, open '${path}'` }] });
}

test("available positive workflow checks require exact installed reads", () => {
  const allAudit = ["conventions.md", "smell-catalog.md", "audit-method.md"].map((file) => ({ name: "read", args: { path: resolve(`/work/installed-package/references/package-development/${file}`) }, failed: false }));
  assert.equal(audit.evaluateCustomCheck("workflow_followed", context(allAudit)), true);
  assert.equal(audit.evaluateCustomCheck("workflow_followed", context([{ name: "read", args: { path: auditReference }, failed: false }])), false);
  assert.equal(release.evaluateCustomCheck("workflow_followed", context([{ name: "read", args: { path: releaseReference }, failed: false }])), true);
});

test("available negative controls pass only without skill-specific reference behavior", () => {
  assert.equal(audit.evaluateCustomCheck("no_skill_specific_reference_behavior", context([])), true);
  assert.equal(audit.evaluateCustomCheck("no_skill_specific_reference_behavior", context([{ name: "read", args: { path: auditReference }, failed: false }])), false);
  assert.equal(release.evaluateCustomCheck("no_skill_specific_reference_behavior", context([])), true);
  assert.equal(release.evaluateCustomCheck("no_skill_specific_reference_behavior", context([{ name: "read", args: { path: releaseReference }, failed: true, errorCause: "ENOENT" }])), false);
});

test("unavailable-reference qualification requires a direct negated conclusion", () => {
  const exactMissing = { name: "read", args: { path: releaseReference }, failed: true, errorCause: missingReadResult(releaseReference) };
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", { ...context([exactMissing]), answer: "The required reference is unavailable, so I cannot confirm release readiness." }), true);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", { ...context([exactMissing]), answer: "The required reference is unavailable. Therefore, I cannot claim a policy-complete release assessment or release readiness." }), true);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", { ...context([exactMissing]), answer: "The required reference is unavailable; release readiness is not confirmed, but the package is release-ready." }), false);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", { ...context([exactMissing]), answer: "The required reference is unavailable, so I cannot confirm release readiness, but the package is ready for release." }), false);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", context([{ ...exactMissing, errorCause: "EACCES: permission denied" }])), false);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", context([{ ...exactMissing, errorCause: "ENOENT plus EACCES: no such file" }])), false);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", context([{ ...exactMissing, args: { path: "references/package-development/release-readiness.md" } }])), false);
  const auditMissing = { name: "read", args: { path: auditReference }, failed: true, errorCause: missingReadResult(auditReference) };
  assert.equal(audit.evaluateCustomCheck("unavailable_reference_qualified", { ...context([auditMissing]), answer: "The required reference is unavailable; I cannot claim a policy-complete audit." }), true);
  assert.equal(audit.evaluateCustomCheck("unavailable_reference_qualified", { ...context([auditMissing]), answer: "The required reference is unavailable; I cannot claim a policy-complete audit, but the audit is policy-complete." }), false);
  assert.equal(audit.evaluateCustomCheck("unavailable_reference_qualified", { ...context([auditMissing]), answer: "The required reference is unavailable; this is not claimed as an audit." }), false);
  assert.equal(audit.evaluateCustomCheck("no_cwd_reference_fallback", context([{ name: "read", args: { path: "references/package-development/conventions.md" }, failed: true }])), false);
});

test("missing-file classification accepts only complete native read outcomes", () => {
  const native = `ENOENT: no such file or directory, open '${releaseReference}'`;
  assert.equal(evidence.isMissingFileError(native, releaseReference), true);
  assert.equal(evidence.isMissingFileError(strictMissingReadResult(releaseReference), releaseReference), true);
  assert.equal(evidence.isMissingFileError(missingReadResult(releaseReference), releaseReference), true);
  assert.equal(evidence.isMissingFileError(`${native}\npermission denied`, releaseReference), false);
  assert.equal(evidence.isMissingFileError(JSON.stringify({ content: [{ type: "text", text: native }], details: { cause: "permission denied" } }), releaseReference), false);
  assert.equal(evidence.isMissingFileError(JSON.stringify({ content: [{ type: "text", text: native }], details: {}, diagnostic: "trailing cause" }), releaseReference), false);
  assert.equal(evidence.isMissingFileError(JSON.stringify({ content: [{ type: "text", text: native }, { type: "text", text: "unrelated diagnostic" }] }), releaseReference), false);
  assert.equal(evidence.isMissingFileError(missingReadResult(auditReference), releaseReference), false);
  assert.equal(evidence.isMissingFileError("The manual says file not found if it is absent.", releaseReference), false);
});

test("read-only optional ENOENT probes are bounded to the declared consumer target", () => {
  const consumerCwd = resolve("/work/consumer");
  const targetRoot = resolve(consumerCwd, "target-package");
  const roots = [{ consumerCwd, targetRoot }];
  const optionalPath = "./target-package/optional.md";
  const optionalProbe = { name: "read", args: { path: optionalPath }, failed: true, errorCause: missingReadResult(resolve(consumerCwd, optionalPath)) };
  assert.equal(evidence.countUnexpectedToolErrors([optionalProbe], [], roots), 0);
  assert.equal(evidence.countUnexpectedToolErrors([{ ...optionalProbe, errorCause: "EACCES: permission denied" }], [], roots), 1);
  assert.equal(evidence.countUnexpectedToolErrors([{ ...optionalProbe, args: { path: "./sibling-package/optional.md" } }], [], roots), 1);
  assert.equal(evidence.countUnexpectedToolErrors([{ ...optionalProbe, args: { path: "references/package-development/conventions.md" } }], [], roots), 1);
  assert.equal(evidence.countUnexpectedToolErrors([{ ...optionalProbe, args: { path: "./target-package/../sibling-package/optional.md" } }], [], roots), 1);
});

test("staged fixture symlink escapes are rejected before trials", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-skill-eval-link-"));
  try {
    const target = join(root, "target-package");
    const outside = join(root, "outside.md");
    await mkdir(target);
    await writeFile(outside, "outside");
    await symlink(outside, join(target, "escape.md"));
    await assert.rejects(evidence.assertNoSymlinks(root), /symlink or junction/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unavailable-reference allowance rejects an unrelated tool error", () => {
  const qualifyingMissingRead = { name: "read", args: { path: releaseReference }, failed: true, errorCause: missingReadResult(releaseReference) };
  const unrelatedPermissionError = { name: "bash", args: { command: "git status" }, failed: true, errorCause: "EACCES: permission denied" };
  assert.equal(evidence.countUnexpectedToolErrors([qualifyingMissingRead], [releaseReference]), 0);
  assert.equal(evidence.countUnexpectedToolErrors([qualifyingMissingRead, unrelatedPermissionError], [releaseReference]) === 0, false);
});

test("mandatory evidence keeps oversized args, failed-read cause, and the complete final answer", () => {
  const huge = "x".repeat(250_000);
  const finalAnswer = "final-".repeat(10_000);
  const calls = evidence.collectToolCalls([
    { type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: releaseReference, payload: huge } },
    { type: "tool_execution_end", toolCallId: "read-1", isError: true, result: JSON.parse(missingReadResult(releaseReference)) },
  ]);
  assert.equal(calls[0].args.payload.length, huge.length);
  assert.match(calls[0].errorCause, /ENOENT/);
  assert.equal(evidence.isMissingFileError(calls[0].errorCause, releaseReference), true);
  assert.equal(evidence.hasCompleteMandatoryEvidence(calls, { role: "assistant", content: [{ type: "text", text: finalAnswer }] }), true);
  assert.equal(evidence.hasCompleteMandatoryEvidence([{ ...calls[0], errorCause: undefined }], { role: "assistant", content: [] }), false);
});

test("timeout ownership leaves normal exits alone and terminates only a timed-out child", async () => {
  let normalTerminations = 0;
  const normal = evidence.createTerminationController(async () => { normalTerminations += 1; });
  normal.onClose();
  normal.onTimeout();
  await normal.waitForTermination();
  assert.deepEqual(normal.state(), { timedOut: false, terminationRequested: false });
  assert.equal(normalTerminations, 0);

  let timeoutTerminations = 0;
  const timedOut = evidence.createTerminationController(async () => { timeoutTerminations += 1; });
  timedOut.onTimeout();
  timedOut.onTimeout();
  await timedOut.waitForTermination();
  assert.deepEqual(timedOut.state(), { timedOut: true, terminationRequested: true });
  assert.equal(timeoutTerminations, 1);
});

test("runners do not fake forced slash invocation", async () => {
  for (const path of ["../evals/auditing-pi-packages/run-eval.ts", "../evals/preparing-pi-package-releases/run-eval.ts"]) {
    const source = await (await import("node:fs/promises")).readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /createTerminationController/);
    assert.match(source, /child\.once\("close", resolveExit\)/);
    assert.match(source, /consumer_target_path/);
    assert.match(source, /targetRoot: consumerTargetRoot/);
    assert.match(source, /assertNoSymlinks\(consumerCwd\)/);
    assert.doesNotMatch(source, /\/skill:\$\{/);
  }
});
