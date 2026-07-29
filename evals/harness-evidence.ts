import { isAbsolute, relative, resolve } from "node:path";

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

export function isMissingFileError(cause: string | undefined): boolean {
  return Boolean(cause && /(?:\bENOENT\b|no such file|cannot find (?:the )?file|file not found)/i.test(cause));
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
    const allowedConsumerProbe = path !== undefined && allowedMissingConsumerRoots.some(({ consumerCwd, targetRoot }) => isSafePathWithinRoot(path, consumerCwd, targetRoot));
    return call.name !== "read" || path === undefined || !isMissingFileError(call.errorCause)
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
