export type CheckContext = {
  answer: string;
  guidance: string;
  changedPaths: string[];
  toolCalls: Array<{ name: string; args: unknown }>;
  toolErrors: number;
  condition: "available" | "baseline" | "forced";
  skillLoaded: boolean;
  auditRoot: string;
};

const referencePaths = [
  "references/package-development/conventions.md",
  "references/package-development/smell-catalog.md",
  "references/package-development/audit-method.md",
];

function callsReference(context: CheckContext, path: string): boolean {
  return context.toolCalls.some((call) =>
    call.name === "read_package_reference"
    && JSON.stringify(call.args).includes("@aefree/pi-package-development")
    && JSON.stringify(call.args).replaceAll("\\", "/").includes(path),
  );
}

function referencesSibling(context: CheckContext): boolean {
  return context.toolCalls.some((call) => JSON.stringify(call.args).replaceAll("\\", "/").includes("sibling-package"));
}

function qualifiesUnavailableReference(answer: string): boolean {
  const saysUnavailable = /(?:required\s+reference|reference)[\s\S]{0,120}(?:unavailable|not available|could not|unable)|(?:unavailable|not available|could not|unable)[\s\S]{0,120}(?:required\s+reference|reference)/i.test(answer);
  const declinesCompleteClaim = /(?:cannot|can't|do not|don't|unable to|not)\s+(?:claim|provide|give|make)[\s\S]{0,120}(?:policy|convention)[ -]?(?:complete|completeness)|(?:policy|convention)[ -]?(?:complete|completeness)[\s\S]{0,80}(?:cannot|can't|do not|don't|not)/i.test(answer);
  return saysUnavailable && declinesCompleteClaim;
}

export function evaluateCustomCheck(checkId: string, context: CheckContext): boolean | undefined {
  switch (checkId) {
    case "required_audit_references_loaded":
      return referencePaths.every((path) => callsReference(context, path));
    case "requested_scope_acknowledged":
      return /(?:^|[\s`])\.?\/?target-package(?:[\s`/.,:]|$)/i.test(context.answer);
    case "no_sibling_package_read":
      return !referencesSibling(context);
    case "unavailable_reference_qualified":
      return qualifiesUnavailableReference(context.answer);
    default:
      return undefined;
  }
}
