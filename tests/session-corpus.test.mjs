import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSessionCorpus, corpusIncomplete, eventWindow } from "../dist/pi/session-corpus.js";

const time = "2026-01-02T12:00:00Z";
const bounds = { since: "2026-01-02", until: "2026-01-02", asOf: "2026-01-03T00:00:00Z" };
const header = (id, extra = {}) => ({ type: "session", version: 3, id, timestamp: time, ...extra });
const user = (id, parentId = null, timestamp = time) => ({ type: "message", id, parentId, timestamp, message: { role: "user", content: "Synthetic request" } });
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pi-corpus-synthetic-"));
  const save = async (name, lines) => { const path = join(root, name); await writeFile(path, lines.map(x => typeof x === "string" ? x : JSON.stringify(x)).join("\n")); return path; };
  try { await fn(root, save); } finally { await rm(root, { recursive: true, force: true }); }
}

test("header identity, exact mirrors/fork history, branches and independent repetitions", async () => fixture(async (root, save) => {
  const shared = user("shared");
  const parent = await save("a-session.jsonl", [header("root"), shared, user("branch-a", "shared"), user("branch-b", "shared")]);
  await save("b-session.jsonl", [header("root"), shared, user("branch-a", "shared"), user("branch-b", "shared")]);
  await save("c-session.jsonl", [header("child", { parentSession: parent }), shared, user("new", "shared")]);
  await save("d-session.jsonl", [header("independent"), shared]);
  const result = await scanSessionCorpus({ session: "all", projectFolder: root, ...bounds }, root);
  assert.equal(result.coverage.discoveredFiles, 4);
  assert.equal(result.coverage.logicalSessions, 3);
  assert.equal(result.coverage.messageOccurrences, 9);
  assert.equal(result.coverage.uniqueMessages, 5);
  assert.equal(result.coverage.duplicateEvents, 4);
  assert.equal(result.coverage.selectedEvents, 5);
  assert.equal(corpusIncomplete(result.coverage), false);
  assert.equal(new Set(result.sources.map(x => x.sourceId)).size, 4);
  assert.equal(new Set(result.sources.map(x => x.id)).size, 3);
  const selected = await scanSessionCorpus({ session: "root", projectFolder: root, ...bounds }, root);
  assert.equal(selected.coverage.logicalSessions, 1);
  assert.equal(selected.coverage.uniqueMessages, 3);
  const excluded = await scanSessionCorpus({ session: "all", projectFolder: root, excludeSessionIds: ["root"], ...bounds }, root);
  assert.equal(excluded.coverage.logicalSessions, 2);
  assert.equal(excluded.coverage.unresolvedLineage, 1, "excluded parent is not read implicitly for lineage");
}));

test("unsupported root transcripts, future versions, malformed tails and missing lineage remain incomplete", async () => fixture(async (root, save) => {
  await save("transcript.jsonl", [{ role: "user", content: "Synthetic export", timestamp: time }]);
  await save("future.jsonl", [header("future", { version: 99 }), user("u")]);
  await save("fork.jsonl", [header("fork", { parentSession: "missing.jsonl" }), user("u", "missing"), "{"]);
  const result = await scanSessionCorpus({ session: root, ...bounds }, root);
  assert.equal(result.coverage.unsupportedFiles, 2);
  assert.equal(result.coverage.logicalSessions, 1);
  assert.equal(result.coverage.malformedLines, 1);
  assert.equal(result.coverage.unresolvedLineage, 2);
  assert(corpusIncomplete(result.coverage));
}));

