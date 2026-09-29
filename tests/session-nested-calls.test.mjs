import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import register from "../dist/pi/register.js";

const tools = {};
register({ on() {}, registerTool(tool) { tools[tool.name] = tool; } });
const time = Date.parse("2026-01-02T12:00:00Z");
const child = (extra = {}) => ({ id: "parent/1", name: "read", arguments: { privatePath: "secret-value" }, status: "ok", durationMs: 12, ...extra });
async function fixture(nestedCalls, run) {
  const root = await mkdtemp(join(tmpdir(), "pi-nested-synthetic-"));
  const path = join(root, "session.jsonl");
  const ctx = { cwd: root };
  const records = [
    { type: "session", version: 3, id: "synthetic", timestamp: time },
    { type: "message", id: "a", parentId: null, timestamp: time, message: { role: "assistant", content: [{ type: "toolCall", id: "parent", name: "bash", arguments: {} }] } },
    { type: "message", id: "r", parentId: "a", timestamp: time + 100, message: { role: "toolResult", toolCallId: "parent", toolName: "bash", content: [], isError: false, ...(nestedCalls === undefined ? {} : { nestedCalls }) } },
  ];
  try {
    await writeFile(path, records.map(record => JSON.stringify(record)).join("\n"));
    const scan = await tools.pi_analyze_session.execute("scan", { session: path, since: "2026-01-02", until: "2026-01-02", asOf: "2026-01-03T00:00:00Z" }, undefined, undefined, ctx);
    const query = async (params = {}) => tools.pi_query_session.execute("query", { reportRef: scan.details.reportRef, ...params }, undefined, undefined, ctx);
    const rows = [];
    let cursor;
    do {
      const page = await query({ limit: 10, ...(cursor ? { cursor } : {}) });
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 8192);
      rows.push(...page.details.rows);
      cursor = page.details.nextCursor;
    } while (cursor);
    await run({ scan: scan.details, rows, query, path });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("nested success/failure are separate observations, redacted and anchored to parent", async () => {
  await fixture({ complete: true, calls: [child(), child({ id: "parent/2", name: "private-tool", status: "error", error: "secret-error", durationMs: 7 })] }, async ({ scan, rows, query }) => {
    assert.equal(scan.analysisStatus, "complete");
    assert.deepEqual(scan.totals, { toolCalls: 1, failures: 0, userMessages: 0 });
    assert.deepEqual(scan.extraction.nested, { observedCalls: 2, failures: 1, unknownOutcomes: 0, incompleteResults: 0, malformedRecords: 0, omittedCalls: 0 });
    const nested = rows.filter(row => row.kind === "nested_tool_call");
    assert.deepEqual(nested.map(row => row.nested.status), ["ok", "error"]);
    assert.equal(nested[1].nested.errorRecorded, true);
    assert.equal(nested[1].toolLabel, undefined);
    assert.equal(nested[0].nested.durationMs, 12);
    assert.equal(nested[0].nested.fields.length, 1);
    assert.equal(nested[0].call, undefined);
    assert.equal(nested[0].outcome, undefined, "no full result means no semantic classification");
    assert.equal(nested[0].messageObservedSpanMs, undefined);
    assert.equal(nested[0].provenance.line, 3);
    assert.equal(nested[0].nested.position, 0);
    assert.equal(nested[0].provenance.entryRef, rows.find(row => row.kind === "tool_result").provenance.entryRef);
    assert.equal(scan.rows[0].signature, "nested_metadata_failure");
    for (const secret of ["private-tool", "secret-value", "privatePath", "secret-error", "parent/1"]) assert.ok(!JSON.stringify({ scan, rows }).includes(secret));
    const locator = await query({ view: "locator", eventRef: nested[0].eventRef, allowLocalPathDisclosure: true });
    assert.equal(locator.details.locator.line, 3);
    assert.equal(locator.details.locator.block, undefined);
    await assert.rejects(query({ view: "locator", eventRef: nested[0].eventRef, target: "call", allowLocalPathDisclosure: true }), /locator_target_unavailable/);
  });
});

test("omitted arguments, truncated shapes and unfinished status remain visible", async () => {
  const omitted = child({ argumentsBytes: 9000 }); delete omitted.arguments;
  const unfinished = child({ status: "unfinished" }); delete unfinished.durationMs;
  await fixture({ complete: false, calls: [omitted, child({ arguments: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`secret${i}`, i])) }), unfinished] }, async ({ scan, rows }) => {
    assert.equal(scan.analysisStatus, "incomplete");
    const nested = rows.filter(row => row.nested);
    assert.equal(nested[0].nested.argumentsState, "omitted");
    assert.equal(nested[0].nested.metadataValid, true);
    assert.equal(nested[1].nested.fields.length, 8);
    assert.equal(nested[1].nested.omittedFields, 4);
    assert.equal(nested[2].nested.durationMs, null);
    assert.equal(scan.extraction.nested.unknownOutcomes, 1);
    assert.equal(scan.extraction.nested.failures, 0);
    assert.equal(rows.find(row => row.nestedCoverage).nestedCoverage.complete, false);
  });
});

