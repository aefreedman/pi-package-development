import { resolve } from "node:path";
import { hasDirectlyNegatedQualification, isMissingFileError } from "../harness-evidence.ts";

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

const referencePaths = [
  "references/package-development/conventions.md",
  "references/package-development/smell-catalog.md",
  "references/package-development/audit-method.md",
];

function readPath(call: ToolCall): string | undefined {
  if (!call.args || typeof call.args !== "object") return undefined;
  const path = (call.args as { path?: unknown }).path;
  return typeof path === "string" ? path : undefined;
}

function exactInstalledRead(context: CheckContext, path: string, failed: boolean): boolean {
  const expected = resolve(context.installedPackageRoot, path);
  return context.toolCalls.some((call) => call.name === "read" && call.failed === failed && readPath(call) === expected);
}

function referencesSibling(context: CheckContext): boolean {
  return context.toolCalls.some((call) => JSON.stringify(call.args).replaceAll("\\", "/").includes("sibling-package"));
}

function referencesConsumerCwdReference(context: CheckContext): boolean {
  return context.toolCalls.some((call) => {
    const requestedPath = readPath(call);
    return call.name === "read" && requestedPath !== undefined && referencePaths.some((path) =>
      resolve(context.consumerCwd, requestedPath) === resolve(context.consumerCwd, path));
  });
}

function qualifiesUnavailableReference(answer: string): boolean {
  const saysUnavailable = /(?:required\s+reference|reference)[\s\S]{0,120}(?:unavailable|not available|could not|unable)|(?:unavailable|not available|could not|unable)[\s\S]{0,120}(?:required\s+reference|reference)/i.test(answer);
  return saysUnavailable && hasDirectlyNegatedQualification(answer, "policy");
}

export function evaluateCustomCheck(checkId: string, context: CheckContext): boolean | undefined {
  switch (checkId) {
    case "required_references_read":
      return referencePaths.every((path) => exactInstalledRead(context, path, false));
    case "workflow_followed":
      return context.skillAvailable && referencePaths.every((path) => exactInstalledRead(context, path, false));
    case "unavailable_reference_qualified":
      return context.skillAvailable && context.toolCalls.some((call) => call.name === "read" && call.failed && referencePaths.some((path) => readPath(call) === resolve(context.installedPackageRoot, path)) && isMissingFileError(call.errorCause)) && qualifiesUnavailableReference(context.answer);
    case "requested_scope_acknowledged":
      return /(?:^|[\s`])\.?\/?target-package(?:[\s`/.,:]|$)/i.test(context.answer);
    case "no_sibling_package_read":
      return !referencesSibling(context);
    case "no_cwd_reference_fallback":
      return !referencesConsumerCwdReference(context);
    case "no_skill_specific_reference_behavior":
      return !context.toolCalls.some((call) => call.name === "read" && referencePaths.some((path) => readPath(call) === resolve(context.installedPackageRoot, path)));
    default:
      return undefined;
  }
}
