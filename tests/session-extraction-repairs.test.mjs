import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import register from "../dist/pi/register.js";

let tool;
register({ on() {}, registerTool(value) { if (value.name === "pi_analyze_session") tool = value; } });
const time = Date.parse("2026-01-02T12:00:00Z");
const entry = (id, parentId, message) => ({ type: "message", id, parentId, timestamp: time, message });
const text = { type: "text", text: "Synthetic text" };
const image = { type: "image", data: "c3ludGhldGlj", mimeType: "image/png" };
const thinking = { type: "thinking", thinking: "Synthetic thought" };
const call = (extra = {}) => ({ type: "toolCall", id: "native-call", name: "read", arguments: { path: "synthetic.txt" }, ...extra });
const result = (extra = {}) => ({ role: "toolResult", toolName: "read", toolCallId: "native-call", isError: false, content: [text], ...extra });
async function analyze(records) {
  const root = await mkdtemp(join(tmpdir(), "pi-extraction-repair-synthetic-"));
  try {
    const file = join(root, "session.jsonl");
    await writeFile(file, [{ type: "session", version: 3, id: "synthetic-repair", timestamp: time }, ...records].map(record => JSON.stringify(record)).join("\n"));
    return await tool.execute("synthetic-repair", { session: file, since: "2026-01-02", until: "2026-01-02", asOf: "2026-01-03T00:00:00Z" }, undefined, undefined, { cwd: root });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("Gate1 B3: unknown user/assistant blocks are incomplete, not inferred executions", async () => {
  const report = await analyze([
    entry("u", null, { role: "user", content: [{ type: "future-content", data: "Synthetic unknown" }] }),
    entry("a", "u", { role: "assistant", stopReason: "stop", content: [{ type: "future-call", name: "read", arguments: { path: "synthetic" } }] }),
  ]);
  assert.equal(report.details.analysisStatus, "incomplete");
  assert.equal(report.details.extraction.unsupportedMessages, 2);
  assert.deepEqual(report.details.totals, { toolCalls: 0, failures: 0, userMessages: 1 });
  assert.equal(report.details.incidents.length, 0);
});

test("Gate1 B4: supplied native ID cannot resolve a fabricated missing-ID placeholder", async () => {
  const missing = call(); delete missing.id;
  const report = await analyze([
    entry("c", null, { role: "assistant", stopReason: "toolUse", content: [missing] }),
    entry("r", "c", result({ toolCallId: "missing-c-0", isError: true })),
  ]);
  assert.equal(report.details.totals.toolCalls, 1);
  assert.equal(report.details.totals.failures, 1, "retain observed native failure, not guessed attribution");
  assert.equal(report.details.extraction.unresolvedCalls, 1);
  assert.equal(report.details.extraction.unresolvedResults, 1);
  assert.equal(report.details.incidents.length, 0);
  assert.equal(report.details.analysisStatus, "incomplete");
});

test("role-specific unknown and malformed blocks disclose coverage without invented block semantics", async () => {
  const common = [null, "synthetic", [], {}, { type: "future-content", data: "unknown" }, { type: "text" }, { type: "text", text: 17 }];
  const cases = {
    user: [...common, thinking, call(), { type: "image", data: "synthetic" }, { type: "image", data: 17, mimeType: "image/png" }],
    assistant: [...common, image, { type: "thinking" }, { type: "thinking", thinking: 17 }, call({ name: "" }), call({ arguments: null }), call({ arguments: [] }), call({ id: null }), call({ id: "" }), call({ id: 17 })],
    toolResult: [...common, thinking, call(), { type: "image", mimeType: "image/png" }, { type: "image", data: "synthetic", mimeType: 17 }],
  };
  for (const [role, blocks] of Object.entries(cases)) {
    for (const block of blocks) {
      const records = role === "toolResult" ? [entry("c", null, { role: "assistant", content: [call()] }), entry("r", "c", result({ content: [block], isError: true }))]
        : [entry("m", null, { role, stopReason: "stop", content: [block] })];
      const report = await analyze(records);
      const label = `${role}: ${JSON.stringify(block)}`;
      assert.equal(report.details.analysisStatus, "incomplete", label);
      assert.equal(report.details.extraction.unsupportedMessages, 1, label);
      assert.equal(report.details.totals.toolCalls, role === "toolResult" ? 1 : 0, label);
      assert.equal(report.details.totals.failures, role === "toolResult" ? 1 : 0, "native result state is retained independently of malformed content: " + label);
      assert.equal(report.details.extraction.heuristicLeads, 0, label);
    }
  }
});

test("valid string/text/image/thinking/tool-call blocks retain complete extraction", async () => {
  const report = await analyze([
    entry("u", null, { role: "user", content: "Synthetic string request" }),
    entry("u2", "u", { role: "user", content: [text, image] }),
    entry("c", "u2", { role: "assistant", stopReason: "toolUse", content: [{ ...text, textSignature: "synthetic" }, { ...thinking, thinkingSignature: "synthetic" }, call()] }),
    entry("r", "c", result({ content: [text, image] })),
  ]);
  assert.equal(report.details.analysisStatus, "complete");
  assert.equal(report.details.extraction.unsupportedMessages, 0);
  assert.deepEqual(report.details.totals, { toolCalls: 1, failures: 0, userMessages: 2 });
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.extraction.unresolvedResults, 0);
});

test("mixed content retains valid sibling calls and native assistant terminal states", async () => {
  const report = await analyze([
    entry("c", null, { role: "assistant", stopReason: "error", content: [{ type: "future-call" }, { type: "text", text: { ok: false } }, text, thinking, call()] }),
    entry("r", "c", result()),
  ]);
  assert.equal(report.details.extraction.unsupportedMessages, 1, "count affected messages, not unknown blocks");
  assert.equal(report.details.extraction.assistantErrors, 1);
  assert.equal(report.details.totals.toolCalls, 1);
  assert.equal(report.details.totals.failures, 0);
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.extraction.unresolvedResults, 0);
  assert.equal(report.details.analysisStatus, "incomplete");
});

