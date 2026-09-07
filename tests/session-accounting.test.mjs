import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import register from "../dist/pi/register.js";

let tool;
register({ on() {}, registerTool(value) { if (value.name === "pi_analyze_session") tool = value; } });
const start = Date.parse("2026-01-02T12:00:00Z");
const window = { since: "2026-01-02", until: "2026-01-02", asOf: "2026-01-03T00:00:00Z" };
const header = (id, extra = {}) => ({ type: "session", id, version: 3, timestamp: start, ...extra });
const message = (id, parentId, message, timestamp = start) => ({ type: "message", id, parentId, timestamp, message });
const call = (id, parentId, callId = id, name = "read", timestamp = start) => message(id, parentId, { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: callId, name, arguments: { path: "synthetic.txt" } }] }, timestamp);
const result = (id, parentId, callId, extra = {}, timestamp = start + 100) => message(id, parentId, { role: "toolResult", toolName: "read", toolCallId: callId, isError: false, content: [{ type: "text", text: "Synthetic content" }], ...extra }, timestamp);
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pi-accounting-synthetic-"));
  const save = async (name, records) => { const path = join(root, name); await writeFile(path, records.map(record => JSON.stringify(record)).join("\n")); return path; };
  const run = (params = {}, signal, update) => tool.execute("synthetic-analysis", { session: root, ...window, ...params }, signal, update, { cwd: root });
  try { await fn({ root, save, run }); } finally { await rm(root, { recursive: true, force: true }); }
}

test("registered tool counts exact mirrored/forked calls once and independent identical executions separately", async () => fixture(async ({ save, run }) => {
  const shared = [call("c", null), result("r", "c", "c", { isError: true })];
  const parent = await save("a-session.jsonl", [header("parent"), ...shared]);
  await save("b-mirror.jsonl", [header("parent"), ...shared]);
  await save("c-fork.jsonl", [header("fork", { parentSession: parent }), ...shared, call("c2", "r"), result("r2", "c2", "c2")]);
  await save("d-independent.jsonl", [header("independent"), ...shared]);
  const report = await run();
  assert.deepEqual(report.details.totals, { toolCalls: 3, failures: 2, userMessages: 0 });
  assert.equal(report.details.corpus.logicalSessions, 3);
  assert.equal(report.details.corpus.duplicateEvents, 4);
  assert.equal(report.details.analysisStatus, "complete");
  assert.equal(report.details.total, 1, "one unreviewed typed signature across independent repeats");
  assert.equal(report.details.rows[0].indexedEvents, 2);
  assert.equal(report.details.rows[0].indexedLineages, 2);
  assert(!JSON.stringify(report).includes(parent), "source provenance paths remain private");
}));

test("strict supplied ID/name matching, no sibling-branch joins, duplicate call IDs are ambiguous", async () => fixture(async ({ save, run }) => {
  await save("session.jsonl", [header("strict"), call("c", null, "actual"), result("unknown", "c", "unknown", { isError: true }), result("wrong-name", "unknown", "actual", { toolName: "write", isError: true }), result("right", "wrong-name", "actual"), call("branch-call", "right", "branch"), result("sibling-result", "right", "branch", { isError: true }), call("a", "right", "reused"), call("b", "a", "reused"), result("ambiguous", "b", "reused")]);
  const report = await run();
  assert.equal(report.details.totals.toolCalls, 4);
  assert.equal(report.details.totals.failures, 3, "unmatched native failures remain counted, not consumed by a wrong call");
  assert.equal(report.details.extraction.unresolvedResults, 4);
  assert.equal(report.details.extraction.unresolvedCalls, 3);
  assert.equal(report.details.analysisStatus, "incomplete");
  assert.equal(report.details.rows.reduce((n, lead) => n + lead.indexedEvents, 0), 3, "unmatched failures are retrievable observations, not attributed incidents");
}));

