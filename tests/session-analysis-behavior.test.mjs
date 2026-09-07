import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import register from "../dist/pi/register.js";

// Deterministic registered-tool execution, not model behavior or a provider benchmark.
test("historical synthetic regression corpus now exposes observations without fixed/recovery diagnoses", async () => {
  const tools = new Map();
  register({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } });
  const ctx = { cwd: process.cwd(), sessionManager: {} };
  const scan = tools.get("pi_analyze_session"); const query = tools.get("pi_query_session");
  const args = scan.prepareArguments({ session: "all", projectFolder: fileURLToPath(new URL("fixtures/session-analysis/", import.meta.url)), since: "2023-11-01", until: "2023-12-31", asOf: "2024-01-01T00:00:00Z", reportMode: "full", approvedSourceRoots: ["not-opened"], knownFixed: "arbitrary assertion" });
  assert(!("approvedSourceRoots" in args));
  const report = await scan.execute("fixture-analysis", args, undefined, undefined, ctx);
  assert.equal(report.details.analysisStatus, "incomplete");
  assert.equal(report.details.corpus.malformedLines, 1);
  assert(report.details.totals.failures > 0);
  assert(report.details.total > 0);
  const leads = [...report.details.rows]; let cursor = report.details.nextCursor;
  while (cursor) {
    const page = await query.execute("lead-page", { reportRef: report.details.reportRef, view: "leads", cursor }, undefined, undefined, ctx);
    leads.push(...page.details.rows); cursor = page.details.nextCursor;
  }
  assert.equal(leads.length, report.details.total);
  for (const lead of leads) {
    assert.equal(lead.judgment, "unreviewed");
    const page = await query.execute("evidence", { reportRef: report.details.reportRef, leadRef: lead.leadRef }, undefined, undefined, ctx);
    assert(page.details.rows.some(row => row.eventRef === lead.eventRef), "every promoted lead resolves in one query");
    assert(Buffer.byteLength(JSON.stringify(page)) <= 8192);
    for (const forbidden of ["PRIVATE SYNTHETIC CARD BODY", "TOPSECRETVALUE", "SUPERSECRETVALUE", "likely_already_fixed", "current_source_confirmed", "successful recovery", "maxConcurrency"]) assert(!JSON.stringify(page).includes(forbidden));
  }
  assert.equal(report.details.incidents, undefined, "unsupported legacy causal incidents are intentionally retired");
  await query.execute("release", { reportRef: report.details.reportRef, release: true }, undefined, undefined, ctx);
});
