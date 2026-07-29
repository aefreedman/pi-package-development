import { resolve } from "node:path";

export type CheckContext = {
  answer: string;
  guidance: string;
  changedPaths: string[];
  toolCalls: Array<{ name: string; args: unknown; failed: boolean }>;
  toolErrors: number;
  condition: "available" | "baseline" | "forced";
  skillLoaded: boolean;
  auditRoot: string;
  consumerCwd: string;
  installedPackageRoot: string;
};

const referencePaths = [
  "references/package-development/conventions.md",
  "references/package-development/smell-catalog.md",
  "references/package-development/audit-method.md",
];

function readPath(call: CheckContext["toolCalls"][number]): string | undefined {
  if (!call.args || typeof call.args !== "object") return undefined;
  const path = (call.args as { path?: unknown }).path;
  return typeof path === "string" ? path : undefined;
}

function callsInstalledLocalReference(context: CheckContext, path: string, failed: boolean): boolean {
  const stagedReference = resolve(context.installedPackageRoot, path);
  return context.toolCalls.some((call) =>
    call.name === "read"
    && call.failed === failed
    && (() => {
      const requestedPath = readPath(call);
      return requestedPath !== undefined && resolve(context.consumerCwd, requestedPath) === stagedReference;
    })(),
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
    case "required_local_audit_references_loaded":
      return referencePaths.every((path) => callsInstalledLocalReference(context, path, false));
    case "unavailable_local_reference_qualified":
      return referencePaths.some((path) => callsInstalledLocalReference(context, path, true)) && qualifiesUnavailableReference(context.answer);
    case "requested_scope_acknowledged":
      return /(?:^|[\s`])\.?\/?target-package(?:[\s`/.,:]|$)/i.test(context.answer);
    case "no_sibling_package_read":
      return !referencesSibling(context);
    default:
      return undefined;
  }
}
