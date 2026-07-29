import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";

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

test("unavailable reference qualification accepts exact-path missing-file failures only", () => {
  const exactMissing = { name: "read", args: { path: releaseReference }, failed: true, errorCause: "ENOENT: no such file" };
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", context([exactMissing])), true);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", context([{ ...exactMissing, errorCause: "EACCES: permission denied" }])), false);
  assert.equal(release.evaluateCustomCheck("unavailable_reference_qualified", context([{ ...exactMissing, args: { path: "references/package-development/release-readiness.md" } }])), false);
  assert.equal(audit.evaluateCustomCheck("no_cwd_reference_fallback", context([{ name: "read", args: { path: "references/package-development/conventions.md" }, failed: true }])), false);
});

test("unavailable-reference allowance rejects an unrelated tool error", () => {
  const qualifyingMissingRead = { name: "read", args: { path: releaseReference }, failed: true, errorCause: "ENOENT: no such file" };
  const unrelatedPermissionError = { name: "bash", args: { command: "git status" }, failed: true, errorCause: "EACCES: permission denied" };
  assert.equal(evidence.countUnexpectedToolErrors([qualifyingMissingRead], [releaseReference]), 0);
  assert.equal(evidence.countUnexpectedToolErrors([qualifyingMissingRead, unrelatedPermissionError], [releaseReference]) === 0, false);
});

test("mandatory evidence keeps oversized args, failed-read cause, and the complete final answer", () => {
  const huge = "x".repeat(250_000);
  const finalAnswer = "final-".repeat(10_000);
  const calls = evidence.collectToolCalls([
    { type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: releaseReference, payload: huge } },
    { type: "tool_execution_end", toolCallId: "read-1", isError: true, error: { message: "ENOENT: no such file" } },
  ]);
  assert.equal(calls[0].args.payload.length, huge.length);
  assert.match(calls[0].errorCause, /ENOENT/);
  assert.equal(evidence.isMissingFileError(calls[0].errorCause), true);
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
    assert.doesNotMatch(source, /\/skill:\$\{/);
  }
});
