import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

export const SESSION_NATIVE_BYTES = 32768;
export const SESSION_CONTENT_BYTES = 8192;
export const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const obj = (properties: Record<string, any>) => Type.Object(properties, { additionalProperties: false });
const count = Type.Integer({ minimum: 0 });
const number = Type.Number();
const nullableNumber = Type.Union([number, Type.Null()]);
const text = (maxLength: number) => Type.String({ maxLength });
const enumOf = (values: string[]) => Type.Union(values.map(value => Type.Literal(value)));
const ref = Type.String({ pattern: "^[a-z]_[a-f0-9]{24}$", minLength: 26, maxLength: 26 });
const opt = Type.Optional;
const nullableRef = Type.Union([ref, Type.Null()]);
const label = enumOf(["read", "edit", "write", "bash", "powershell", "grep", "find", "ls", "pi_analyze_session", "pi_query_session", "skill_eval_bootstrap", "skill_eval_review", "codecks_card_search", "codecks_card_get", "codecks_card_bulk_create", "codecks_card_update"]);
const counts = (keys: string[]) => obj(Object.fromEntries(keys.map(key => [key, count])));
const locator = obj({ sourceRef: ref, sessionRef: ref, lineageRef: ref, entryRef: ref, parentRef: nullableRef, line: count, time: nullableNumber, selected: Type.Boolean(), duplicate: Type.Boolean() });
const fields = Type.Array(obj({ fieldRef: ref, type: enumOf(["null", "array", "string", "number", "boolean", "object", "undefined", "bigint", "symbol", "function"]) }), { maxItems: 8 });
const call = obj({ locator, toolRef: ref, toolLabel: opt(label), fields, omittedFields: count, block: count });
const nestedCoverage = obj({ complete: Type.Union([Type.Boolean(), Type.Null()]), recordedCalls: Type.Union([count, Type.Null()]), processedCalls: count, omittedCalls: count, malformedRecords: count, incomplete: Type.Boolean() });
const event = obj({ eventRef: ref, kind: enumOf(["nested_tool_call", "tool_result", "tool_call", "user_message", "assistant_error", "assistant_aborted"]), provenance: locator, toolRef: opt(ref), toolLabel: opt(label), call: opt(call),
  outcome: opt(obj({ failed: Type.Boolean(), nativeOutcome: enumOf(["success", "failure", "unknown"]), semanticOutcome: enumOf(["success", "failure", "unknown", "not-applicable"]), source: enumOf(["native", "structured", "text_fallback", "none"]), heuristicLead: Type.Boolean() })),
  context: opt(Type.Array(obj({ provenance: locator, role: enumOf(["user", "assistant", "toolResult", "other"]) }), { maxItems: 2 })),
  join: opt(enumOf(["native_id_ancestry", "legacy_name_ancestry", "unresolved"])), messageObservedSpanMs: opt(nullableNumber), nestedCoverage: opt(nestedCoverage),
  nested: opt(obj({ position: count, status: enumOf(["ok", "error", "unfinished", "unknown"]), durationMs: nullableNumber, errorRecorded: Type.Union([Type.Boolean(), Type.Null()]), argumentsState: enumOf(["present", "omitted", "unknown"]), fields, omittedFields: count, metadataValid: Type.Boolean() })) });
