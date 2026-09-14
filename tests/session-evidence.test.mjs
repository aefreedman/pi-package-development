import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, appendFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Value } from "typebox/value";
import register from "../dist/pi/register.js";
import { EVIDENCE_LIMITS, evidenceResult } from "../dist/pi/session-evidence.js";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
const time = Date.parse("2026-01-02T12:00:00Z");
const bounds = { since: "2026-01-02", until: "2026-01-02", asOf: "2026-01-03T00:00:00Z" };
const canary = "SYNTHETIC_PRIVATE_CANARY";
const header = (id, extra = {}) => ({ type: "session", version: 3, id, timestamp: time, ...extra });
const msg = (id, parentId, message, timestamp = time) => ({ type: "message", id, parentId, timestamp, message });
function pair(id, parent, name = canary, isError = true, args = { [canary]: canary }, extra = {}) {
  return [msg(`c${id}`, parent, { role: "assistant", content: [{ type: "text", text: canary }, { type: "toolCall", id, name, arguments: args }] }),
    msg(`r${id}`, `c${id}`, { role: "toolResult", toolCallId: id, toolName: name, isError, content: [{ type: "text", text: canary }], details: { category: canary, [canary]: canary }, ...extra }, time + 50)];
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pi-evidence-synthetic-"));
  const tools = new Map(), handlers = new Map();
  register({ registerTool(tool) { tools.set(tool.name, tool); }, on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); } });
  const ctx = { cwd: root, sessionManager: {} };
  const execute = (name, params, context = ctx, signal) => {
    const tool = tools.get(name); const prepared = tool.prepareArguments ? tool.prepareArguments(params) : params;
    assert(Value.Check(tool.parameters, prepared), "public tool schema accepts the contract input");
    return tool.execute("synthetic-contract", prepared, signal, undefined, context);
  };
  const scan = (params = {}, context = ctx, signal) => execute("pi_analyze_session", { session: root, ...bounds, ...params }, context, signal);
  const query = (report, params = {}, context = ctx, signal) => execute("pi_query_session", { reportRef: report.details.reportRef, ...params }, context, signal);
  const save = async (name, rows) => { const path = join(root, name); await writeFile(path, rows.map(row => typeof row === "string" ? row : JSON.stringify(row)).join("\n")); return path; };
  const safe = (result) => { assert(Buffer.byteLength(JSON.stringify(result)) <= 8192); assert(!JSON.stringify(result).includes(canary)); assert(!JSON.stringify(result).includes(root)); assert.deepEqual(JSON.parse(result.content[0].text), result.details); };
  try { await fn({ root, ctx, tools, handlers, scan, query, save, safe }); } finally { for (const fn of handlers.get("session_shutdown") ?? []) await fn({}, ctx); await rm(root, { recursive: true, force: true }); }
}