test("legal string/image user messages and terminal assistant error/abort states", async () => fixture(async ({ save, run }) => {
  await save("session.jsonl", [header("roles"), message("u", null, { role: "user", content: "Synthetic first request" }), message("u2", "u", { role: "user", content: "Do not change the package" }), message("image", "u2", { role: "user", content: [{ type: "image", data: "synthetic", mimeType: "image/png" }] }), message("e", "image", { role: "assistant", content: [], stopReason: "error", errorMessage: "Synthetic provider error" }), message("a", "e", { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Synthetic abort" })]);
  const report = await run();
  assert.equal(report.details.totals.userMessages, 3);
  assert.equal(report.details.extraction.assistantErrors, 1);
  assert.equal(report.details.extraction.assistantAborts, 1);
  assert.equal(report.details.totals.failures, 0, "assistant terminals are separate from tool failure totals");
  assert.equal(report.details.analysisStatus, "complete");
  assert(!JSON.stringify(report).includes("Synthetic provider error"));
}));

test("typed transport/package outcomes stay separate from error vocabulary and unsupported details", async () => fixture(async ({ save, run }) => {
  const records = [header("outcomes")];
  let parent = null;
  const add = (id, name, extra) => { records.push(call(id, parent, id, name), result(`${id}-r`, id, id, { toolName: name, ...extra })); parent = `${id}-r`; };
  add("read-success", "read", { content: [{ type: "text", text: "ENOENT: error reading; Command exited with code 1; Traceback (most recent call last)" }] });
  add("native-error", "read", { isError: true });
  add("semantic-error", "unity_eval", { details: { rawResult: { ok: false, error: { category: "timeout", message: "Effects unknown" } } } });
  add("semantic-success", "codecks_card_get", { details: { rawResult: { ok: true } }, content: [{ type: "text", text: "API error documentation" }] });
  add("direct-unknown", "custom_action", { details: { ok: false } });
  add("version-unknown", "unity_eval", { details: { rawResult: { schemaVersion: 999, ok: false } } });
  add("text-unknown", "read", { isError: undefined, content: [{ type: "text", text: "ENOENT" }] });
  add("transport-overrides", "plastic_action", { isError: true, details: { rawResult: { ok: true } } });
  await save("session.jsonl", records);
  const report = await run();
  assert.equal(report.details.totals.failures, 3);
  assert.equal(report.details.extraction.heuristicLeads, 1);
  assert.equal(report.details.extraction.unknownOutcomes, 3);
  assert.deepEqual(report.details.extraction.nativeOutcomes, { success: 5, failure: 2, unknown: 1 });
  assert.deepEqual(report.details.extraction.semanticOutcomes, { "not-applicable": 3, failure: 1, success: 2, unknown: 2 });
  assert.equal(report.details.analysisStatus, "incomplete");
  assert(report.content[0].text.includes("Timeout/abort state does not establish whether effects occurred"));
}));

test("event-time context may join across window edges but cannot enter totals or incidents", async () => fixture(async ({ save, run }) => {
  const left = Date.parse("2026-01-02T00:00:00Z");
  const right = Date.parse("2026-01-02T23:59:59.999Z");
  await save("session.jsonl", [header("edges"), call("before", null, "before", "read", left - 1), result("inside", "before", "before", { isError: true }, left), call("end", "inside", "end", "read", right), result("after", "end", "end", { isError: true }, right + 1)]);
  const report = await run();
  assert.deepEqual(report.details.totals, { toolCalls: 1, failures: 1, userMessages: 0 });
  assert.equal(report.details.corpus.selectedEvents, 2);
  assert.equal(report.details.corpus.excludedEvents, 2);
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.extraction.unresolvedResults, 0);
  assert.equal(report.details.total, 1, "in-window failed result remains a retrievable observation with marked context");
  assert.equal(report.details.latency, undefined, "execution latency is not inferred");
  assert.equal(report.details.analysisStatus, "complete");
}));

test("unknown message formats/time, malformed content and unsupported transcripts cannot report complete", async () => fixture(async ({ save, run }) => {
  await save("session.jsonl", [header("unknowns"), message("u", null, { role: "user", content: "Unknown time" }, "unknown"), message("custom", "u", { role: "custom", content: "Not interpreted" }), message("bad", "custom", { role: "user", content: 123 })]);
  await save("transcript.jsonl", [{ role: "assistant", content: [], stopReason: "error" }]);
  const report = await run();
  assert.equal(report.details.corpus.unknownTimestamps, 1);
  assert.equal(report.details.corpus.unsupportedFiles, 1);
  assert.equal(report.details.corpus.logicalSessions, 1, "unsupported source is not a logical session");
  assert.equal(report.details.extraction.unsupportedMessages, 2);
  assert.equal(report.details.analysisStatus, "incomplete");
  assert(!report.content[0].text.includes("Analysis status: complete"));
}));

test("both native branches are counted in an unreviewed signature, not a causal episode", async () => fixture(async ({ save, run }) => {
  await save("session.jsonl", [header("branches"), message("u", null, { role: "user", content: "Synthetic request" }), call("a", "u"), result("ar", "a", "a", { isError: true }), call("b", "u"), result("br", "b", "b", { isError: true })]);
  const report = await run();
  assert.deepEqual(report.details.totals, { toolCalls: 2, failures: 2, userMessages: 1 });
  assert.equal(report.details.total, 1);
  assert.equal(report.details.rows[0].indexedEvents, 2);
  assert.equal(report.details.rows[0].judgment, "unreviewed");
  assert.equal(report.details.analysisStatus, "complete");
}));

test("legacy missing IDs only join uniquely and remain disclosed as incomplete", async () => fixture(async ({ save, run }) => {
  const legacyCall = call("c", null); delete legacyCall.message.content[0].id;
  const legacyResult = result("r", "c", "c"); delete legacyResult.message.toolCallId;
  await save("session.jsonl", [header("legacy"), legacyCall, legacyResult]);
  const report = await run();
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.extraction.unresolvedResults, 0);
  assert.equal(report.details.extraction.legacyCorrelations, 2);
  assert.equal(report.details.analysisStatus, "incomplete");
}));

test("supplied null IDs never fall back and repeated executions are not consumed by call ID alone", async () => fixture(async ({ save, run }) => {
  await save("session.jsonl", [header("null-id"), call("a", null, "repeated"), result("null", "a", null), result("ar", "null", "repeated", { isError: true }), call("b", "ar", "repeated", "read", start + 5000), result("br", "b", "repeated", { isError: true }, start + 5100)]);
  const report = await run();
  assert.equal(report.details.extraction.unresolvedResults, 1);
  assert.equal(report.details.extraction.unresolvedCalls, 0);
  assert.equal(report.details.totals.toolCalls, 2);
  assert.equal(report.details.totals.failures, 2);
  assert.equal(report.details.rows[0].indexedEvents, 2);
}));

test("retired display/correction knobs do not alter event accounting or invent corrections", async () => fixture(async ({ save, run }) => {
  await save("session.jsonl", [header("limits"), ...Array.from({ length: 5 }, (_, i) => message(`u${i}`, i ? `u${i-1}` : null, { role: "user", content: "Do not change the package" }))]);
  const full = await run({ limitCorrections: 100 });
  const hidden = await run({ limitCorrections: 0, limitSessions: 0, limitFailures: 0 });
  assert.deepEqual(full.details.totals, hidden.details.totals);
  assert.equal(hidden.details.total, 0, "user-role requests do not establish corrections");
  assert.equal(full.details.evidenceCoverage.observedEvents, hidden.details.evidenceCoverage.observedEvents);
}));

test("removing incident inference preserves totals without its former cap; metadata is opaque and bounded", async () => fixture(async ({ save, run }) => {
  const records = [header("inference-cap")];
  for (let i = 0; i < 1001; i++) records.push(call(`c${i}`, i ? `r${i-1}` : null), result(`r${i}`, `c${i}`, `c${i}`));
  const file = await save("session.jsonl", records);
  const report = await run({ session: file });
  assert.equal(report.details.totals.toolCalls, 1001);
  assert.equal(report.details.evidenceCoverage.omittedEvents, 0);
  assert.equal(report.details.analysisStatus, "complete");
  const name = "synthetic_tool_" + "x".repeat(60000);
  const large = await save("large.jsonl", [header("output-cap"), call("c", null, "c", name), result("r", "c", "c", { toolName: name })]);
  const bounded = await run({ session: large, reportMode: "full" });
  assert(!JSON.stringify(bounded).includes(name));
  assert(Buffer.byteLength(JSON.stringify(bounded)) <= 8192);
  assert.equal(bounded.details.totals.toolCalls, 1);
}));

test("registered scan honours pre-abort, streamed abort and changed-source diagnostics", async () => fixture(async ({ save, run }) => {
  const file = await save("session.jsonl", [header("cancel"), ...Array.from({ length: 1000 }, (_, i) => message(`u${i}`, i ? `u${i-1}` : null, { role: "user", content: "Synthetic ".repeat(100) }))]);
  const pre = new AbortController(); pre.abort();
  const cancelled = await run({}, pre.signal);
  assert.equal(cancelled.details.corpus.bytesRead, 0);
  assert.equal(cancelled.details.corpus.stopReason, "cancelled");
  assert.equal(cancelled.details.analysisStatus, "incomplete");
  const mid = new AbortController();
  const partial = await run({}, mid.signal, () => mid.abort());
  assert.equal(partial.details.corpus.stopReason, "cancelled");
  assert(partial.details.corpus.bytesRead <= 65536);
  let mutation;
  const changed = await run({}, undefined, () => { mutation ??= appendFile(file, "\n"); });
  await mutation;
  assert.equal(changed.details.corpus.changedFiles, 1);
  assert.equal(changed.details.analysisStatus, "incomplete");
}));
