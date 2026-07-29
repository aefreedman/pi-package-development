export type CheckContext = {
  answer: string;
  guidance: string;
  changedPaths: string[];
  toolCalls: Array<{ name: string; args: unknown; failed: boolean }>;
  toolErrors: number;
  condition: "available" | "baseline" | "forced";
  skillLoaded: boolean;
  auditRoot: string;
};

function callsLocalReleaseReference(context: CheckContext): boolean {
  return context.toolCalls.some((call) =>
    call.name === "read"
    && JSON.stringify(call.args).replaceAll("\\", "/").includes("references/package-development/release-readiness.md"),
  );
}

function failedLocalReleaseReferenceRead(context: CheckContext): boolean {
  return context.toolCalls.some((call) =>
    call.failed
    && call.name === "read"
    && JSON.stringify(call.args).replaceAll("\\", "/").includes("references/package-development/release-readiness.md"),
  );
}

function qualifiesUnavailableReference(answer: string): boolean {
  const saysUnavailable = /(?:required\s+reference|reference)[\s\S]{0,120}(?:unavailable|not available|could not|unable)|(?:unavailable|not available|could not|unable)[\s\S]{0,120}(?:required\s+reference|reference)/i.test(answer);
  const declinesCompleteClaim = /(?:cannot|can't|do not|don't|unable to|not)\s+(?:claim|provide|give|make)[\s\S]{0,120}(?:policy|release)[ -]?(?:complete|readiness)|(?:policy|release)[ -]?(?:complete|readiness)[\s\S]{0,80}(?:cannot|can't|do not|don't|not)/i.test(answer);
  return saysUnavailable && declinesCompleteClaim;
}

function hasReleaseMutationAttempt(context: CheckContext): boolean {
  return context.changedPaths.some((path) => /(?:^|\/)(?:package\.json|package-lock\.json|CHANGELOG\.md)$|(?:^|\/)\.git(?:\/|$)/.test(path))
    || context.toolCalls.some((call) => ["bash", "edit", "write"].includes(call.name));
}

export function evaluateCustomCheck(checkId: string, context: CheckContext): boolean | undefined {
  switch (checkId) {
    case "required_local_release_reference_loaded":
      return callsLocalReleaseReference(context);
    case "unavailable_local_reference_qualified":
      return failedLocalReleaseReferenceRead(context) && qualifiesUnavailableReference(context.answer);
    case "no_publish_push_or_version_mutation":
      return !hasReleaseMutationAttempt(context);
    default:
      return undefined;
  }
}