test("same explicit event window for file, directory, aggregate and header selectors, regardless of mtime", async () => fixture(async (root, save) => {
  const file = await save("session.jsonl", [header("clock"), user("before", null, "2026-01-01T23:59:59.999Z"), user("start", "before", "2026-01-02T00:00:00Z"), user("end", "start", "2026-01-02T23:59:59.999Z"), user("after", "end", "2026-01-03T00:00:00Z"), user("unknown", "after", "not-a-date")]);
  await utimes(file, new Date(0), new Date(0));
  for (const session of [file, root, "all", "clock"]) {
    const result = await scanSessionCorpus({ session, projectFolder: root, ...bounds }, root);
    assert.equal(result.coverage.selectedEvents, 2);
    assert.equal(result.coverage.excludedEvents, 2);
    assert.equal(result.coverage.unknownTimestamps, 1);
    assert(corpusIncomplete(result.coverage));
  }
  for (const session of [file, root, "all", "clock"]) {
    const result = await scanSessionCorpus({ session, projectFolder: root, days: 1, asOf: "2026-01-03T00:00:00Z" }, root);
    assert.equal(result.coverage.selectedEvents, 3, "days uses inclusive event timestamps for all selectors");
  }
}));

test("strict UTC boundaries and Unix milliseconds", () => {
  for (const since of ["bad", "2026-02-30", "2026-01-01T00:00:00", "2026-13-01", ""]) assert.throws(() => eventWindow({ since }));
  assert.throws(() => eventWindow({ since: "2026-02-01", until: "2026-01-01" }));
  assert.throws(() => eventWindow({ days: 0 }));
  assert.equal(eventWindow(bounds).since, Date.parse("2026-01-02T00:00:00Z"));
} );

test("pre-abort, cooperative abort, byte/record/file/deadline and oversized-line limits disclose partial coverage", async () => fixture(async (root, save) => {
  await save("one.jsonl", [header("one"), ...Array.from({ length: 5000 }, (_, i) => user(`u${i}`, i ? `u${i-1}` : null))]);
  await save("two.jsonl", [header("two"), user("u")]);
  const pre = new AbortController(); pre.abort();
  const aborted = await scanSessionCorpus({ session: root, ...bounds }, root, pre.signal);
  assert.equal(aborted.coverage.stopReason, "cancelled");
  assert.equal(aborted.coverage.bytesRead, 0);
  assert.equal(aborted.coverage.discoveredFiles, 0);
  const during = new AbortController();
  const mid = await scanSessionCorpus({ session: root, ...bounds }, root, during.signal, () => during.abort());
  assert.equal(mid.coverage.stopReason, "cancelled");
  assert(mid.coverage.bytesRead <= 65536);
  for (const [budget, stopReason] of [[{ maxBytes: 200 }, "byte_limit"], [{ maxRecords: 3 }, "record_limit"], [{ maxFiles: 1 }, "file_limit"]]) {
    const result = await scanSessionCorpus({ session: root, ...bounds, ...budget }, root);
    assert.equal(result.coverage.stopReason, stopReason);
    assert(corpusIncomplete(result.coverage));
    if (budget.maxBytes) assert.equal(result.coverage.bytesRead, budget.maxBytes);
    if (budget.maxRecords) assert.equal(result.coverage.recordsRead, budget.maxRecords);
  }
  const originalNow = Date.now;
  let clock = 0;
  try {
    Date.now = () => clock++ * 100;
    const timed = await scanSessionCorpus({ session: root, ...bounds, maxScanMs: 1 }, root);
    assert.equal(timed.coverage.stopReason, "deadline");
  } finally { Date.now = originalNow; }
  const giant = await save("giant.jsonl", [header("giant"), JSON.stringify({ type: "message", message: { role: "user", content: "x".repeat(1024 * 1024 + 1) } })]);
  const oversized = await scanSessionCorpus({ session: giant, ...bounds }, root);
  assert(corpusIncomplete(oversized.coverage));
  assert.equal(oversized.coverage.unsupportedRecords, 1);
}));

test("identity conflicts and unreadable inputs never report complete", async () => fixture(async (root, save) => {
  await save("conflict.jsonl", [header("conflict"), user("same"), { ...user("same"), message: { role: "user", content: "Changed synthetic event" } }]);
  const conflict = await scanSessionCorpus({ session: root, ...bounds }, root);
  assert(conflict.coverage.identityConflicts > 0);
  assert(corpusIncomplete(conflict.coverage));
  const missing = await scanSessionCorpus({ session: join(root, "missing.jsonl"), ...bounds }, root);
  assert.equal(missing.coverage.unreadableFiles, 1);
  assert(corpusIncomplete(missing.coverage));
}));
