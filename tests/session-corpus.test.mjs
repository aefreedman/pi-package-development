import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, stat, utimes } from "node:fs/promises";
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
  for (const since of ["bad", "2026-02-30", "2026-01-01T00:00:00", "2026-13-01", "2026-01-02T24:00:00Z", ""]) assert.throws(() => eventWindow({ since }));
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
  for (const [budget, stopReason] of [[{ maxBytes: 200 }, "byte_limit"], [{ maxRecords: 3 }, "record_limit"]]) {
    const result = await scanSessionCorpus({ session: root, ...bounds, ...budget }, root);
    assert.equal(result.coverage.stopReason, stopReason);
    assert(corpusIncomplete(result.coverage));
    if (budget.maxBytes) assert.equal(result.coverage.bytesRead, budget.maxBytes);
    if (budget.maxRecords) assert.equal(result.coverage.recordsRead, budget.maxRecords);
  }
  const admitted = await scanSessionCorpus({ session: root, ...bounds, maxFiles: 1 }, root);
  assert.equal(admitted.coverage.discoveredFiles, 1);
  assert.equal(admitted.coverage.candidatesSeen, 2);
  assert.equal(admitted.coverage.candidatesOmitted, 1);
  assert.equal(admitted.coverage.stopReason, undefined);
  assert(corpusIncomplete(admitted.coverage));
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

test("bounded discovery admits the newest observed candidates, not traversal order", async () => fixture(async (root, save) => {
  const old = await save("a-old.jsonl", [header("old"), user("old")]);
  const nested = join(root, "nested");
  await (await import("node:fs/promises")).mkdir(nested);
  const recent = await save("nested/z-recent.jsonl", [header("recent"), user("recent")]);
  await utimes(old, new Date(1), new Date(1)); await utimes(recent, new Date(2_000_000), new Date(2_000_000));
  const result = await scanSessionCorpus({ session: root, ...bounds, maxFiles: 1 }, root);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].headerId, "recent", "admission, not only processing order, favors the recent candidate");
  assert.equal(result.coverage.entriesVisited, 3);
  assert.equal(result.coverage.candidatesSeen, 2);
  assert.equal(result.coverage.candidatesOmitted, 1);
  assert(corpusIncomplete(result.coverage), "unadmitted observed candidates remain explicit coverage omissions");
  const ordered = await scanSessionCorpus({ session: root, ...bounds, maxFiles: 2 }, root);
  assert.deepEqual(ordered.sources.map(source => source.headerId), ["recent", "old"], "processing follows the deterministic admission ranking");
  await utimes(old, new Date(3), new Date(3)); await utimes(recent, new Date(3), new Date(3));
  const tied = await scanSessionCorpus({ session: root, ...bounds, maxFiles: 1 }, root);
  assert.equal(tied.sources[0].headerId, "old", "canonical paths break equal-mtime admission ties deterministically");
}));

test("streaming discovery checks limits, deadline and cancellation while enumerating", async () => fixture(async (root, save) => {
  const old = await save("old.jsonl", [header("old"), user("old")]);
  const recent = await save("recent.jsonl", [header("recent"), user("recent")]);
  await utimes(old, new Date(1), new Date(1)); await utimes(recent, new Date(2), new Date(2));
  const file = (name) => ({ name, isDirectory: () => false, isFile: () => true });
  const other = (name) => ({ name, isDirectory: () => false, isFile: () => true });
  let yielded = 0; let closed = false;
  async function* hugeDirectory() {
    try {
      for (const name of ["old.jsonl", "recent.jsonl"]) { yielded++; yield file(name); }
      for (;;) { yielded++; yield other(`unbounded-${yielded}.tmp`); }
    } finally { closed = true; }
  }
  const limited = await scanSessionCorpus({ session: root, ...bounds, maxFiles: 1 }, root, undefined, undefined, { opendir: async () => hugeDirectory(), stat });
  assert.equal(limited.coverage.stopReason, "directory_limit");
  assert.equal(limited.coverage.entriesVisited, 100001, "entry limit is enforced during iterator consumption");
  assert.equal(yielded, 100001, "the iterator is not fully materialized before the limit");
  assert(closed, "breaking bounded enumeration closes the iterator");
  assert.equal(limited.sources[0].headerId, "recent", "admitted content still uses reserved scan time");
  assert.equal(limited.coverage.selectedEvents, 1);
  assert(corpusIncomplete(limited.coverage));

  let clock = 0; closed = false;
  const originalNow = Date.now;
  async function* slowDirectory() {
    try { yielded = 1; yield file("recent.jsonl"); clock = 26; yielded++; yield other("late.tmp"); } finally { closed = true; }
  }
  try {
    Date.now = () => clock;
    const timed = await scanSessionCorpus({ session: root, ...bounds, maxScanMs: 100 }, root, undefined, undefined, { opendir: async () => slowDirectory(), stat });
    assert.equal(timed.coverage.stopReason, "discovery_deadline");
    assert.equal(timed.coverage.entriesVisited, 1, "deadline is checked before accepting the next yielded entry");
    assert(closed); assert.equal(timed.coverage.selectedEvents, 1);
    assert(corpusIncomplete(timed.coverage));
  } finally { Date.now = originalNow; }

  const abort = new AbortController(); closed = false;
  async function* cancelledDirectory() {
    try { yield file("recent.jsonl"); await Promise.resolve(); abort.abort(); yield other("after-cancel.tmp"); } finally { closed = true; }
  }
  const cancelled = await scanSessionCorpus({ session: root, ...bounds }, root, abort.signal, undefined, { opendir: async () => cancelledDirectory(), stat });
  assert.equal(cancelled.coverage.stopReason, "cancelled");
  assert.equal(cancelled.coverage.entriesVisited, 1, "cancellation stops enumeration before the next entry is retained");
  assert(closed); assert.equal(cancelled.coverage.discoveredFiles, 1);
  assert.equal(cancelled.coverage.processedFiles, 0);
  assert(corpusIncomplete(cancelled.coverage));
}));

