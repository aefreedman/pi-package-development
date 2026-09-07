import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { setImmediate as yieldTurn } from "node:timers/promises";

export type CorpusParams = {
  session?: string; projectFolder?: string; includeSessionIds?: string[]; excludeSessionIds?: string[];
  days?: number; since?: string; until?: string; asOf?: string;
  maxFiles?: number; maxBytes?: number; maxRecords?: number; maxScanMs?: number;
};
export type EventWindow = { since: number; until: number; asOf: number; clock: "message.timestamp then entry.timestamp; Unix milliseconds/explicit timezone" };
export type CorpusRecord = { entry: any; key: string; time: number | undefined; selected: boolean; duplicate: boolean };
export type CorpusSource = {
  path: string; sourceId: string; id: string; headerId?: string; parentPath?: string; version?: number;
  format: "native" | "unsupported"; records: CorpusRecord[]; bytes: number;
  malformedLines: number; unsupportedRecords: number; unknownTimestamps: number; unresolvedLineage: number;
  identityConflicts: number; duplicateEvents: number; selectedEvents: number; excludedEvents: number;
  unreadable: boolean; changed: boolean; truncated: boolean; missingIdentity: boolean;
};
export type CorpusCoverage = {
  discoveredFiles: number; processedFiles: number; logicalSessions: number; unsupportedFiles: number;
  bytesRead: number; recordsRead: number; messageOccurrences: number; uniqueMessages: number;
  selectedEvents: number; excludedEvents: number; unknownTimestamps: number; duplicateEvents: number;
  unreadableFiles: number; unreadableDirectories: number; changedFiles: number; truncatedFiles: number; unresolvedLineage: number;
  identityConflicts: number; unsupportedRecords: number; malformedLines: number; missingIdentities: number;
  selectionUncertainty: number; observedFirst?: number; observedLast?: number;
  discoveryComplete: boolean; stopReason?: "cancelled" | "deadline" | "file_limit" | "byte_limit" | "record_limit" | "directory_limit";
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const homePath = (text: string) => text.replace(/^@/, "").replace(/^~(?=[/\\]|$)/, homedir());
const canonicalPath = (text: string) => process.platform === "win32" ? resolve(text).toLowerCase() : resolve(text);

function boundary(value: string, end = false): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("Date bounds require YYYY-MM-DD (UTC) or an ISO timestamp with timezone.");
  const parsed = Date.parse(dateOnly ? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z` : value);
  // Date.parse normalizes invalid calendar days; reject those rather than silently changing the window.
  const day = value.slice(0, 10);
  const calendar = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed) || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) throw new Error("Invalid calendar date bound.");
  return parsed;
}
export function eventTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { try { return boundary(value); } catch { /* Unknown, never file time. */ } }
  return undefined;
}
export function eventWindow(params: CorpusParams, now = Date.now()): EventWindow {
  const asOf = params.asOf === undefined ? now : boundary(params.asOf);
  const days = params.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("days must be an integer from 1 to 365.");
  const until = params.until === undefined ? asOf : boundary(params.until, true);
  const since = params.since === undefined ? until - days * 86_400_000 : boundary(params.since);
  if (since > until) throw new Error("since must not be later than until.");
  return { since, until, asOf, clock: "message.timestamp then entry.timestamp; Unix milliseconds/explicit timezone" };
}
function budget(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error(`Scan budgets must be positive integers no larger than ${maximum}.`);
  return result;
}
export async function scanSessionCorpus(params: CorpusParams, cwd: string, signal?: AbortSignal, progress?: (files: number, bytes: number) => void) {
  const window = eventWindow(params);
  const limits = { files: budget(params.maxFiles, 1000, 5000), bytes: budget(params.maxBytes, 32 * 1024 * 1024, 128 * 1024 * 1024), records: budget(params.maxRecords, 20000, 100000), ms: budget(params.maxScanMs, 30000, 120000) };
  const deadline = Date.now() + limits.ms;
  const coverage: CorpusCoverage = { discoveredFiles: 0, processedFiles: 0, logicalSessions: 0, unsupportedFiles: 0, bytesRead: 0, recordsRead: 0, messageOccurrences: 0, uniqueMessages: 0, selectedEvents: 0, excludedEvents: 0, unknownTimestamps: 0, duplicateEvents: 0, unreadableFiles: 0, unreadableDirectories: 0, changedFiles: 0, truncatedFiles: 0, unresolvedLineage: 0, identityConflicts: 0, unsupportedRecords: 0, malformedLines: 0, missingIdentities: 0, selectionUncertainty: 0, discoveryComplete: false };
  const checkpoint = () => {
    if (signal?.aborted) coverage.stopReason = "cancelled";
    else if (!coverage.stopReason && Date.now() >= deadline) coverage.stopReason = "deadline";
    return !coverage.stopReason;
  };
  const files: string[] = [];
  let visited = 0;
  async function visit(path: string): Promise<void> {
    if (!checkpoint()) return;
    try {
      const directory = await opendir(path);
      for await (const entry of directory) {
        if (!checkpoint()) break;
        if (++visited > 100000) { coverage.stopReason = "directory_limit"; break; }
        const full = join(path, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          if (files.length >= limits.files) { coverage.stopReason = "file_limit"; break; }
          files.push(full);
        }
        // Symlinks are deliberately not followed (no cycles or implicit scope expansion).
      }
    } catch { coverage.unreadableDirectories++; }
  }
  const raw = params.session?.trim() || "current";
  if (raw === "current") throw new Error("Pass an explicit session id/path, directory or session='all'.");
  const candidate = resolve(cwd, homePath(raw));
  const explicitPath = isAbsolute(homePath(raw)) || /[/\\]/.test(raw) || raw.endsWith(".jsonl");
  if (checkpoint()) {
    if (explicitPath) {
      try { if ((await stat(candidate)).isDirectory()) await visit(candidate); else files.push(candidate); }
      catch { files.push(candidate); }
    } else await visit(resolve(cwd, homePath(params.projectFolder ?? join(homedir(), ".pi", "agent", "sessions"))));
  }
  coverage.discoveredFiles = files.length;
  coverage.discoveryComplete = !coverage.stopReason && !coverage.unreadableDirectories;
  // A discovery ceiling still permits processing the bounded discovered manifest.
  const discoveryStop = coverage.stopReason;
  if (discoveryStop === "file_limit" || discoveryStop === "directory_limit") delete coverage.stopReason;
  const sources: CorpusSource[] = [];
  let lastProgress = Number.NEGATIVE_INFINITY;
  const knownMetadata = new Set(["session_info", "model_change", "thinking_level_change", "compaction", "branch_summary", "custom", "custom_message", "label"]);
  for (const path of files.sort()) {
    if (!checkpoint()) break;
    if (coverage.bytesRead >= limits.bytes) { coverage.stopReason = "byte_limit"; break; }
    const source: CorpusSource = { path, sourceId: `source-${hash(canonicalPath(path))}`, id: `source-${hash(canonicalPath(path))}`, format: "unsupported", records: [], bytes: 0, malformedLines: 0, unsupportedRecords: 0, unknownTimestamps: 0, unresolvedLineage: 0, identityConflicts: 0, duplicateEvents: 0, selectedEvents: 0, excludedEvents: 0, unreadable: false, changed: false, truncated: false, missingIdentity: false };
    sources.push(source);
    let lineNumber = 0;
    let first = true;
    const parse = (line: Buffer) => {
      if (!line.toString("utf8").trim()) return;
      if (coverage.recordsRead >= limits.records) { coverage.stopReason = "record_limit"; return; }
      coverage.recordsRead++; lineNumber++;
      let entry: any;
      try { entry = JSON.parse(line.toString("utf8")); } catch { source.malformedLines++; return; }
      if (first) {
        first = false;
        if (entry?.type === "session" && [1, 2, 3].includes(entry.version ?? 1)) {
          source.format = "native"; source.version = entry.version ?? 1;
          if (typeof entry.id === "string" && entry.id.trim()) { source.headerId = entry.id; source.id = `session-${hash(entry.id)}`; }
          else source.missingIdentity = true;
          if (typeof entry.parentSession === "string") source.parentPath = canonicalPath(resolve(dirname(path), entry.parentSession));
          return;
        }
      }
      if (source.format !== "native") { source.unsupportedRecords++; return; }
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || (entry.type !== "message" && !knownMetadata.has(entry.type))) { source.unsupportedRecords++; return; }
      const key = typeof entry.id === "string" && entry.id ? entry.id : `line-${lineNumber}`;
      if (typeof entry.id !== "string" || !entry.id || (source.version !== 1 && !(entry.parentId === null || typeof entry.parentId === "string"))) source.unresolvedLineage++;
      const time = eventTime(entry.message?.timestamp) ?? eventTime(entry.timestamp);
      const selected = time !== undefined && time >= window.since && time <= window.until;
      source.records.push({ entry, key, time, selected, duplicate: false });
    };
    try {
      const before = await stat(path);
      const remainingBytes = limits.bytes - coverage.bytesRead;
      const stream = createReadStream(path, { highWaterMark: Math.min(64 * 1024, remainingBytes), end: remainingBytes - 1 });
      const abort = () => stream.destroy();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => { coverage.stopReason ??= "deadline"; stream.destroy(); }, Math.max(1, deadline - Date.now()));
      let pending = Buffer.alloc(0);
      try {
        for await (const chunk of stream) {
          if (!checkpoint()) break;
          const remaining = limits.bytes - coverage.bytesRead;
          const bytes = (chunk as Buffer).subarray(0, remaining);
          coverage.bytesRead += bytes.length; source.bytes += bytes.length;
          pending = Buffer.concat([pending, bytes]);
          let end: number;
          while ((end = pending.indexOf(10)) >= 0 && checkpoint()) {
            if (end > 1024 * 1024) source.unsupportedRecords++; else parse(pending.subarray(0, end));
            pending = pending.subarray(end + 1);
          }
          if (pending.length > 1024 * 1024) { source.truncated = true; source.unsupportedRecords++; break; }
          if (Date.now() - lastProgress >= 250) { progress?.(sources.length, coverage.bytesRead); lastProgress = Date.now(); }
          await yieldTurn();
          if (bytes.length < (chunk as Buffer).length || (coverage.bytesRead >= limits.bytes && source.bytes < before.size)) { coverage.stopReason = "byte_limit"; break; }
        }
        if (checkpoint() && !source.truncated && pending.length) parse(pending);
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); stream.destroy(); }
      const after = await stat(path);
      source.changed = before.size !== after.size || before.mtimeMs !== after.mtimeMs;
      source.truncated ||= source.bytes < before.size || Boolean(coverage.stopReason);
    } catch { if (!checkpoint()) source.truncated = true; else source.unreadable = true; }
    coverage.processedFiles++;
  }
  checkpoint();
  if (discoveryStop) coverage.stopReason ??= discoveryStop;
  const aggregate = ["all", "sessions", "*"].includes(raw.toLowerCase());
  const selectedSources = sources.filter(source => {
    const identities = [source.headerId, source.id, source.sourceId].filter(Boolean) as string[];
    if (!explicitPath && !aggregate && !identities.some(id => id.includes(raw)) && !basename(source.path).includes(raw)) return false;
    if (params.includeSessionIds?.length && !params.includeSessionIds.some(id => identities.includes(id))) return false;
    return !params.excludeSessionIds?.some(id => identities.includes(id));
  });
  const selectedSet = new Set(selectedSources);
  coverage.selectionUncertainty = sources.filter(source => !selectedSet.has(source)
    && !params.excludeSessionIds?.includes(source.sourceId)
    && (!source.headerId || source.unreadable || source.changed || source.truncated)).length;
  if (!explicitPath && !aggregate && !selectedSources.length && !coverage.stopReason && !coverage.selectionUncertainty) throw new Error("No native header identity or filename matched the requested session.");
  const byPath = new Map(selectedSources.map(source => [canonicalPath(source.path), source]));
  // Union only proven parent links and identical native header identities, never argument similarity.
  const groups = new Map(selectedSources.map(source => [source.sourceId, source.sourceId]));
  const root = (id: string): string => { let next = groups.get(id)!; while (next !== id) { id = next; next = groups.get(id)!; } return id; };
  const merge = (a: CorpusSource, b: CorpusSource) => groups.set(root(a.sourceId), root(b.sourceId));
  const headers = new Map<string, CorpusSource>();
  for (const source of selectedSources) {
    if (source.headerId) { const other = headers.get(source.headerId); if (other) merge(source, other); else headers.set(source.headerId, source); }
    if (source.parentPath) {
      const parent = byPath.get(source.parentPath);
      const ancestry = new Set([canonicalPath(source.path)]);
      let next = parent;
      let cycle = false;
      while (next) {
        if (signal?.aborted || Date.now() >= deadline) { cycle = true; break; }
        const path = canonicalPath(next.path);
        if (ancestry.has(path)) { cycle = true; break; }
        ancestry.add(path); next = next.parentPath ? byPath.get(next.parentPath) : undefined;
      }
      if (parent?.format === "native" && !cycle) merge(source, parent); else source.unresolvedLineage++;
    }
  }
  const continueAnalysis = () => {
    if (signal?.aborted) { coverage.stopReason = "cancelled"; return false; }
    if (Date.now() >= deadline) { coverage.stopReason = "deadline"; return false; }
    return true;
  };
  const seen = new Map<string, Set<string>>();
  let normalized = 0;
  for (const source of selectedSources) {
    const local = new Map<string, string>();
    for (const record of source.records) {
      if (++normalized % 128 === 0) await yieldTurn();
      if (!continueAnalysis()) { source.truncated = true; break; }
      const entry = record.entry;
      const digest = hash(JSON.stringify(entry));
      const eventId = `${root(source.sourceId)}:${record.key}`;
      const fingerprints = seen.get(eventId) ?? new Set<string>();
      // Missing v1 IDs cannot establish copied-history provenance.
      record.duplicate = typeof entry.id === "string" && Boolean(entry.id) && fingerprints.has(digest);
      if (fingerprints.size && !fingerprints.has(digest)) source.identityConflicts++;
      fingerprints.add(digest); seen.set(eventId, fingerprints);
      if (local.has(record.key) && local.get(record.key) !== digest) source.identityConflicts++;
      if (typeof entry.parentId === "string" && !local.has(entry.parentId)) source.unresolvedLineage++;
      local.set(record.key, digest);
      if (entry.type !== "message") continue;
      coverage.messageOccurrences++;
      if (record.duplicate) { source.duplicateEvents++; continue; }
      coverage.uniqueMessages++;
      if (record.time === undefined) source.unknownTimestamps++;
      else {
        coverage.observedFirst = Math.min(coverage.observedFirst ?? record.time, record.time);
        coverage.observedLast = Math.max(coverage.observedLast ?? record.time, record.time);
        if (record.selected) source.selectedEvents++; else source.excludedEvents++;
      }
    }
    coverage.unsupportedFiles += Number(source.format === "unsupported");
    coverage.unreadableFiles += Number(source.unreadable); coverage.changedFiles += Number(source.changed); coverage.truncatedFiles += Number(source.truncated);
    coverage.missingIdentities += Number(source.missingIdentity);
    for (const key of ["selectedEvents", "excludedEvents", "unknownTimestamps", "duplicateEvents", "unresolvedLineage", "identityConflicts", "unsupportedRecords", "malformedLines"] as const) coverage[key] += source[key];
  }
  coverage.logicalSessions = new Set(selectedSources.filter(source => source.format === "native").map(source => source.id)).size;
  return { sources: selectedSources, coverage, window, limits, continueAnalysis };
}
export function corpusIncomplete(coverage: CorpusCoverage): boolean {
  return Boolean(coverage.stopReason || !coverage.discoveryComplete || coverage.unsupportedFiles || coverage.unreadableFiles || coverage.changedFiles || coverage.truncatedFiles || coverage.unresolvedLineage || coverage.identityConflicts || coverage.unsupportedRecords || coverage.malformedLines || coverage.missingIdentities || coverage.unknownTimestamps || coverage.selectionUncertainty);
}
