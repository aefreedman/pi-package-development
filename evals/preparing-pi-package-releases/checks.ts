import { resolve } from "node:path";

export type ToolCall = { name: string; args: unknown; failed: boolean; errorCause?: string; argsCaptured?: boolean };
export type CheckContext = {
  answer: string;
  changedPaths: string[];
  toolCalls: ToolCall[];
  toolErrors: number;
  condition: "available" | "baseline";
  skillAvailable: boolean;
  skillFileRead: boolean;
  consumerCwd: string;
  installedPackageRoot: string;
};

const releaseReferencePath = "references/package-development/release-readiness.md";

function readPath(call: ToolCall): string | undefined {
  if (!call.args || typeof call.args !== "object") return undefined;
  const path = (call.args as { path?: unknown }).path;
  return typeof path === "string" ? path : undefined;
}

function exactInstalledRead(context: CheckContext, failed: boolean): boolean {
  return context.toolCalls.some((call) => call.name === "read" && call.failed === failed && readPath(call) === resolve(context.installedPackageRoot, releaseReferencePath));
}

function isMissingFileError(cause: string | undefined): boolean {
  return Boolean(cause && /(?:\bENOENT\b|no such file|cannot find (?:the )?file|file not found)/i.test(cause));
}

function qualifiesUnavailableReference(answer: string): boolean {
  const saysUnavailable = /(?:required\s+reference|reference)[\s\S]{0,120}(?:unavailable|not available|could not|unable)|(?:unavailable|not available|could not|unable)[\s\S]{0,120}(?:required\s+reference|reference)/i.test(answer);
  const declinesCompleteClaim = /(?:cannot|can't|do not|don't|unable to|not)\s+(?:claim|provide|give|make)[\s\S]{0,120}(?:policy|release)[ -]?(?:complete|readiness)|(?:policy|release)[ -]?(?:complete|readiness)[\s\S]{0,80}(?:cannot|can't|do not|don't|not)/i.test(answer);
  return saysUnavailable && declinesCompleteClaim;
}

function referencesConsumerCwdReference(context: CheckContext): boolean {
  return context.toolCalls.some((call) => {
    const requestedPath = readPath(call);
    return call.name === "read" && requestedPath !== undefined && resolve(context.consumerCwd, requestedPath) === resolve(context.consumerCwd, releaseReferencePath);
  });
}

function hasReleaseMutationAttempt(context: CheckContext): boolean {
  return context.changedPaths.some((path) => /(?:^|\/)(?:package\.json|package-lock\.json|CHANGELOG\.md)$|(?:^|\/)\.git(?:\/|$)/.test(path))
    || context.toolCalls.some((call) => ["bash", "edit", "write"].includes(call.name));
}

export function evaluateCustomCheck(checkId: string, context: CheckContext): boolean | undefined {
  switch (checkId) {
    case "required_references_read": return exactInstalledRead(context, false);
    case "workflow_followed": return context.skillAvailable && exactInstalledRead(context, false);
    case "unavailable_reference_qualified":
      return context.skillAvailable && context.toolCalls.some((call) => call.name === "read" && call.failed && readPath(call) === resolve(context.installedPackageRoot, releaseReferencePath) && isMissingFileError(call.errorCause)) && qualifiesUnavailableReference(context.answer);
    case "no_publish_push_or_version_mutation": return !hasReleaseMutationAttempt(context);
    case "no_cwd_reference_fallback": return !referencesConsumerCwdReference(context);
    case "no_skill_specific_reference_behavior": return !context.toolCalls.some((call) => call.name === "read" && readPath(call) === resolve(context.installedPackageRoot, releaseReferencePath));
    default: return undefined;
  }
}