test("aggregate triage identifies a public operation and one opted-in locator feeds the real read tool without discovery", async (t) => fixture(async ({ root, ctx, save, scan, query, safe }) => {
  const rows = [header(canary), "", msg("u", null, { role: "user", content: canary }), ...pair("1", "u", "read")];
  const expected = await save("LOCAL_PATH_CANARY.jsonl", rows);
  await save("other.jsonl", [header("other"), ...pair("2", null, "write")]);
  await save("unknown.jsonl", [header("unknown"), ...pair("3", null, `read_${canary}`)]);
  const report = await scan({ session: "all", projectFolder: root, limitLeads: 10 }); safe(report);
  assert.equal(report.details.corpus.processedFiles, 3);
  assert.deepEqual(report.details.rows.map(lead => lead.toolLabel).filter(Boolean).sort(), ["read", "write"]);
  assert.equal(report.details.rows.filter(lead => !lead.toolLabel).length, 1, "private prefix lookalike remains opaque");
  const lead = report.details.rows.find(lead => lead.toolLabel === "read");
  const started = performance.now();
  const local = await query(report, { view: "locator", eventRef: lead.eventRef, allowLocalPathDisclosure: true });
  const queryMs = performance.now() - started;
  assert.equal(local.details.locator.path, expected); assert.equal(local.details.locator.line, 5);
  assert.equal(local.details.sourceChecks, 1); assert.equal(local.details.locator.block, undefined);
  assert(!JSON.stringify(local).includes(canary), "opt-in path does not reveal native IDs, args, output or user text");
  assert(Buffer.byteLength(JSON.stringify(local)) <= 8192);
  const nativeRead = createReadToolDefinition(ctx.cwd);
  const read = await nativeRead.execute("read-exact-source", { path: local.details.locator.path, offset: local.details.locator.line, limit: 1 }, undefined, undefined, ctx);
  assert.equal(read.content[0].text.split("\n")[0], JSON.stringify(rows[4]), "real read receives exact source line without search or corpus JSON parsing");
  const packet = (await query(report, { eventRef: lead.eventRef })).details.rows[0];
  assert.equal(packet.toolLabel, "read"); assert.equal(packet.call.toolLabel, "read");
  const call = await query(report, { view: "locator", eventRef: lead.eventRef, target: "call", allowLocalPathDisclosure: true });
  assert.equal(call.details.locator.path, expected); assert.equal(call.details.locator.line, 4); assert.equal(call.details.locator.block, 1);
  const toolPage = await query(report, { toolRef: lead.toolRef });
  const callEvent = toolPage.details.rows.find(row => row.kind === "tool_call");
  const ownCall = await query(report, { view: "locator", eventRef: callEvent.eventRef, allowLocalPathDisclosure: true });
  assert.equal(ownCall.details.locator.line, 4); assert.equal(ownCall.details.locator.block, 1);
  const context = await query(report, { view: "locator", eventRef: lead.eventRef, target: "context", contextIndex: 1, allowLocalPathDisclosure: true });
  assert.equal(context.details.locator.line, 3); assert.equal(context.details.locator.entryRef, packet.context[1].provenance.entryRef);
  assert.equal(context.details.locator.block, undefined, "context addresses the whole record, not a guessed call");
  const defaultAgain = await query(report, { eventRef: lead.eventRef }); safe(defaultAgain);
  t.diagnostic(JSON.stringify({ locatorQueriesToSource: 1, sourceStatChecks: local.details.sourceChecks, locatorBytes: Buffer.byteLength(JSON.stringify(local)), locatorMs: +queryMs.toFixed(2), subsequentNativeReadCalls: 1, requestedReadLines: 1 }));
}));

test("public labels require whole-string literals, not prefixes, casing, injected text or runtime fields", async () => fixture(async ({ save, scan, query, safe }) => {
  const names = ["codecks_card_get", `codecks_${canary}`, `read${canary}`, "READ", "read\n", "constructor", "toString"];
  const rows = [header("literal-labels")];
  for (const [i, name] of names.entries()) rows.push(...pair(String(i), i ? `r${i-1}` : null, name, true, {}, { toolLabel: "read", details: { toolName: "read", label: "read" } }));
  await save("session.jsonl", rows);
  const report = await scan({ limitLeads: 10 }); safe(report);
  const leads = [...report.details.rows]; let cursor = report.details.nextCursor;
  while (cursor) { const page = await query(report, { view: "leads", cursor }); safe(page); leads.push(...page.details.rows); cursor = page.details.nextCursor; }
  assert.deepEqual(leads.filter(lead => lead.toolLabel).map(lead => lead.toolLabel), ["codecks_card_get"]);
  assert.equal(leads.length, names.length);
}));