const lead = obj({ leadRef: ref, toolRef: opt(ref), toolLabel: opt(label), signature: enumOf(["nested_metadata_failure", "assistant_error", "assistant_aborted", "unverified_text_signature", ...["success", "failure", "unknown"].flatMap(native => ["success", "failure", "unknown", "not-applicable"].map(semantic => `typed_failure:${native}:${semantic}`))]), judgment: Type.Literal("unreviewed"), indexedEvents: count, indexedSessions: count, indexedLineages: count, eventRef: ref });
const coverage = obj({ analysisIncomplete: Type.Boolean(), ...Object.fromEntries(["observedEvents", "indexedEvents", "omittedEvents", "indexedLeads", "accountedIndexBytes"].map(key => [key, count])) });
const common = { schemaVersion: Type.Literal(2), reportRef: ref, expiresAt: number, sourceChecks: count, evidenceCoverage: coverage };
const page = { ...common, total: count, returned: count, omitted: count, nextCursor: Type.Union([Type.String({ maxLength: 48, pattern: "^[0-9]+\\.[a-f0-9]{24}$" }), Type.Null()]) };
const corpus = obj({ ...Object.fromEntries(["discoveredFiles", "processedFiles", "logicalSessions", "unsupportedFiles", "entriesVisited", "candidatesSeen", "candidatesOmitted", "bytesRead", "recordsRead", "messageOccurrences", "uniqueMessages", "selectedEvents", "excludedEvents", "unknownTimestamps", "duplicateEvents", "unreadableFiles", "unreadableDirectories", "changedFiles", "truncatedFiles", "unresolvedLineage", "identityConflicts", "unsupportedRecords", "oversizedRecords", "malformedLines", "missingIdentities", "selectionUncertainty"].map(key => [key, count])), observedFirst: opt(number), observedLast: opt(number), discoveryComplete: Type.Boolean(), stopReason: opt(enumOf(["cancelled", "deadline", "byte_limit", "record_limit", "directory_limit", "discovery_deadline"])) });
const analysis = { analysisStatus: enumOf(["complete", "incomplete"]), corpus,
  eventWindow: obj({ since: number, until: number, asOf: number, clock: Type.Literal("message.timestamp then entry.timestamp; Unix milliseconds/explicit timezone") }),
  scanLimits: counts(["files", "bytes", "records", "ms", "maxNestedCallsPerResult"]), totals: counts(["toolCalls", "failures", "userMessages"]),
  extraction: obj({ ...Object.fromEntries(["processedSources", "unresolvedCalls", "unresolvedResults", "unsupportedMessages", "unknownOutcomes", "heuristicLeads", "legacyCorrelations", "assistantErrors", "assistantAborts"].map(key => [key, count])), nested: counts(["observedCalls", "failures", "unknownOutcomes", "incompleteResults", "malformedRecords", "omittedCalls"]), nativeOutcomes: obj({ success: opt(count), failure: opt(count), unknown: opt(count) }), semanticOutcomes: obj({ success: opt(count), failure: opt(count), unknown: opt(count), "not-applicable": opt(count) }) }), method: text(1500), privacy: text(600) };
const leadPage = obj({ ...page, view: Type.Literal("leads"), rows: Type.Array(lead, { maxItems: 10 }) });
const analyzeReport = obj({ ...page, ...analysis, view: Type.Literal("leads"), rows: Type.Array(lead, { maxItems: 10 }) });
const queryReport = Type.Union([leadPage, obj({ ...page, view: Type.Literal("events"), rows: Type.Array(event, { maxItems: 10 }) }), obj({ ...common, view: Type.Literal("locator"), eventRef: ref, target: enumOf(["event", "call", "context"]), contextIndex: opt(Type.Integer({ minimum: 0, maximum: 1 })), warning: text(400), locator: obj({ path: text(4096), line: count, block: opt(count), sourceRef: ref, entryRef: ref, selected: Type.Boolean(), duplicate: Type.Boolean() }) }), obj({ status: Type.Literal("released") })]);
export type SessionOperation = "pi_analyze_session" | "pi_query_session";
export const SESSION_ERROR_CODES = ["invalid_page_limit", "expired_report", "invalid_report", "invalid_report_scope", "invalid_cursor", "invalid_lead_ref", "invalid_event_or_tool_ref", "invalid_evidence_selector", "invalid_evidence_view", "invalid_locator_selector", "locator_target_unavailable", "stale_source", "evidence_query_cancelled", "evidence_response_limit", "session_operation_failed", "output_contract_error"] as const;
const effects = enumOf(["none", "memory_changed", "memory_may_have_changed"]);
export function sessionSchema(operation: SessionOperation) {
  const base = { contractVersion: Type.Literal(1), operation: Type.Literal(operation), effects };
  return Type.Union([obj({ ...base, ok: Type.Literal(true), report: operation === "pi_analyze_session" ? analyzeReport : queryReport }), obj({ ...base, ok: Type.Literal(false), error: obj({ code: enumOf([...SESSION_ERROR_CODES]), message: text(160) }) })]);
}
export function sessionEnvelope(operation: SessionOperation, report: Record<string, unknown>) {
  return { contractVersion: 1, operation, ok: true, effects: operation === "pi_analyze_session" || report.status === "released" ? "memory_changed" : "none", report };
}
export function validateSession(operation: SessionOperation, report: Record<string, unknown>) {
  const dto = sessionEnvelope(operation, report);
  if (jsonBytes(dto) > SESSION_NATIVE_BYTES) throw new Error("evidence_response_limit");
  if (!Value.Check(sessionSchema(operation), dto)) throw new Error("output_contract_error");
  return dto as NonNullable<AgentToolResult<unknown>["structuredContent"]>;
}
export function sessionFailure(operation: SessionOperation, error: unknown, memoryMayHaveChanged = false) {
  const message = error instanceof Error ? error.message : "";
  const code = SESSION_ERROR_CODES.find(code => code === message) ?? "session_operation_failed";
  const dto = { contractVersion: 1, operation, ok: false, effects: memoryMayHaveChanged ? "memory_may_have_changed" : "none", error: { code, message: code } };
  if (!Value.Check(sessionSchema(operation), dto)) throw new Error("output_contract_error");
  return { content: [{ type: "text" as const, text: code }], details: undefined, structuredContent: dto, isError: true };
}
