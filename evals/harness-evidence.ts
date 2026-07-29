import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export type ObservedToolCall = {
  id: string;
  name: string;
  args: unknown;
  argsCaptured: boolean;
  failed: boolean;
  errorCause?: string;
  ended: boolean;
};

function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Preserve tool arguments and failed-read causes; optional diagnostics are bounded elsewhere. */
export function collectToolCalls(events: any[]): ObservedToolCall[] {
  const calls = new Map<string, ObservedToolCall>();
  for (const event of events) {
    if (event?.type === "tool_execution_start" && typeof event.toolCallId === "string") {
      calls.set(event.toolCallId, { id: event.toolCallId, name: String(event.toolName ?? ""), args: event.args, argsCaptured: Object.hasOwn(event, "args"), failed: false, ended: false });
    }
    if (event?.type === "tool_execution_end" && typeof event.toolCallId === "string") {
      const call = calls.get(event.toolCallId);
      if (!call) continue;
      call.ended = true;
      call.failed = Boolean(event.isError);
      if (call.failed) call.errorCause = stringify(event.error ?? event.result?.error ?? event.result ?? event.content ?? event.message);
    }
  }
  return [...calls.values()];
}

export function hasCompleteMandatoryEvidence(toolCalls: ObservedToolCall[], finalAssistant: any): boolean {
  return Boolean(finalAssistant && finalAssistant.role === "assistant" && Array.isArray(finalAssistant.content))
    && toolCalls.every((call) => call.argsCaptured && call.ended && (!call.failed || Boolean(call.errorCause)));
}

function missingFileMessage(message: string, path: string): boolean {
  const quotedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // This is the native Node read/access error shape. Do not accept appended diagnostics.
  return new RegExp(`^(?:Error:\\s*)?ENOENT: no such file(?: or directory)?, (?:open|access|stat|lstat) ['\"]${quotedPath}['\"]$`, "i").test(message.trim());
}

/**
 * Accept only the native read-tool ENOENT outcome for the requested path. The harness records
 * tool results as serialized JSON, so inspect its complete, known result shapes rather than
 * searching arbitrary diagnostic text.
 */
export function isMissingFileError(cause: string | undefined, requestedPath?: string): boolean {
  if (!cause?.trim() || !requestedPath) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(cause); } catch { return missingFileMessage(cause, requestedPath); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

  const result = parsed as Record<string, unknown>;
  // Pi's native tool result is one text content item, optionally with its exact empty details object.
  // Extra fields/items can carry unrelated errors.
  const keys = Object.keys(result);
  const hasOnlyContent = keys.length === 1 && keys[0] === "content";
  const hasContentAndEmptyDetails = keys.length === 2
    && keys.includes("content")
    && keys.includes("details")
    && !!result.details
    && typeof result.details === "object"
    && !Array.isArray(result.details)
    && Object.keys(result.details as Record<string, unknown>).length === 0;
  if ((!hasOnlyContent && !hasContentAndEmptyDetails) || !Array.isArray(result.content) || result.content.length !== 1) return false;
  const [content] = result.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return false;
  const textPart = content as Record<string, unknown>;
  return Object.keys(textPart).length === 2
    && textPart.type === "text"
    && typeof textPart.text === "string"
    && missingFileMessage(textPart.text, requestedPath);
}

/** Reject links in staged inputs so lexical target containment cannot be redirected outside it. */
export async function assertNoSymlinks(root: string): Promise<void> {
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink()) throw new Error(`Staged fixture contains a symlink or junction: ${root}`);
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Staged fixture contains a symlink or junction: ${path}`);
    if (entry.isDirectory()) await assertNoSymlinks(path);
  }
}

export function hasDirectlyNegatedQualification(answer: string, subject: "policy" | "release"): boolean {
  const concept = subject === "policy"
    ? "(?:policy|convention)[ -]?(?:complete|completeness)"
    : "(?:release[- ]?(?:ready|readiness)|ready for release)";
  const negated = new RegExp(`\\b(?:cannot|can't|unable to|will not|do not|don't)\\s+(?:\\w+\\s+){0,5}(?:claim|provide|give|make|confirm|conclude|state|assert)\\s+(?:\\w+\\s+){0,8}${concept}\\b|\\bnot\\s+(?:an?\\s+)?${concept}\\b|\\b${concept}\\b\\s+(?:is|are|was|were|remains)?\\s*not\\s+(?:confirmed|established|complete|demonstrated|claimed)\\b`, "i");
  const affirmative = new RegExp(`\\b(?:can|may|will)\\s+(?:\\w+\\s+){0,5}(?:claim|provide|give|make|confirm|conclude|state|assert)\\s+(?:\\w+\\s+){0,8}${concept}\\b|\\b(?:it|this|the)\\s+(?:audit|assessment|package|release)?\\s*(?:is|are|was|were|remains|appears)\\s+(?:an?\\s+)?${concept}\\b|\\b${concept}\\b\\s+(?:is|are|was|were|remains)\\s+(?:confirmed|established|complete|demonstrated)\\b`, "i");
  return negated.test(answer) && !affirmative.test(answer);
}

function readPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? path : undefined;
}

function isSafePathWithinRoot(path: string, consumerCwd: string, root: string): boolean {
  if (!path.trim() || path.includes("\0") || path.split(/[\\/]/).includes("..")) return false;
  const resolved = resolve(consumerCwd, path);
  const relation = relative(root, resolved);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

/**
 * Counts failures other than narrowly expected missing reads. Unavailable references must
 * be exact staged paths; ordinary optional-file probes may be ENOENT only within a case's
 * explicitly scoped consumer target root.
 */
export function countUnexpectedToolErrors(toolCalls: Pick<ObservedToolCall, "name" | "args" | "failed" | "errorCause">[], allowedMissingReferencePaths: string[], allowedMissingConsumerRoots: { consumerCwd: string; targetRoot: string }[] = []): number {
  return toolCalls.filter((call) => {
    if (!call.failed) return false;
    const path = readPath(call.args);
    const allowedUnavailableReference = path !== undefined && allowedMissingReferencePaths.includes(path);
    const consumerRoot = path === undefined ? undefined : allowedMissingConsumerRoots.find(({ consumerCwd, targetRoot }) => isSafePathWithinRoot(path, consumerCwd, targetRoot));
    const allowedConsumerProbe = consumerRoot !== undefined;
    const requestedPath = consumerRoot && path !== undefined ? resolve(consumerRoot.consumerCwd, path) : path;
    return call.name !== "read" || requestedPath === undefined || !isMissingFileError(call.errorCause, requestedPath)
      || (!allowedUnavailableReference && !allowedConsumerProbe);
  }).length;
}

/** Gives the timer a single, explicit owner and prevents it terminating an already closed child. */
export function createTerminationController(terminate: () => Promise<void>) {
  let closed = false;
  let timedOut = false;
  let terminationRequested = false;
  let termination: Promise<void> | undefined;
  return {
    onTimeout() {
      if (closed) return;
      timedOut = true;
      terminationRequested = true;
      termination ??= terminate();
    },
    onClose() { closed = true; },
    async waitForTermination() { await termination; },
    state() { return { timedOut, terminationRequested }; },
  };
}
