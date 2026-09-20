import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import register from "../dist/pi/register.js";

let tool, query;
register({ on() {}, registerTool(value) { if (value.name === "pi_analyze_session") tool = value; if (value.name === "pi_query_session") query = value; } });
const time = Date.parse("2026-01-02T12:00:00Z");
const entry = (id, parentId, message) => ({ type: "message", id, parentId, timestamp: time, message });
const text = { type: "text", text: "Synthetic text" };
const image = { type: "image", data: "c3ludGhldGlj", mimeType: "image/png" };
const thinking = { type: "thinking", thinking: "Synthetic thought" };
const call = (extra = {}) => ({ type: "toolCall", id: "native-call", name: "read", arguments: { path: "synthetic.txt" }, ...extra });
const result = (extra = {}) => ({ role: "toolResult", toolName: "read", toolCallId: "native-call", isError: false, content: [text], ...extra });
const system = (extra = {}) => ({ role: "system", content: "Synthetic transcript patch", timestamp: time, ...extra });
const usage = (id, parentId, extra = {}) => ({
  type: "usage", id, parentId, timestamp: time, kind: "cache_warm", provider: "synthetic", model: "synthetic",
  usage: { input: 0, output: 0, cacheRead: 10, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0.01, cacheWrite: 0, total: 0.01 } },
  ...extra,
});
async function analyze(records) {
  const root = await mkdtemp(join(tmpdir(), "pi-extraction-repair-synthetic-"));
  try {
    const file = join(root, "session.jsonl");
    await writeFile(file, [{ type: "session", version: 3, id: "synthetic-repair", timestamp: time }, ...records].map(record => JSON.stringify(record)).join("\n"));
    const report = await tool.execute("synthetic-repair", { session: file, since: "2026-01-02", until: "2026-01-02", asOf: "2026-01-03T00:00:00Z" }, undefined, undefined, { cwd: root });
    report.packets = [];
    for (const lead of report.details.rows) {
      const evidence = await query.execute("repair-evidence", { reportRef: report.details.reportRef, leadRef: lead.leadRef }, undefined, undefined, { cwd: root });
      assert.equal(evidence.details.evidenceCoverage.analysisIncomplete, report.details.analysisStatus === "incomplete");
      report.packets.push(...evidence.details.rows);
    }
    return report;
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
  assert.equal(report.details.total, 0);
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
  assert.equal(report.packets[0].join, "unresolved");
  assert.equal(report.packets[0].call, undefined);
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

test("Pi 0.86 system and unknown-kind usage metadata preserve complete native ancestry", async () => {
  const report = await analyze([
    entry("u", null, { role: "user", content: "Synthetic request" }),
    entry("s", "u", system({ sections: { skills: "<skills />" }, toolsAdded: [{ name: "read", description: "Synthetic read", parameters: {} }], toolsRemoved: [{ name: "obsolete" }] })),
    entry("c", "s", { role: "assistant", stopReason: "toolUse", content: [call()] }),
    usage("warm", "c", { kind: "future_usage_kind", usage: { input: 0, output: 0, cacheRead: 10, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0.01, cacheWrite: 0, total: 0.01 } } }),
    entry("r", "warm", result({ isError: true })),
  ]);
  assert.equal(report.details.analysisStatus, "complete");
  assert.equal(report.details.corpus.unsupportedRecords, 0);
  assert.equal(report.details.extraction.unsupportedMessages, 0);
  assert.equal(report.details.totals.failures, 1);
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.extraction.unresolvedResults, 0);
  assert.equal(report.packets[0].join, "native_id_ancestry");
});

test("malformed Pi 0.86 usage accounting is incomplete without severing native ancestry", async () => {
  for (const invalid of [
    { kind: 1 }, { provider: undefined }, { model: undefined }, { usage: {} },
    { usage: { input: "0", output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  ]) {
    const report = await analyze([
      entry("u", null, { role: "user", content: "Synthetic request" }),
      entry("c", "u", { role: "assistant", stopReason: "toolUse", content: [call()] }),
      usage("warm", "c", invalid),
      entry("r", "warm", result({ isError: true })),
    ]);
    assert.equal(report.details.analysisStatus, "incomplete", JSON.stringify(invalid));
    assert.equal(report.details.corpus.unsupportedRecords, 1, JSON.stringify(invalid));
    assert.equal(report.details.extraction.unresolvedResults, 0, JSON.stringify(invalid));
    assert.equal(report.packets[0].join, "native_id_ancestry", JSON.stringify(invalid));
  }
});

test("malformed Pi 0.86 system patch fields are incomplete without severing native ancestry", async () => {
  for (const invalid of [
    { timestamp: "not-a-timestamp" }, { sections: [] }, { sections: { skills: 1 } },
    { toolsAdded: [{ name: "read", parameters: {} }] }, { toolsAdded: [{ name: "read", description: "Synthetic", parameters: [] }] }, { toolsRemoved: [{}] },
  ]) {
    const report = await analyze([
      entry("u", null, { role: "user", content: "Synthetic request" }),
      entry("s", "u", system(invalid)),
      entry("c", "s", { role: "assistant", stopReason: "toolUse", content: [call()] }),
      usage("warm", "c"),
      entry("r", "warm", result({ isError: true })),
    ]);
    assert.equal(report.details.analysisStatus, "incomplete", JSON.stringify(invalid));
    assert.equal(report.details.extraction.unsupportedMessages, 1, JSON.stringify(invalid));
    assert.equal(report.details.extraction.unresolvedResults, 0, JSON.stringify(invalid));
    assert.equal(report.packets[0].join, "native_id_ancestry", JSON.stringify(invalid));
  }
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
    assert.equal(unmatched.packets[0].join, "unresolved", supplied);
    assert.equal(unmatched.packets[0].call, undefined, supplied);
    const actual = await analyze([
      entry("c", null, { role: "assistant", content: [missing, call({ id: supplied })] }),
      entry("r", "c", result({ toolCallId: supplied, isError: true })),
    ]);
    assert.equal(actual.details.totals.toolCalls, 2, supplied);
    assert.equal(actual.details.extraction.unresolvedCalls, 1, supplied);
    assert.equal(actual.details.extraction.unresolvedResults, 0, supplied);
    assert.equal(actual.packets[0].join, "native_id_ancestry", supplied);
    assert.equal(actual.packets[0].call.block, 1, "only the genuine native-ID call is attributable: " + supplied);
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
  assert.equal(report.packets[0].join, "legacy_name_ancestry");
  assert.equal(report.details.analysisStatus, "incomplete");
});