test("complete=false does not invent dropped call counts or failures", async () => {
  await fixture({ complete: false, calls: [] }, async ({ scan, rows }) => {
    assert.equal(scan.analysisStatus, "incomplete");
    assert.equal(scan.extraction.nested.observedCalls, 0);
    assert.equal(scan.extraction.nested.omittedCalls, 0);
    assert.equal(scan.extraction.nested.incompleteResults, 1);
    assert.equal(rows.find(row => row.nestedCoverage).nestedCoverage.recordedCalls, 0);
  });
});

test("malformed envelopes and child records are incomplete, not fabricated failures", async () => {
  for (const value of [null, [], "secret", {}, { complete: "yes", calls: "secret" }, { complete: true, calls: [null, {}, child({ status: "future", durationMs: -1, arguments: "secret", error: 17 })] }]) {
    await fixture(value, async ({ scan, rows }) => {
      assert.equal(scan.analysisStatus, "incomplete");
      assert.equal(scan.extraction.nested.failures, 0);
      const parent = rows.find(row => row.nestedCoverage);
      assert.equal(parent.nestedCoverage.incomplete, true);
      for (const row of rows.filter(row => row.nested)) {
        assert.equal(row.nested.metadataValid, false);
        assert.equal(row.nested.status, "unknown");
        assert.equal(row.nested.durationMs, null);
      }
    });
  }
});

test("partial metadata retains only recorded status and duration without filling gaps", async () => {
  const missing = child(); delete missing.arguments; delete missing.durationMs; delete missing.id;
  await fixture({ complete: true, calls: [missing, child({ durationMs: "12", argumentsBytes: 5 }), child({ durationMs: 0, arguments: {} })] }, async ({ scan, rows }) => {
    assert.equal(scan.analysisStatus, "incomplete");
    const nested = rows.filter(row => row.nested);
    assert.equal(nested[0].nested.status, "ok");
    assert.equal(nested[0].nested.argumentsState, "unknown");
    assert.equal(nested[0].nested.durationMs, null);
    assert.equal(nested[0].nested.metadataValid, false);
    assert.equal(nested[1].nested.durationMs, null);
    assert.equal(nested[1].nested.metadataValid, false);
    assert.equal(nested[2].nested.durationMs, 0);
    assert.equal(nested[2].nested.metadataValid, true);
    assert.equal(scan.extraction.nested.malformedRecords, 2);
    assert.equal(scan.extraction.nested.failures, 0);
  });
});

test("consumer count bound is disclosed and every page stays bounded", async () => {
  await fixture({ complete: true, calls: Array.from({ length: 260 }, (_, i) => child({ id: `parent/${i}` })) }, async ({ scan, rows }) => {
    assert.equal(scan.analysisStatus, "incomplete");
    assert.equal(scan.scanLimits.maxNestedCallsPerResult, 256);
    assert.equal(scan.extraction.nested.observedCalls, 256);
    assert.equal(scan.extraction.nested.omittedCalls, 4);
    assert.equal(rows.filter(row => row.nested).length, 256);
    assert.equal(scan.totals.toolCalls, 1);
  });
});

test("nested queries retain source freshness enforcement", async () => {
  await fixture({ complete: true, calls: [child()] }, async ({ rows, query, path }) => {
    const row = rows.find(row => row.nested);
    await appendFile(path, "\n");
    await assert.rejects(query({ eventRef: row.eventRef }), /stale_source/);
  });
});

test("top-level sessions without nested metadata retain their contract", async () => {
  await fixture(undefined, async ({ scan, rows }) => {
    assert.equal(scan.analysisStatus, "complete");
    assert.deepEqual(scan.totals, { toolCalls: 1, failures: 0, userMessages: 0 });
    assert.deepEqual(rows.map(row => row.kind), ["tool_call", "tool_result"]);
    assert.equal(rows[1].nestedCoverage, undefined);
    assert.equal(rows[1].join, "native_id_ancestry");
    assert.equal(rows[1].messageObservedSpanMs, 100);
  });
});