test("locator selectors require exact opt-in/event/retained target and reject path widening and malformed selectors", async () => fixture(async ({ save, scan, query, ctx, tools }) => {
  await save("session.jsonl", [header("locator-selectors"), ...pair("1", null, "read")]);
  const report = await scan(); const eventRef = report.details.rows[0].eventRef;
  const base = { reportRef: report.details.reportRef, view: "locator", eventRef, allowLocalPathDisclosure: true };
  const invalid = [{ allowLocalPathDisclosure: false }, { allowLocalPathDisclosure: undefined }, { allowLocalPathDisclosure: "true" }, { eventRef: undefined }, { eventRef: null }, { target: "source" }, { target: null }, { target: "context" }, { target: "context", contextIndex: -1 }, { target: "context", contextIndex: 2 }, { target: "context", contextIndex: 0.5 }, { target: "event", contextIndex: 0 }, { target: "call", contextIndex: 0 }, { path: canary }, { sourceRef: "s_other" }, { line: 1 }, { block: 0 }, { cursor: "0" }, { limit: 1 }, { leadRef: report.details.rows[0].leadRef }, { toolRef: "t_other" }, { release: true }];
  for (const extra of invalid) await assert.rejects(tools.get("pi_query_session").execute("bad-locator", { ...base, ...extra }, undefined, undefined, ctx), error => error.message === "invalid_locator_selector");
  assert(!Value.Check(tools.get("pi_query_session").parameters, { ...base, path: canary }), "schema also forbids arbitrary path input");
  await assert.rejects(query(report, { eventRef, allowLocalPathDisclosure: true }), /invalid_locator_selector/);
  await assert.rejects(query(report, { view: "locator", eventRef, target: "context", contextIndex: 1, allowLocalPathDisclosure: true }), /locator_target_unavailable/);
  const packet = (await query(report, { eventRef })).details.rows[0];
  await assert.rejects(query(report, { view: "locator", eventRef: packet.provenance.entryRef, allowLocalPathDisclosure: true }), /invalid_event_or_tool_ref/);
  await save("unmatched.jsonl", [header("unmatched"), msg("r", null, { role: "toolResult", toolName: "read", toolCallId: "missing", isError: true, content: [] })]);
  const unmatched = await scan({ session: "./unmatched.jsonl" });
  await assert.rejects(query(unmatched, { view: "locator", eventRef: unmatched.details.rows[0].eventRef, target: "call", allowLocalPathDisclosure: true }), /locator_target_unavailable/);
}));

test("opted-in locators preserve stale, expired, cross-scope and output-bound protections", async () => fixture(async ({ save, scan, query, ctx }) => {
  const rows = [header("locator-guards"), ...pair("1", null, "read")]; const file = await save("session.jsonl", rows);
  let report = await scan();
  const args = (report, extra = {}) => ({ view: "locator", eventRef: report.details.rows[0].eventRef, allowLocalPathDisclosure: true, ...extra });
  await assert.rejects(query(report, args(report), { ...ctx, sessionManager: {} }), /invalid_report_scope/);
  const other = await scan(); await assert.rejects(query(other, args(report)), /invalid_event_or_tool_ref/);
  for (const target of ["event", "call", "context"]) {
    report = await scan(); await appendFile(file, "\n");
    await assert.rejects(query(report, args(report, { target, ...(target === "context" ? { contextIndex: 0 } : {}) })), /stale_source/);
  }
  report = await scan(); const realNow = Date.now;
  try { Date.now = () => report.details.expiresAt; await assert.rejects(query(report, args(report)), /expired_report/); } finally { Date.now = realNow; }
  report = await scan(); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(query(report, args(report), ctx, aborted.signal), /evidence_query_cancelled/);
  const locator = await query(report, args(report)); assert(Buffer.byteLength(JSON.stringify(locator)) <= 8192);
  // The same serialization gate rejects an oversized local path instead of truncating an exact locator.
  assert.throws(() => evidenceResult({ ...locator.details, locator: { ...locator.details.locator, path: canary.repeat(500) } }), error => error.message === "evidence_response_limit");
}));

test("registered scan→query discovers arbitrary tools; every lead resolves, with exact private-safe call/result/ancestry provenance", async () => fixture(async ({ save, scan, query, safe }) => {
  const rows = [header(canary), "", msg("u", null, { role: "user", content: canary }), ...pair("1", "u"), ...pair("2", "r1", "another_unregistered_owner", true)];
  await save(`${canary}.jsonl`, rows);
  const report = await scan(); safe(report);
  assert.equal(report.details.total, 2);
  for (const lead of report.details.rows) {
    assert.equal(lead.judgment, "unreviewed");
    const page = await query(report, { leadRef: lead.leadRef }); safe(page);
    const packet = page.details.rows[0];
    assert.equal(packet.eventRef, lead.eventRef); assert.equal(packet.join, "native_id_ancestry");
    assert.equal(packet.call.block, 1, "original native content position, not filtered position");
    assert.equal(packet.call.locator.line + 1, packet.provenance.line);
    assert.equal(packet.messageObservedSpanMs, 50);
    assert.equal(packet.context[0].role, "assistant");
    assert.equal(packet.context[0].provenance.entryRef, packet.call.locator.entryRef);
    const again = await query(report, { eventRef: packet.eventRef });
    assert.deepEqual(again.details.rows, page.details.rows);
  }
  const first = await query(report, { leadRef: report.details.rows[0].leadRef });
  assert.equal(first.details.rows[0].call.locator.line, 4, "physical blank line is preserved in provenance");
  assert.equal(first.details.rows[0].context[1].provenance.line, 3);
}));