test("internal-ID lookalikes cannot bind missing-ID calls but genuine supplied lookalikes can", async () => {
  for (const supplied of ["missing-c-0", "call-c-0"]) {
    const missing = call(); delete missing.id;
    const unmatched = await analyze([
      entry("c", null, { role: "assistant", content: [missing] }),
      entry("r", "c", result({ toolCallId: supplied, isError: true })),
    ]);
    assert.equal(unmatched.details.extraction.unresolvedCalls, 1, supplied);
    assert.equal(unmatched.details.extraction.unresolvedResults, 1, supplied);
    assert.equal(unmatched.details.incidents.length, 0, supplied);
    const actual = await analyze([
      entry("c", null, { role: "assistant", content: [missing, call({ id: supplied })] }),
      entry("r", "c", result({ toolCallId: supplied, isError: true })),
    ]);
    assert.equal(actual.details.totals.toolCalls, 2, supplied);
    assert.equal(actual.details.extraction.unresolvedCalls, 1, supplied);
    assert.equal(actual.details.extraction.unresolvedResults, 0, supplied);
    assert.equal(actual.details.incidents.length, 1, "only the genuine native-ID call is attributable: " + supplied);
  }
});

test("unambiguous absent-ID legacy correlation remains available and explicitly incomplete", async () => {
  const missing = call(); delete missing.id;
  const noId = result({ isError: true }); delete noId.toolCallId;
  const report = await analyze([entry("c", null, { role: "assistant", content: [missing] }), entry("r", "c", noId)]);
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.extraction.unresolvedResults, 0);
  assert.equal(report.details.extraction.legacyCorrelations, 2);
  assert.equal(report.details.extraction.unsupportedMessages, 0);
  assert.equal(report.details.incidents.length, 1);
  assert.equal(report.details.analysisStatus, "incomplete");
});
