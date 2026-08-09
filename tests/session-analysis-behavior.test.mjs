import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import registerPackageDevelopment from "../dist/pi/register.js";

let registeredTool;
registerPackageDevelopment({
  on() {},
  registerTool(tool) {
    if (tool.name === "pi_analyze_session") registeredTool = tool;
  },
});
assert(registeredTool, "Expected pi_analyze_session tool to register.");

const fixtureRoot = new URL("fixtures/session-analysis/", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const result = await registeredTool.execute("fixture-analysis", {
  session: "all",
  projectFolder: fixtureRoot,
  days: 365,
  filterMode: "all",
  reportMode: "full",
  limitFailures: 100,
  limitCorrections: 100,
}, undefined, undefined, { cwd: process.cwd() });

const text = result.content[0].text;
const details = result.details;
const incidents = details.incidents;
const candidates = details.candidates;

assert.equal(details.analysisStatus, "incomplete", "Malformed fixture must produce explicit incomplete-analysis status.");
assert(text.includes("Malformed/truncated JSONL lines: 1"), "Expected malformed-line diagnostic.");
assert(text.includes("native error state and known structured envelopes precede"), "Expected extraction precedence disclosure.");
assert(text.includes("python-windows-unicode-output: 1"), "Expected Windows Unicode signature.");
assert(text.includes("large-generated-text-shell-quoting: 1"), "Expected Windows shell quoting signature.");
assert(!text.includes("core/files:read: 2"), "Successful content containing error-like words must not be classified as failure.");

const searchIncidents = incidents.filter((incident) => incident.category === "parallel_codecks-search-cancelled");
assert.equal(searchIncidents.length, 2, "The 8- and 10-search fixtures should become two bounded incidents.");
assert.deepEqual(searchIncidents.map((incident) => incident.callCount).sort((a, b) => a - b), [8, 10]);
assert(searchIncidents.every((incident) => incident.maxConcurrency === incident.callCount), "Expected overlapping calls to report peak concurrency.");
assert(searchIncidents.every((incident) => incident.wallTimeMs === 210_000), "Parallel wall time must not sum individual durations.");

const identifierIncidents = incidents.filter((incident) => incident.category === "identifier_form_recovery");
assert.equal(identifierIncidents.length, 8, "Expected numeric-to-seq retries to correlate.");
assert(identifierIncidents.every((incident) => incident.argumentDiff === "bare numeric identifier → seq:<number>"));
assert(incidents.some((incident) => incident.category === "preview_apply_corrective_mutation"), "Expected preview/apply/corrective mutation incident.");
const amplification = incidents.find((incident) => incident.category === "public_tool_call_amplification");
assert.equal(amplification?.callCount, 31, "Expected 31 public Run assignment calls to form one amplification incident.");

const candidate = (theme) => candidates.find((item) => item.theme === theme);
assert.equal(candidate("Untrustworthy Codecks bulk schema and preview behavior")?.disposition, "existing_package_fix");
assert.equal(candidate("Repeated Codecks search cancellation and unsafe fan-out")?.disposition, "existing_package_fix");
assert(candidate("Repeated Codecks search cancellation and unsafe fan-out")?.contributors.includes("agent_execution"));
assert.equal(candidate("Codecks account-sequence identifier typing")?.disposition, "existing_package_guidance");
assert.equal(candidate("Codecks batch capability and tool-call amplification")?.evidenceCount, 31);
assert.equal(candidate("Tracker review steps and internal identifier presentation")?.disposition, "project_workflow");
assert.equal(candidate("Windows UTF-8 and shell-command ergonomics")?.disposition, "environment_ergonomics");
assert(candidates.indexOf(candidate("Untrustworthy Codecks bulk schema and preview behavior")) < candidates.indexOf(candidate("Windows UTF-8 and shell-command ergonomics")), "Unsafe corrective mutation must outrank generic Windows friction.");
assert(text.includes("Package defect vs misuse vs project policy"), "Expected disposition summary.");
assert(text.includes("Median | P95 | Max"), "Expected package latency metrics.");
assert(text.includes("argument diff=bare numeric identifier → seq:<number>"), "Detailed mode should show bounded argument diffs.");

const serialized = `${text}\n${JSON.stringify(details)}`;
for (const forbidden of ["PRIVATE SYNTHETIC CARD BODY", "do not expose this external body", "TOPSECRETVALUE", "SUPERSECRETVALUE", "Bearer SUPERSECRET"]) {
  assert(!serialized.includes(forbidden), `Privacy leak: ${forbidden}`);
}
assert(!("files" in details), "Tool details must not expose source-session paths.");
assert(text.includes("Full card bodies, credentials, headers, and large command output are omitted"));
assert(candidates.every((item) => item.sourceVerification === "uncertain"), "Historical evidence without an approved root must keep current source uncertain.");

// Approved roots receive bounded package-specific feature checks, not arbitrary source scans.
const syntheticSourceRoot = process.env.PI_CODECKS_APPROVED_SOURCE_ROOT
  ? undefined
  : mkdtempSync(join(tmpdir(), "pi-package-development-approved-codecks-"));
const approvedSourceRoot = process.env.PI_CODECKS_APPROVED_SOURCE_ROOT ?? syntheticSourceRoot;
try {
  if (syntheticSourceRoot) {
    mkdirSync(join(syntheticSourceRoot, "src"));
    writeFileSync(join(syntheticSourceRoot, "package.json"), JSON.stringify({ name: "@aefree/pi-codecks" }), "utf8");
    writeFileSync(join(syntheticSourceRoot, "src", "codecks-core.ts"), [
      "const BULK_CREATE_FIELDS = true; // assignee is unsupported; use assigneeId",
      "const proposed = {}; proposed.assignee = value;",
      "const ACCOUNT_SCAN_MAX_QUEUE = 8; const scan_queue_full = true; function runWithAbortSignal() {}",
      "const hint = 'Bare numeric identifiers are short codes'; const recovery = { suggestedCardRef: `seq:${requestedId}` };",
      "const BULK_UPDATE_FIELDS = ['runId']; export const card_bulk_update = tool({});",
    ].join("\n"), "utf8");
  }
  const sourceChecked = await registeredTool.execute("source-checked-analysis", {
    session: "all", projectFolder: fixtureRoot, days: 365, reportMode: "full", approvedSourceRoots: [approvedSourceRoot],
  }, undefined, undefined, { cwd: process.cwd() });
  const sourceText = sourceChecked.content[0].text;
  const sourceDetails = sourceChecked.details;
  const verification = sourceDetails.sourceVerifications.find((item) => item.packageName === "pi-codecks");
  assert.equal(verification?.status, "current_source_confirmed", "Expected targeted current pi-codecks feature verification.");
  assert.equal(verification?.assessment, "remediation_features_present");
  assert.deepEqual(verification?.uncertainFeatures, []);
  for (const theme of Object.keys({
    "Untrustworthy Codecks bulk schema and preview behavior": true,
    "Repeated Codecks search cancellation and unsafe fan-out": true,
    "Codecks account-sequence identifier typing": true,
    "Codecks batch capability and tool-call amplification": true,
  })) {
    const currentCandidate = sourceDetails.candidates.find((item) => item.theme === theme);
    assert.equal(currentCandidate?.sourceVerification, "current_source_confirmed", `Expected confirmed source state for ${theme}.`);
    assert.equal(currentCandidate?.state, "likely_already_fixed", `Targeted remediation features should not leave ${theme} classified as a current defect.`);
  }
  assert(sourceText.includes("historical evidence; current_source_confirmed; likely_already_fixed"), "Report must separate historical incidents from confirmed current remediation features.");
  assert(!`${sourceText}\n${JSON.stringify(sourceDetails)}`.includes(approvedSourceRoot), "Approved source paths must not enter report text/details.");
} finally {
  if (syntheticSourceRoot) rmSync(syntheticSourceRoot, { recursive: true, force: true });
}

const uncertainSourceRoot = mkdtempSync(join(tmpdir(), "pi-package-development-uncertain-codecks-"));
try {
  mkdirSync(join(uncertainSourceRoot, "src"));
  writeFileSync(join(uncertainSourceRoot, "package.json"), JSON.stringify({ name: "@aefree/pi-codecks" }), "utf8");
  writeFileSync(join(uncertainSourceRoot, "src", "codecks-core.ts"), "export const unrelated = true;", "utf8");
  const uncertain = await registeredTool.execute("uncertain-source-analysis", {
    session: "all", projectFolder: fixtureRoot, days: 365, reportMode: "compact", approvedSourceRoots: [uncertainSourceRoot],
  }, undefined, undefined, { cwd: process.cwd() });
  assert.equal(uncertain.details.sourceVerifications[0]?.status, "uncertain");
  assert(uncertain.details.candidates.filter((item) => item.packageName === "pi-codecks").every((item) => item.sourceVerification === "uncertain"));
  assert(!uncertain.content[0].text.includes(uncertainSourceRoot), "Uncertain roots must also remain private.");
} finally {
  rmSync(uncertainSourceRoot, { recursive: true, force: true });
}

const filtered = await registeredTool.execute("filtered-analysis", {
  session: "all",
  projectFolder: fixtureRoot,
  days: 365,
  filterMode: "package-workflow",
  reportMode: "candidates",
  knownFixed: "Codecks account-sequence identifier typing; unrelated theme",
  excludeThemes: ["Windows UTF-8 and shell-command ergonomics"],
}, undefined, undefined, { cwd: process.cwd() });
const filteredText = filtered.content[0].text;
assert(filteredText.includes("knownFixed: Codecks account-sequence identifier typing"), "Known-fixed themes must be disclosed.");
assert(filteredText.includes("excludeThemes: Windows UTF-8 and shell-command ergonomics"), "Excluded themes must be disclosed.");
assert(filteredText.includes("filterMode: Tracker review steps and internal identifier presentation"), "Filtered project themes must be disclosed.");
assert(filteredText.includes("Mode coverage: broad corrections"), "Candidate mode must retain machine-readable coverage counts.");
assert(filteredText.includes("Ranked incidents"), "Candidate mode must retain bounded incident context.");

// A high-failure package without a synthesized package candidate must warn rather than disappear.
const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-package-development-coverage-gap-"));
try {
  const sessionPath = join(temporaryRoot, "2026-01-01T00-00-00-000Z_synthetic-gap.jsonl");
  const lines = [
    { type: "session", timestamp: 1_700_500_000_000, cwd: "C:/synthetic/redacted" },
    { type: "message", timestamp: 1_700_500_000_001, message: { role: "user", timestamp: 1_700_500_000_001, content: [{ type: "text", text: "Synthetic gap test" }] } },
  ];
  for (let index = 0; index < 3; index++) {
    lines.push({ type: "message", timestamp: 1_700_500_001_000 + index * 1000, message: { role: "assistant", timestamp: 1_700_500_001_000 + index * 1000, content: [{ type: "toolCall", id: `g${index}`, name: "mystery_package_action", arguments: {} }] } });
    lines.push({ type: "message", timestamp: 1_700_500_001_100 + index * 1000, message: { role: "toolResult", timestamp: 1_700_500_001_100 + index * 1000, toolCallId: `g${index}`, toolName: "mystery_package_action", isError: true, content: [{ type: "text", text: "synthetic failure" }] } });
  }
  writeFileSync(sessionPath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  const gap = await registeredTool.execute("gap-analysis", { session: sessionPath, reportMode: "candidates" }, undefined, undefined, { cwd: process.cwd() });
  assert(gap.content[0].text.includes("candidate_coverage_gap: other has 3 failures"));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("session analysis behavior tests passed");