test("lead/event/tool pages have stable refs, totals independent of limits, and no duplication", async () => fixture(async ({ save, scan, query, safe }) => {
  const rows = [header("paging")];
  for (let i = 0; i < 17; i++) rows.push(...pair(String(i), i ? `r${i-1}` : null, `unknown_${i % 7}`));
  await save("session.jsonl", rows);
  const report = await scan({ limitLeads: 1 }); safe(report);
  const allLeads = [...report.details.rows]; let cursor = report.details.nextCursor;
  while (cursor) { const page = await query(report, { view: "leads", cursor, limit: 2 }); safe(page); allLeads.push(...page.details.rows); cursor = page.details.nextCursor; }
  assert.equal(allLeads.length, 7); assert.equal(new Set(allLeads.map(l => l.leadRef)).size, 7);
  for (const selector of [{}, { leadRef: allLeads[0].leadRef }, { toolRef: allLeads[0].toolRef }]) {
    const seen = []; let page;
    do { page = await query(report, { ...selector, ...(page?.details.nextCursor ? { cursor: page.details.nextCursor } : {}), limit: 10 }); safe(page); seen.push(...page.details.rows.map(r => r.eventRef)); } while (page.details.nextCursor);
    assert.equal(seen.length, page.details.total); assert.equal(new Set(seen).size, seen.length);
  }
  const control = await scan({ limitLeads: 10 });
  assert.deepEqual(report.details.totals, control.details.totals); assert.equal(report.details.total, control.details.total);
  await assert.rejects(query(report, { leadRef: allLeads[0].leadRef, cursor: report.details.nextCursor }), /invalid_cursor/);
}));

test("metadata/argument canaries are omitted and both output copies fit the ceiling", async () => fixture(async ({ save, scan, query, safe }) => {
  const huge = canary.repeat(3000); const args = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`${canary}${i}`, { [canary]: huge }]));
  // Keep fixture within the parser's documented line ceiling while stressing keys and values.
  for (const key of Object.keys(args)) args[key] = canary;
  await save(`${canary}.jsonl`, [header(huge), ...pair("1", null, huge, true, args, { content: [{ type: "text", text: huge }], details: { rawResult: { ok: false, error: { category: huge, message: huge } } } })]);
  const report = await scan({ limitLeads: 10, focus: huge, knownFixed: huge, approvedSourceRoots: [huge] }); safe(report);
  const page = await query(report, { leadRef: report.details.rows[0].leadRef, limit: 10 }); safe(page);
  assert.equal(page.details.rows[0].call.fields.length, 8); assert.equal(page.details.rows[0].call.omittedFields, 492);
  assert(page.details.rows[0].call.fields.every(f => /^f_[a-f0-9]{24}$/.test(f.fieldRef) && f.type === "string"));
  await assert.rejects(query(report, { eventRef: huge }), error => error.message === "invalid_event_or_tool_ref");
}));

test("stale, replaced, missing, invalid, expired, released and cross-scope refs fail closed", async () => fixture(async ({ save, scan, query, ctx }) => {
  const rows = [header("lifetime"), ...pair("1", null)]; const file = await save("session.jsonl", rows);
  let report = await scan(); const lead = report.details.rows[0];
  await assert.rejects(query(report, { leadRef: lead.leadRef }, { ...ctx, sessionManager: {} }), /invalid_report_scope/);
  await assert.rejects(query(report, { reportRef: "r_invalid" }), /invalid_report/);
  await assert.rejects(query(report, { leadRef: "l_invalid" }), /invalid_lead_ref/);
  await assert.rejects(query(report, { eventRef: lead.eventRef, leadRef: lead.leadRef }), /invalid_evidence_selector/);
  await appendFile(file, "\n"); await assert.rejects(query(report, { leadRef: lead.leadRef }), /stale_source/);
  report = await scan(); const before = await stat(file);
  await writeFile(file, (rows.map(JSON.stringify).join("\n") + "\n").replace("lifetime", "sameSize"));
  await utimes(file, before.atime, before.mtime);
  await assert.rejects(query(report, { leadRef: report.details.rows[0].leadRef }), /stale_source/, "ctime catches same-size writes even if mtime is restored");
  report = await scan(); await rm(file); await assert.rejects(query(report, { leadRef: report.details.rows[0].leadRef }), /stale_source/);
  await save("session.jsonl", rows); report = await scan();
  const realNow = Date.now;
  try { Date.now = () => report.details.expiresAt; await assert.rejects(query(report), /expired_report/); } finally { Date.now = realNow; }
  report = await scan(); await query(report, { release: true }); await assert.rejects(query(report), /expired_report/);
  report = await scan(); const other = await scan();
  await assert.rejects(query(other, { leadRef: report.details.rows[0].leadRef }), /invalid_lead_ref/);
  await assert.rejects(query(other, { eventRef: report.details.rows[0].eventRef }), /invalid_event_or_tool_ref/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(query(other, {}, ctx, abort.signal), /evidence_query_cancelled/);
}));

test("idle lifetime timer removes the index without needing a later wall-clock prune", async (t) => fixture(async ({ save, scan, query }) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await save("session.jsonl", [header("idle-expiry"), ...pair("1", null)]);
  const report = await scan();
  t.mock.timers.tick(EVIDENCE_LIMITS.lifetimeMs);
  assert(Date.now() < report.details.expiresAt, "real clock has not reached the prune boundary");
  await assert.rejects(query(report), /expired_report/);
}));

