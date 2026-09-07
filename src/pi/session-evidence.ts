import { createHmac, randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { sourceFingerprint, type CorpusRecord, type CorpusSource, type SourceFingerprint } from "./session-corpus.js";

export const EVIDENCE_LIMITS = { reports: 4, events: 5000, indexBytes: 4 * 1024 * 1024, responseBytes: 8192, pageRows: 10, fields: 8, lifetimeMs: 15 * 60 * 1000 } as const;
const opaque = (kind: string) => `${kind}_${randomBytes(12).toString("hex")}`;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export type Outcome = "success" | "failure" | "unknown";
export type Classification = {
  failed: boolean; nativeOutcome: Outcome; semanticOutcome: Outcome | "not-applicable";
  source: "native" | "structured" | "text_fallback" | "none"; heuristicLead: boolean;
};
type Locator = { sourceRef: string; sessionRef: string; lineageRef: string; entryRef: string; parentRef: string | null; line: number; time: number | null; selected: boolean; duplicate: boolean };
export type CallEvidence = { locator: Locator; toolRef: string; fields: Array<{ fieldRef: string; type: string }>; omittedFields: number; block: number };
export type EvidencePacket = {
  eventRef: string; kind: "tool_result" | "tool_call" | "user_message" | "assistant_error" | "assistant_aborted";
  provenance: Locator; toolRef?: string; call?: CallEvidence; outcome?: Classification;
  context?: Array<{ provenance: Locator; role: "user" | "assistant" | "toolResult" | "other" }>;
  join?: "native_id_ancestry" | "legacy_name_ancestry" | "unresolved";
  messageObservedSpanMs?: number | null;
};
type Lead = { leadRef: string; toolRef?: string | undefined; signature: string; judgment: "unreviewed"; indexedEvents: number; indexedSessions: number; indexedLineages: number; eventRef: string };
type PrivateSource = { path: string; fingerprint?: SourceFingerprint | undefined; changed: boolean };
type Cluster = { lead: Lead; events: number[]; sessions: Set<string>; lineages: Set<string> };

/** No transcript text, tool names, argument keys/values or native IDs survive into this index. */
export class EvidenceBuilder {
  private salt = randomBytes(32);
  sources = new Map<string, PrivateSource>();
  events: EvidencePacket[] = [];
  clusters = new Map<string, Cluster>();
  observedEvents = 0;
  private accountedBytes = 0;
  private closed = false;
  ref(kind: string, identity: string): string {
    return `${kind}_${createHmac("sha256", this.salt).update(identity).digest("hex").slice(0, 24)}`;
  }
  locator(source: CorpusSource, record: CorpusRecord): Locator {
    return {
      sourceRef: this.ref("s", source.sourceId), sessionRef: this.ref("n", source.id), lineageRef: this.ref("g", source.lineageId ?? source.sourceId),
      entryRef: this.ref("e", JSON.stringify([source.sourceId, record.key])),
      parentRef: typeof record.entry.parentId === "string" ? this.ref("e", JSON.stringify([source.sourceId, record.entry.parentId])) : null,
      line: record.line, time: record.time ?? null, selected: record.selected, duplicate: record.duplicate,
    };
  }
  call(source: CorpusSource, record: CorpusRecord, block: number, name: string, args: Record<string, unknown>): CallEvidence {
    const keys = Object.keys(args);
    return { locator: this.locator(source, record), block, toolRef: this.ref("t", name),
      fields: keys.slice(0, EVIDENCE_LIMITS.fields).map(key => ({ fieldRef: this.ref("f", JSON.stringify([name, key])), type: args[key] === null ? "null" : Array.isArray(args[key]) ? "array" : typeof args[key] })),
      omittedFields: Math.max(0, keys.length - EVIDENCE_LIMITS.fields) };
  }
  add(source: CorpusSource, packet: Omit<EvidencePacket, "eventRef">): void {
    this.observedEvents++;
    if (this.closed) return;
    const event = { ...packet, eventRef: opaque("v") };
    const signature = event.kind === "tool_result" && event.outcome
      ? event.outcome.failed ? `typed_failure:${event.outcome.nativeOutcome}:${event.outcome.semanticOutcome}` : event.outcome.heuristicLead ? "unverified_text_signature" : undefined
      : event.kind === "assistant_error" || event.kind === "assistant_aborted" ? event.kind : undefined;
    const key = JSON.stringify([event.toolRef, signature]);
    let cluster = signature ? this.clusters.get(key) : undefined;
    const privateSource = { path: source.path, fingerprint: source.fingerprint, changed: source.changed || source.unreadable };
    // Conservative serialized-index allowance includes map keys, arrays and sets. Not a V8 heap limit.
    const cost = bytes(event) + 256 + (this.sources.has(event.provenance.sourceRef) ? 0 : bytes(privateSource) + 128) + (signature && !cluster ? 1024 : 0);
    if (this.events.length >= EVIDENCE_LIMITS.events || this.accountedBytes + cost > EVIDENCE_LIMITS.indexBytes) { this.closed = true; return; }
    this.accountedBytes += cost;
    this.sources.set(event.provenance.sourceRef, privateSource);
    if (signature) {
      if (!cluster) {
        cluster = { lead: { leadRef: opaque("l"), toolRef: event.toolRef, signature, judgment: "unreviewed", indexedEvents: 0, indexedSessions: 0, indexedLineages: 0, eventRef: event.eventRef }, events: [], sessions: new Set(), lineages: new Set() };
        this.clusters.set(key, cluster);
      }
      cluster.events.push(this.events.length); cluster.sessions.add(event.provenance.sessionRef); cluster.lineages.add(event.provenance.lineageRef);
      cluster.lead.indexedEvents++; cluster.lead.indexedSessions = cluster.sessions.size; cluster.lead.indexedLineages = cluster.lineages.size;
    }
    this.events.push(event);
  }
  finish() {
    const clusters = [...this.clusters.values()].sort((a, b) => b.lead.indexedEvents - a.lead.indexedEvents);
    return { sources: this.sources, events: this.events, clusters, coverage: { analysisIncomplete: false, observedEvents: this.observedEvents, indexedEvents: this.events.length, omittedEvents: this.observedEvents - this.events.length, indexedLeads: clusters.length, accountedIndexBytes: this.accountedBytes } };
  }
}
type Index = ReturnType<EvidenceBuilder["finish"]>;
type StoredReport = Index & { reportRef: string; expiresAt: number; scope: object | string; timer: NodeJS.Timeout; cursorSalt: Buffer };
export type QueryParams = { reportRef: string; leadRef?: string; eventRef?: string; toolRef?: string; view?: "events" | "leads"; cursor?: string; limit?: number; release?: boolean };

export function evidenceResult(details: Record<string, unknown>) {
  // Both copies and the native result wrapper count toward the ceiling, not only model-facing text.
  const result = { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
  if (bytes(result) > EVIDENCE_LIMITS.responseBytes) throw new Error("evidence_response_limit");
  return result;
}

/** Extension-instance scoped, memory-only; no persisted transcript/index or background worker. */
export class EvidenceStore {
  private reports = new Map<string, StoredReport>();
  private retired = new Map<string, string>();
  generation = 0;
  private retire(ref: string, reason: string) {
    const report = this.reports.get(ref);
    if (report) { clearTimeout(report.timer); this.reports.delete(ref); }
    this.retired.set(ref, reason);
    if (this.retired.size > 32) this.retired.delete(this.retired.keys().next().value!);
  }
  clear(scope?: object | string) {
    this.generation++; // Also invalidate scans in flight during lifecycle cleanup.
    for (const [ref, report] of this.reports) if (scope === undefined || report.scope === scope) this.retire(ref, "expired_report");
  }
  private prune() {
    for (const [ref, report] of this.reports) if (Date.now() >= report.expiresAt) this.retire(ref, "expired_report");
  }
  save(index: Index, scope: object | string, generation = this.generation) {
    if (generation !== this.generation) throw new Error("expired_report");
    this.prune();
    while (this.reports.size >= EVIDENCE_LIMITS.reports) this.retire(this.reports.keys().next().value!, "expired_report");
    const reportRef = opaque("r"); const expiresAt = Date.now() + EVIDENCE_LIMITS.lifetimeMs;
    const timer = setTimeout(() => this.retire(reportRef, "expired_report"), EVIDENCE_LIMITS.lifetimeMs); timer.unref();
    const report: StoredReport = { ...index, reportRef, expiresAt, scope, timer, cursorSalt: randomBytes(32) };
    this.reports.set(reportRef, report);
    return report;
  }
  private get(ref: string, scope: object | string) {
    this.prune();
    const report = this.reports.get(ref);
    if (!report) throw new Error(this.retired.get(ref) ?? "invalid_report");
    if (report.scope !== scope) throw new Error("invalid_report_scope");
    return report;
  }
  private cursor(report: StoredReport, selector: string, offset: number) {
    const body = String(offset);
    return `${body}.${createHmac("sha256", report.cursorSalt).update(JSON.stringify([selector, body])).digest("hex").slice(0, 24)}`;
  }
  private page(report: StoredReport, params: QueryParams, metadata: Record<string, unknown> = {}) {
    const limit = params.limit ?? 3;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > EVIDENCE_LIMITS.pageRows) throw new Error("invalid_page_limit");
    if ([params.leadRef, params.eventRef, params.toolRef].filter(x => x !== undefined).length > 1 || (params.view === "leads" && (params.leadRef !== undefined || params.eventRef !== undefined || params.toolRef !== undefined))) throw new Error("invalid_evidence_selector");
    const view = params.view ?? "events";
    if (view !== "events" && view !== "leads") throw new Error("invalid_evidence_view");
    const selector = JSON.stringify([view, params.leadRef, params.eventRef, params.toolRef]);
    let offset = 0;
    if (params.cursor !== undefined) {
      offset = Number(params.cursor.split(".")[0]);
      if (!Number.isSafeInteger(offset) || offset < 0 || params.cursor !== this.cursor(report, selector, offset)) throw new Error("invalid_cursor");
    }
    const cluster = params.leadRef !== undefined ? report.clusters.find(c => c.lead.leadRef === params.leadRef) : undefined;
    if (params.leadRef !== undefined && !cluster) throw new Error("invalid_lead_ref");
    const events = cluster ? cluster.events.map(i => report.events[i]!) : params.eventRef !== undefined ? report.events.filter(e => e.eventRef === params.eventRef) : params.toolRef !== undefined ? report.events.filter(e => e.toolRef === params.toolRef) : report.events;
    if ((params.eventRef !== undefined || params.toolRef !== undefined) && !events.length) throw new Error("invalid_event_or_tool_ref");
    const rows = view === "leads" ? report.clusters.map(c => c.lead) : events;
    if (offset > rows.length) throw new Error("invalid_cursor");
    const selected: unknown[] = [];
    const details: Record<string, unknown> = { ...metadata, schemaVersion: 2, reportRef: report.reportRef, expiresAt: report.expiresAt, view, total: rows.length, rows: selected, nextCursor: null, sourceChecks: 0, evidenceCoverage: report.coverage };
    let end = offset;
    for (; end < rows.length && selected.length < limit; end++) {
      selected.push(rows[end]); details.nextCursor = end + 1 < rows.length ? this.cursor(report, selector, end + 1) : null;
      try { evidenceResult({ ...details, sourceChecks: EVIDENCE_LIMITS.pageRows * 2 }); } catch { selected.pop(); break; }
    }
    if (end < rows.length && !selected.length) throw new Error("evidence_response_limit");
    details.nextCursor = end < rows.length ? this.cursor(report, selector, end) : null;
    const selectedEvents = view === "leads" ? (selected as Lead[]).map(lead => report.events.find(e => e.eventRef === lead.eventRef)!) : selected as EvidencePacket[];
    return { details, selectedEvents };
  }
  scanPage(report: StoredReport, metadata: Record<string, unknown>, limit = 3) {
    return evidenceResult(this.page(report, { reportRef: report.reportRef, view: "leads", limit }, metadata).details);
  }
  async query(params: QueryParams, scope: object | string, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("evidence_query_cancelled");
    const report = this.get(params.reportRef, scope);
    if (params.release) { this.retire(report.reportRef, "expired_report"); return evidenceResult({ status: "released" }); }
    const { details, selectedEvents } = this.page(report, params);
    const refs = new Set(selectedEvents.flatMap(e => [e.provenance.sourceRef, ...(e.call ? [e.call.locator.sourceRef] : []), ...(e.context ?? []).map(c => c.provenance.sourceRef)]));
    for (const ref of refs) {
      if (signal?.aborted) throw new Error("evidence_query_cancelled");
      const source = report.sources.get(ref);
      let valid = false;
      try { valid = Boolean(source && !source.changed && source.fingerprint && JSON.stringify(sourceFingerprint(await stat(source.path))) === JSON.stringify(source.fingerprint)); } catch { /* Private paths/errors never escape. */ }
      if (!valid) { this.retire(report.reportRef, "stale_source"); throw new Error("stale_source"); }
    }
    // A release/shutdown/expiry may race the asynchronous stat checks.
    this.get(params.reportRef, scope);
    if (signal?.aborted) throw new Error("evidence_query_cancelled");
    details.sourceChecks = refs.size;
    return evidenceResult(details);
  }
}
