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
  consumerTargetRoot: string;
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

function qualifiesUnavailableReference(answer: string): boolean {
  const saysUnavailable = /(?:required\s+reference|reference)[\s\S]{0,120}(?:unavailable|not available|could not|unable)|(?:unavailable|not available|could not|unable)[\s\S]{0,120}(?:required\s+reference|reference)/i.test(answer);
  return saysUnavailable && hasDirectlyNegatedQualification(answer, "release");
}

function referencesConsumerCwdReference(context: CheckContext): boolean {
  return context.toolCalls.some((call) => {
    const requestedPath = readPath(call);
    return call.name === "read" && requestedPath !== undefined && resolve(context.consumerCwd, requestedPath) === resolve(context.consumerCwd, releaseReferencePath);
  });
}

function exactTargetRead(context: CheckContext, targetRelativePath: string): boolean {
  const expected = resolve(context.consumerTargetRoot, targetRelativePath);
  return context.toolCalls.some((call) => {
    const requestedPath = readPath(call);
    return call.name === "read" && !call.failed && requestedPath !== undefined && resolve(context.consumerCwd, requestedPath) === expected;
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
      return context.skillAvailable && context.toolCalls.some((call) => call.name === "read" && call.failed && readPath(call) === resolve(context.installedPackageRoot, releaseReferencePath) && isMissingFileError(call.errorCause, readPath(call))) && qualifiesUnavailableReference(context.answer);
    case "no_publish_push_or_version_mutation": return !hasReleaseMutationAttempt(context);
    case "dry_run_auth_qualified":
      return /dry[- ]run/i.test(context.answer)
        && /(?:does not|doesn't|cannot|can't|not)\s+(?:prove|verify|validate|exercise|confirm)/i.test(context.answer)
        && /(?:OIDC|trusted publish|authentication|provenance)/i.test(context.answer);
    case "partial_release_reconciliation":
      return /gitHead/i.test(context.answer)
        && /(?:tag|GitHub release)/i.test(context.answer)
        && /(?:match|same|expected)\s+(?:commit|identity)|(?:commit|identity)[\s\S]{0,60}(?:match|same|expected)/i.test(context.answer)
        && /(?:skip|without|do not|don't|must not|never)[\s\S]{0,80}(?:republish|publish again|move.*tag|overwrite)/i.test(context.answer);
    case "repository_tarball_distinguished":
      return exactTargetRead(context, "package.json")
        && /(?:GitHub|public repository|repository tree)/i.test(context.answer)
        && /(?:npm tarball|packed artifact|consumer artifact)/i.test(context.answer)
        && /(?:separate|different|repository-only|does not automatically belong|exclude from the tarball)/i.test(context.answer);
    case "consumer_content_classified":
      return exactTargetRead(context, "package.json")
        && /consumer/i.test(context.answer)
        && /(?:purpose|runtime|public API|loaded resource|legal|user documentation|debugging)/i.test(context.answer)
        && /(?:keep|exclude|include|pack|tarball)/i.test(context.answer);
    case "initial_release_narrative_checked":
      return exactTargetRead(context, "CHANGELOG.md")
        && /(?:initial|first public|never been published)/i.test(context.answer)
        && /changelog/i.test(context.answer)
        && /(?:renam|remov|legacy|hard[- ]cut|migration|compatibility alias)/i.test(context.answer)
        && /(?:rewrite|unpublished|not public|invent|should not|misleading)/i.test(context.answer);
    case "local_link_lock_detected":
      return exactTargetRead(context, "package-lock.json")
        && /(?:package-lock|lockfile)/i.test(context.answer)
        && /(?:link\s*[:=]?\s*true|local link|non-registry resolution|relative[^\n]{0,60}resolved|sibling path)/i.test(context.answer)
        && /(?:npm ci|isolated|registry|regenerate)/i.test(context.answer);
    case "transient_release_doc_detected":
      return exactTargetRead(context, "RELEASING.md")
        && /(?:RELEASING\.md|release (?:guide|document|notes))/i.test(context.answer)
        && /(?:one-time|one-off|bootstrap|transient|not durable|current release only)/i.test(context.answer)
        && /(?:remove|exclude|do not retain|should not remain)/i.test(context.answer);
    case "intentional_consumer_asset_preserved":
      return exactTargetRead(context, "package.json")
        && exactTargetRead(context, "README.md")
        && /fixture/i.test(context.answer)
        && /(?:export|public API|consumer contract|downstream)/i.test(context.answer)
        && /(?:keep|include|ship|do not remove|should not remove|not exclude)/i.test(context.answer);
    case "no_cwd_reference_fallback": return !referencesConsumerCwdReference(context);
    case "no_skill_specific_reference_behavior": return !context.toolCalls.some((call) => call.name === "read" && readPath(call) === resolve(context.installedPackageRoot, releaseReferencePath));
    default: return undefined;
  }
}