test("oversized records discard through LF and resume with exact line locators", async () => fixture(async (root, save) => {
  const giant = JSON.stringify({ type: "message", id: "giant", parentId: null, timestamp: time, message: { role: "user", content: "x".repeat(1024 * 1024 + 1) } });
  const file = await save("resume.jsonl", [header("resume"), giant, user("after", null)]);
  const result = await scanSessionCorpus({ session: file, ...bounds }, root);
  assert.equal(result.coverage.oversizedRecords, 1);
  assert.equal(result.coverage.unsupportedRecords, 1, "oversized records overlap unsupported-record omissions");
  assert.equal(result.coverage.recordsRead, 3, "the discarded nonblank line consumes one record attempt");
  assert.equal(result.sources[0].records[0].line, 3, "later records retain physical JSONL line numbers");
  assert.equal(result.coverage.selectedEvents, 1);
  const eof = await save("eof.jsonl", [header("eof"), giant]);
  const atEof = await scanSessionCorpus({ session: eof, ...bounds }, root);
  assert.equal(atEof.coverage.oversizedRecords, 1, "an oversized actual EOF record is an omission, not a truncated suffix");
  const threshold = await save("threshold.jsonl", [header("threshold"), "x".repeat(1024 * 1024 - 1), "x".repeat(1024 * 1024), "x".repeat(1024 * 1024 + 1)]);
  const thresholdResult = await scanSessionCorpus({ session: threshold, ...bounds }, root);
  assert.equal(thresholdResult.coverage.oversizedRecords, 1, "only records strictly over the 1 MiB limit are discarded");
  const unicode = JSON.stringify({ type: "message", id: "unicode", parentId: null, timestamp: time, message: { role: "user", content: "\u3042".repeat(400000) } }) + "\r";
  const crlf = await save("crlf.jsonl", [header("crlf"), unicode, user("after-crlf", null)]);
  const crlfResult = await scanSessionCorpus({ session: crlf, ...bounds }, root);
  assert.equal(crlfResult.coverage.oversizedRecords, 1);
  assert.equal(crlfResult.sources[0].records[0].line, 3, "CRLF and UTF-8 discard framing resumes at the next physical line");
  const cutoff = await scanSessionCorpus({ session: file, ...bounds, maxBytes: 200 }, root);
  assert.equal(cutoff.coverage.oversizedRecords, 0, "a byte-cutoff suffix is never parsed as a complete record");
  assert.equal(cutoff.coverage.stopReason, "byte_limit");
}));

test("cyclic header lineage and legacy entries without event identities remain uncertain", async () => fixture(async (root, save) => {
  await save("a.jsonl", [header("a", { parentSession: "b.jsonl" }), user("u")]);
  await save("b.jsonl", [header("b", { parentSession: "a.jsonl" }), user("u")]);
  const cyclic = await scanSessionCorpus({ session: root, ...bounds }, root);
  assert.equal(cyclic.coverage.unresolvedLineage, 2);
  assert.equal(cyclic.coverage.uniqueMessages, 2, "cycles do not prove copied history");
  assert(corpusIncomplete(cyclic.coverage));
  const legacy = await save("legacy.jsonl", [header("legacy", { version: 1 }), { type: "message", timestamp: time, message: { role: "user", content: "Synthetic legacy event" } }]);
  const old = await scanSessionCorpus({ session: legacy, ...bounds }, root);
  assert.equal(old.coverage.logicalSessions, 1);
  assert.equal(old.coverage.selectedEvents, 1);
  assert.equal(old.coverage.unresolvedLineage, 1);
  assert(corpusIncomplete(old.coverage));
}));

test("identity conflicts and unreadable inputs never report complete", async () => fixture(async (root, save) => {
  await save("conflict.jsonl", [header("conflict"), user("same"), { ...user("same"), message: { role: "user", content: "Changed synthetic event" } }]);
  const conflict = await scanSessionCorpus({ session: root, ...bounds }, root);
  assert(conflict.coverage.identityConflicts > 0);
  assert(corpusIncomplete(conflict.coverage));
  const missing = await scanSessionCorpus({ session: join(root, "missing.jsonl"), ...bounds }, root);
  assert.equal(missing.coverage.unreadableFiles, 1);
  assert(corpusIncomplete(missing.coverage));
  const filteredMissing = await scanSessionCorpus({ session: join(root, "missing.jsonl"), includeSessionIds: ["wanted"], ...bounds }, root);
  assert.equal(filteredMissing.coverage.selectionUncertainty, 1);
  assert(corpusIncomplete(filteredMissing.coverage), "ID filters cannot hide an unreadable source whose identity is unknown");
}));
