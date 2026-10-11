import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { relative } from "node:path";
import type { BootstrapResult, BootstrapObservation } from "./skill-evals/bootstrap.js";
import type { ReviewResult } from "./skill-evals/review.js";

export const EVAL_NATIVE_BYTES = 32768;
export const EVAL_CONTENT_BYTES = 8192;
const obj = (fields: Record<string, any>) => Type.Object(fields, { additionalProperties: false });
const str = (maxLength: number) => Type.String({ maxLength });
const count = Type.Integer({ minimum: 0 });
const choice = (values: string[]) => Type.Union(values.map(value => Type.Literal(value)));
const path = Type.String({ maxLength: 4096, minLength: 1, pattern: "^(?!/|[A-Za-z]:|.*(?:^|/)\\.\\.(?:/|$)).+$" });
const stageNames = ["lock", "staging", "packageJson", "gitignore", "evalDirectory", "rollback", "cleanup"] as const;
const state = choice(["not_started", "started", "completed", "failed"]);
const effectsSchema = obj({ state: choice(["none", "not_dispatched", "completed", "may_have_changed", "rolled_back"]), stages: obj(Object.fromEntries(stageNames.map(name => [name, state]))), changedReferences: Type.Array(path, { maxItems: 3 }), referencesOmitted: Type.Boolean() });
export type EvalEffects = { state: "none" | "not_dispatched" | "completed" | "may_have_changed" | "rolled_back"; stages: Record<typeof stageNames[number], "not_started" | "started" | "completed" | "failed">; changedReferences: string[]; referencesOmitted: boolean };
export function evalEffects(): EvalEffects { return { state: "not_dispatched", stages: Object.fromEntries(stageNames.map(name => [name, "not_started"])) as EvalEffects["stages"], changedReferences: [], referencesOmitted: false }; }
export function observeEffects(effects: EvalEffects, event: BootstrapObservation) {
  effects.stages[event.stage] = event.state;
  effects.state = "may_have_changed";
  if (event.state === "completed" && event.reference && !effects.changedReferences.includes(event.reference)) effects.changedReferences.push(event.reference);
  if (event.stage === "rollback" && event.state === "completed") effects.state = "rolled_back";
}
const summary = obj(Object.fromEntries(["errors", "warnings", "infos", "cases", "positiveCases", "negativeCases"].map(key => [key, count])));
const review = obj({ evalPath: path, summary, total: count, returned: count, omitted: count, findings: Type.Array(obj({ level: choice(["error", "warning", "info"]), ruleId: str(80), message: str(256), path: Type.Optional(path) }), { maxItems: 100 }) });
const bootstrap = obj({ mode: choice(["preview", "apply"]), evalName: str(64), plannedFiles: Type.Array(path, { maxItems: 46 }), packageScript: str(160), scriptCommand: str(160), caseCounts: obj({ positive: count, negative: count }) });
export type EvalOperation = "skill_eval_review" | "skill_eval_bootstrap";
export function evalSchema(operation: EvalOperation) {
  const base = { contractVersion: Type.Literal(1), operation: Type.Literal(operation), effects: effectsSchema };
  return Type.Union([obj({ ...base, ok: Type.Literal(true), result: operation === "skill_eval_review" ? review : bootstrap }), obj({ ...base, ok: Type.Literal(false), error: obj({ code: choice(["operation_failed", "confirmation_required", "not_confirmed", "output_contract_error"]), message: str(160) }) })]);
}
export function reviewProjection(result: ReviewResult) {
  const findings = result.findings.slice(0, 100).map(finding => ({ level: finding.level, ruleId: finding.ruleId,
    // Dynamic findings contain config, parse errors or case labels. Do not publish those values.
    message: /^(config\.(invalid|skill-escape|skill-missing|extension-escape|extension-missing)|cases\.(invalid|id|duplicate-id|prompt|trigger|prompt-kind|prompt-kind-invalid|prompt-kind-trigger|criteria|fixture|fixture-escape|fixture-missing))$/.test(finding.ruleId)
      ? `Review ${finding.ruleId}: inspect the local eval input.` : finding.message.slice(0, 256),
    ...(finding.path ? { path: finding.path } : {}) }));
  return { evalPath: relative(result.packageRoot, result.evalDirectory).replaceAll("\\", "/"), summary: result.summary, total: result.findings.length, returned: findings.length, omitted: result.findings.length - findings.length, findings };
}
export function bootstrapProjection(result: BootstrapResult) { return { mode: result.mode, evalName: result.evalName, plannedFiles: result.plannedFiles, packageScript: result.packageScript, scriptCommand: `node --experimental-strip-types evals/${result.evalName}/run-eval.ts`, caseCounts: result.caseCounts }; }
export function evalSuccess(operation: EvalOperation, result: unknown, effects: EvalEffects) {
  const dto = { contractVersion: 1, operation, ok: true, effects, result };
  if (Buffer.byteLength(JSON.stringify(dto)) > EVAL_NATIVE_BYTES || !Value.Check(evalSchema(operation), dto)) throw new Error("output_contract_error");
  let display: any = result;
  if (operation === "skill_eval_review") {
    display = { ...(result as object), findings: (result as any).findings.slice(0, 50), presentationOmittedFindings: (result as any).total - Math.min((result as any).returned, 50) };
    while (Buffer.byteLength(JSON.stringify(display)) > EVAL_CONTENT_BYTES && display.findings.length) { display.findings.pop(); display.presentationOmittedFindings++; }
  }
  if (operation === "skill_eval_bootstrap") {
    display = { ...(result as object), plannedFiles: [...(result as any).plannedFiles], presentationOmittedFiles: 0 };
    while (Buffer.byteLength(JSON.stringify(display)) > EVAL_CONTENT_BYTES && display.plannedFiles.length) { display.plannedFiles.pop(); display.presentationOmittedFiles++; }
  }
  const text = JSON.stringify(display);
  if (Buffer.byteLength(text) > EVAL_CONTENT_BYTES) throw new Error("output_contract_error");
  return { content: [{ type: "text" as const, text }], details: result, structuredContent: dto as NonNullable<AgentToolResult<unknown>["structuredContent"]> };
}
export function evalFailure(operation: EvalOperation, error: unknown, effects: EvalEffects) {
  const code = error instanceof Error && ["confirmation_required", "not_confirmed", "output_contract_error"].includes(error.message) ? error.message : "operation_failed";
  const dto = { contractVersion: 1, operation, ok: false, effects, error: { code, message: code } };
  // If references cannot be safely admitted, withhold them rather than substitute; keep effects uncertain.
  if (Buffer.byteLength(JSON.stringify(dto)) > EVAL_NATIVE_BYTES || !Value.Check(evalSchema(operation), dto)) { effects.changedReferences = []; effects.referencesOmitted = true; effects.state = "may_have_changed"; }
  if (!Value.Check(evalSchema(operation), dto)) throw new Error("output_contract_error");
  return { content: [{ type: "text" as const, text: code }], details: undefined, structuredContent: dto, isError: true };
}