test("bounded storage evicts oldest reports and shutdown only clears its own scope", async () => fixture(async ({ save, scan, query, ctx, handlers }) => {
  await save("session.jsonl", [header("bounded"), ...pair("1", null)]);
  const oldest = await scan();
  for (let i = 0; i < EVIDENCE_LIMITS.reports; i++) await scan();
  await assert.rejects(query(oldest), /expired_report/);
  const active = await scan(); const otherCtx = { ...ctx, sessionManager: {} }; const other = await scan({}, otherCtx);
  for (const fn of handlers.get("session_shutdown")) await fn({}, ctx);
  await assert.rejects(query(active), /expired_report/);
  assert.equal((await query(other, {}, otherCtx)).details.total, 2);
  await query(other, { release: true }, otherCtx);
}));

test("shutdown during scan invalidates the in-flight index rather than reviving private state", async () => fixture(async ({ save, tools, handlers, ctx }) => {
  const rows = [header("shutdown-race")];
  for (let i = 0; i < 100; i++) rows.push(...pair(String(i), i ? `r${i-1}` : null));
  const file = await save("session.jsonl", rows);
  let cleanup;
  await assert.rejects(tools.get("pi_analyze_session").execute("race", { session: file, ...bounds }, undefined, () => {
    cleanup ??= Promise.all(handlers.get("session_shutdown").map(fn => fn({}, ctx)));
  }, ctx), /expired_report/);
  await cleanup;
}));

test("native/package success, ordinary reads/reviews, overlapping different targets and assignment sequences never become diagnoses", async () => fixture(async ({ save, scan, query }) => {
  const records = [header("negative"), msg("u", null, { role: "user", content: "Can you review this code?" }), ...pair("read", "u", "read", false, {}, { details: {}, content: [{ type: "text", text: "ENOENT API error validation failed" }] }), ...pair("failure", "rread", "unknown_tool", true, { target: "A" }), ...pair("success", "rfailure", "unknown_tool", false, { target: "B" }), msg("review", "rsuccess", { role: "user", content: "Can you review this code instead?" })];
  let parent = "review";
  for (const [i, name] of ["codecks_card_bulk_create", "codecks_card_bulk_create", "codecks_card_update"].entries()) { records.push(...pair(`assignment${i}`, parent, name, false, { dryRun: i === 0, assignee: "synthetic" }, { details: { rawResult: { ok: true } } })); parent = `rassignment${i}`; }
  await save("session.jsonl", records);
  const report = await scan(); assert.equal(report.details.totals.failures, 1); assert.equal(report.details.total, 1);
  const packet = (await query(report, { leadRef: report.details.rows[0].leadRef })).details.rows[0];
  assert.equal(packet.outcome.failed, true);
  assert(!/recovery|fixed|defect|correction|concurrency/.test(JSON.stringify(report.details.rows)));
  const success = await query(report, { toolRef: packet.toolRef });
  assert.equal(success.details.total, 4, "counterexample calls/results remain accessible by opaque tool ref");
  const fields = [...success.details.rows]; let cursor = success.details.nextCursor;
  while (cursor) { const page = await query(report, { toolRef: packet.toolRef, cursor }); fields.push(...page.details.rows); cursor = page.details.nextCursor; }
  assert.equal(new Set(fields.map(row => row.call.fields[0].fieldRef)).size, 1, "the same private key has one report/tool-local field ref");
}));

