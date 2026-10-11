import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import register from "../dist/pi/register.js";
import { evidenceResult } from "../dist/pi/session-evidence.js";

test("actual native envelope budget preserves ten rows independently of wrapper duplication", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-session-"));
  const tools = new Map(), handlers = [];
  register({ registerTool(tool) { tools.set(tool.name, tool); }, on(event, handler) { if (event === "session_shutdown") handlers.push(handler); } });
  const ctx = { cwd: root, sessionManager: {} };
  const execute = (name, args) => tools.get(name).execute("fixture", args, undefined, undefined, ctx);
  try {
    const timestamp = Date.parse("2026-01-02T12:00:00Z");
    const records = [{ type: "session", version: 3, id: "synthetic", timestamp }];
    for (let i = 0; i < 10; i++) {
      records.push({ type: "message", id: `c${i}`, parentId: i ? `r${i-1}` : null, timestamp, message: { role: "assistant", content: [{ type: "toolCall", name: "read", id: `t${i}`, arguments: Object.fromEntries(Array.from({ length: 8 }, (_, j) => [`private-${j}`, null])) }] } });
      records.push({ type: "message", id: `r${i}`, parentId: `c${i}`, timestamp, message: { role: "toolResult", toolName: "read", toolCallId: `t${i}`, content: [], isError: true } });
    }
    await writeFile(join(root, "synthetic.jsonl"), records.map(JSON.stringify).join("\n"));
    const scan = await execute("pi_analyze_session", { session: root, since: "2026-01-02", until: "2026-01-02" });
    assert.equal(scan.structuredContent.ok, true);
    assert.equal(scan.structuredContent.contractVersion, 1);
    assert.equal(scan.structuredContent.report.schemaVersion, 2);
    const page = await execute("pi_query_session", { reportRef: scan.details.reportRef, leadRef: scan.details.rows[0].leadRef, limit: 10 });
    assert.equal(page.details.returned, 10); assert.equal(page.details.omitted, 0); assert.equal(page.details.nextCursor, null);
    assert(Buffer.byteLength(JSON.stringify(page)) > 8192, "duplicate consumers no longer shrink the native page");
    assert(Buffer.byteLength(JSON.stringify(page.structuredContent)) <= 32768);
    assert(Buffer.byteLength(page.content[0].text) <= 8192);
    assert.equal(Value.Check(tools.get("pi_query_session").outputSchema, page.structuredContent), true);
    assert(page.details.rows[0].call.fields.every(field => field.type === "null"));
    assert.throws(() => evidenceResult({ ...page.details, privateUnexpectedField: "not-admitted" }), /output_contract_error/);
    assert.throws(() => evidenceResult({ schemaVersion: 2, reportRef: scan.details.reportRef, expiresAt: scan.details.expiresAt, view: "locator", eventRef: page.details.rows[0].eventRef, target: "event", warning: "Explicit opt-in", sourceChecks: 1, evidenceCoverage: page.details.evidenceCoverage,
      locator: { path: "x".repeat(40000), line: 1, sourceRef: page.details.rows[0].provenance.sourceRef, entryRef: page.details.rows[0].provenance.entryRef, selected: true, duplicate: false } }), /evidence_response_limit/, "compact native byte ceiling is enforced before reference publication");
    const release = await execute("pi_query_session", { reportRef: scan.details.reportRef, release: true });
    assert.equal(release.structuredContent.effects, "memory_changed");
    const expired = await execute("pi_query_session", { reportRef: scan.details.reportRef });
    assert.equal(expired.isError, true); assert.equal(expired.structuredContent.ok, false);
    assert.equal(expired.structuredContent.error.code, "expired_report");
    assert.equal(expired.structuredContent.effects, "memory_may_have_changed");
    assert(Value.Check(tools.get("pi_query_session").outputSchema, expired.structuredContent));
  } finally { for (const handler of handlers) await handler({}, ctx); await rm(root, { recursive: true, force: true }); }
});
