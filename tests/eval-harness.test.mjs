import assert from "node:assert/strict";
import test from "node:test";

const audit = await import("../evals/auditing-pi-packages/checks.ts");
const release = await import("../evals/preparing-pi-package-releases/checks.ts");

function context(toolCalls) {
  return {
    answer: "The required reference is unavailable, so I cannot claim a policy-complete audit.",
    guidance: "",
    changedPaths: [],
    toolCalls,
    toolErrors: 0,
    condition: "available",
    skillLoaded: true,
    auditRoot: "/work/consumer",
    consumerCwd: "/work/consumer",
    installedPackageRoot: "/work/installed-package",
  };
}

test("eval checks require installed references and reject consumer-CWD fallback", () => {
  const auditReference = "references/package-development/conventions.md";
  const auditInstalled = context([{ name: "read", args: { path: "/work/installed-package/references/package-development/conventions.md" }, failed: false }]);
  assert.equal(audit.evaluateCustomCheck("no_cwd_reference_fallback", auditInstalled), true);
  assert.equal(audit.evaluateCustomCheck("required_local_audit_references_loaded", auditInstalled), false);

  const auditFallback = context([{ name: "read", args: { path: auditReference }, failed: true }]);
  assert.equal(audit.evaluateCustomCheck("no_cwd_reference_fallback", auditFallback), false);

  const releaseInstalled = context([{ name: "read", args: { path: "/work/installed-package/references/package-development/release-readiness.md" }, failed: false }]);
  assert.equal(release.evaluateCustomCheck("required_local_release_reference_loaded", releaseInstalled), true);
  assert.equal(release.evaluateCustomCheck("no_cwd_reference_fallback", releaseInstalled), true);

  const releaseFallback = context([{ name: "read", args: { path: "references/package-development/release-readiness.md" }, failed: true }]);
  assert.equal(release.evaluateCustomCheck("no_cwd_reference_fallback", releaseFallback), false);
});

test("eval checks accept only a failed installed reference as unavailable evidence", () => {
  const unavailable = context([{ name: "read", args: { path: "/work/installed-package/references/package-development/release-readiness.md" }, failed: true }]);
  assert.equal(release.evaluateCustomCheck("unavailable_local_reference_qualified", unavailable), true);

  const fallback = context([{ name: "read", args: { path: "references/package-development/release-readiness.md" }, failed: true }]);
  assert.equal(release.evaluateCustomCheck("unavailable_local_reference_qualified", fallback), false);
});