test("cross-window/fork/mirror provenance preserves native identity and strict unresolved joins", async () => fixture(async ({ save, scan, query }) => {
  const left = Date.parse("2026-01-02T00:00:00Z");
  const shared = pair("1", null); shared[0].timestamp = left - 1; shared[1].timestamp = left;
  const parent = await save("a.jsonl", [header("parent"), ...shared]);
  const mirror = await save("b.jsonl", [header("parent"), ...shared]);
  const fork = await save("c.jsonl", [header("fork", { parentSession: parent }), ...shared, ...pair("2", "r1")]);
  const independent = await save("d.jsonl", [header("independent"), ...shared]);
  // Force a reversed read schedule: copied history still belongs to the canonical source, not the newest fork.
  await utimes(parent, new Date(1), new Date(1)); await utimes(mirror, new Date(2), new Date(2));
  await utimes(fork, new Date(4), new Date(4)); await utimes(independent, new Date(3), new Date(3));
  const report = await scan(); assert.equal(report.details.totals.failures, 3); assert.equal(report.details.rows[0].indexedLineages, 2);
  let page = await query(report, { leadRef: report.details.rows[0].leadRef, limit: 10 }); const events = [...page.details.rows];
  while (page.details.nextCursor) { page = await query(report, { leadRef: report.details.rows[0].leadRef, cursor: page.details.nextCursor, limit: 10 }); events.push(...page.details.rows); }
  assert.equal(events.filter(e => !e.call.locator.selected).length, 2);
  assert.equal(new Set(events.map(e => e.provenance.sessionRef)).size, 3);
  assert.equal(new Set(events.map(e => e.provenance.sourceRef)).size, 3);
  assert(events.every(e => e.join === "native_id_ancestry" && e.provenance.selected));
}));

test("deterministic retrieval work/bytes on frozen synthetic sizes; index bounds never change totals", async (t) => fixture(async ({ save, scan, query, safe }) => {
  for (const count of [10, 100, 1000]) {
    const rows = [header("measurement")]; for (let i = 0; i < count; i++) rows.push(...pair(String(i), i ? `r${i-1}` : null));
    const file = await save("measurement.jsonl", rows);
    const scanStart = performance.now(); const report = await scan({ session: file }); const scanMs = performance.now() - scanStart;
    const queryStart = performance.now(); const page = await query(report, { leadRef: report.details.rows[0].leadRef, limit: 1 }); const queryMs = performance.now() - queryStart;
    safe(report); safe(page); assert.equal(page.details.sourceChecks, 1); assert.equal(page.details.rows.length, 1);
    assert.equal(report.details.totals.failures, count); assert(report.details.evidenceCoverage.accountedIndexBytes <= EVIDENCE_LIMITS.indexBytes);
    t.diagnostic(JSON.stringify({ case: count, sourceBytes: (await stat(file)).size, scanMs: +scanMs.toFixed(2), queryMs: +queryMs.toFixed(2), scanBytes: Buffer.byteLength(JSON.stringify(report)), queryBytes: Buffer.byteLength(JSON.stringify(page)), querySourceStatChecks: page.details.sourceChecks, queryContentBytesRead: 0, indexedEvents: report.details.evidenceCoverage.indexedEvents }));
  }
  const rows = [header("index-limit")]; for (let i = 0; i < 3500; i++) rows.push(...pair(String(i), i ? `r${i-1}` : null));
  const file = await save("limit.jsonl", rows); const report = await scan({ session: file });
  assert.equal(report.details.totals.failures, 3500); assert.equal(report.details.totals.toolCalls, 3500);
  assert(report.details.evidenceCoverage.omittedEvents > 0); assert.equal(report.details.analysisStatus, "incomplete");
  assert(report.details.evidenceCoverage.indexedEvents <= EVIDENCE_LIMITS.events); assert(report.details.evidenceCoverage.accountedIndexBytes <= EVIDENCE_LIMITS.indexBytes);
  assert.equal(report.details.evidenceCoverage.indexedEvents + report.details.evidenceCoverage.omittedEvents, 7000);
  safe(await query(report, { leadRef: report.details.rows[0].leadRef }));
}));
