import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join, relative } from "node:path";
import { bootstrapSkillEval, type StarterCaseInput } from "./skill-evals/bootstrap.js";
import { resolveExistingWithin } from "./skill-evals/path-safety.js";
import { reviewSkillEval } from "./skill-evals/review.js";

const starterCaseFields = {
  id: Type.String({ description: "Stable lowercase case id, for example audit_legacy_guidance" }),
  prompt: Type.String({ minLength: 1 }),
  fixture: Type.Optional(Type.String({ description: "Fixture directory name; defaults to starter" })),
  expectedChecks: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
};
const positiveCaseSchema = Type.Object({
  ...starterCaseFields,
  promptKind: Type.Union([
    Type.Literal("explicit"),
    Type.Literal("implicit"),
    Type.Literal("contextual"),
  ], { description: "How the relevant prompt asks for the skill behavior" }),
});

function formatBootstrap(result: Awaited<ReturnType<typeof bootstrapSkillEval>>): string {
  const lines = [
    `Skill eval bootstrap: ${result.mode}`,
    `Package: ${result.packageRoot}`,
    `Skill: ${result.skillPath}`,
    `Eval: ${result.evalName}`,
    `Cases: ${result.caseCounts.positive} positive, ${result.caseCounts.negative} negative`,
    `Package script: ${result.packageScript}`,
    "Files:",
    ...result.plannedFiles.map((path) => `- ${path}`),
  ];
  if (result.mode === "preview") lines.push("No files changed. Review this preview before applying.");
  return lines.join("\n");
}

function formatReview(result: Awaited<ReturnType<typeof reviewSkillEval>>): string {
  const lines = [
    `Skill eval review: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.infos} info`,
    `Cases: ${result.summary.cases} total (${result.summary.positiveCases} positive, ${result.summary.negativeCases} negative)`,
    `Eval: ${relative(result.packageRoot, result.evalDirectory).replaceAll("\\", "/")}`,
  ];
  for (const finding of result.findings.slice(0, 50)) {
    lines.push(`- ${finding.level.toUpperCase()} ${finding.ruleId}${finding.path ? ` [${finding.path}]` : ""}: ${finding.message}`);
  }
  if (result.findings.length > 50) lines.push(`- ${result.findings.length - 50} additional findings omitted`);
  return lines.join("\n");
}

export function registerSkillEvals(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "skill_eval_bootstrap",
    label: "Bootstrap Skill Eval",
    description: "Preview or create a package-owned behavioral eval starter for one Pi skill. Requires real positive and negative prompt examples. Preview is the default; apply writes only after explicit user authorization.",
    promptSnippet: "Preview or scaffold package-owned behavioral eval files for a Pi skill",
    promptGuidelines: [
      "Use skill_eval_bootstrap in preview mode before apply, and apply only when the user explicitly requested creation after reviewing the target skill and real failure examples.",
      "Keep generated evals in the target package; do not centralize target-package cases, fixtures, checks, or results in pi-package-development.",
    ],
    parameters: Type.Object({
      targetPackagePath: Type.Optional(Type.String({ description: "Package path relative to the current workspace; defaults to current directory" })),
      skillPath: Type.String({ description: "Target SKILL.md path relative to the target package" }),
      evalName: Type.Optional(Type.String()),
      positiveCases: Type.Array(positiveCaseSchema, { minItems: 1, maxItems: 20 }),
      negativeCases: Type.Array(starterCaseFields, { minItems: 1, maxItems: 20 }),
      extensionPaths: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
      allowExtensionExecution: Type.Optional(Type.Boolean({ description: "Must be explicitly true when generated evals load target-package extensions, which execute with host permissions" })),
      tools: Type.Optional(Type.Array(Type.String(), { maxItems: 30 })),
      allowHostMutation: Type.Optional(Type.Boolean({ description: "Must be explicitly true when bash, edit, or write is enabled; Pi tools are not sandboxed to the fixture" })),
      mode: Type.Optional(Type.Union([Type.Literal("preview"), Type.Literal("apply")], { default: "preview" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const options = {
        workspaceRoot: ctx.cwd,
        targetPackagePath: params.targetPackagePath,
        skillPath: params.skillPath,
        evalName: params.evalName,
        positiveCases: params.positiveCases as StarterCaseInput[],
        negativeCases: params.negativeCases as StarterCaseInput[],
        extensionPaths: params.extensionPaths,
        allowExtensionExecution: params.allowExtensionExecution,
        tools: params.tools,
        allowHostMutation: params.allowHostMutation,
        mode: params.mode ?? "preview",
      } as const;
      let result;
      if (options.mode === "apply") {
        if (!ctx.hasUI) throw new Error("skill_eval_bootstrap apply requires an interactive/RPC confirmation; use preview in noninteractive mode");
        const packageRoot = await resolveExistingWithin(ctx.cwd, options.targetPackagePath ?? ".");
        const plan = await bootstrapSkillEval({ ...options, mode: "preview" });
        const confirmed = await ctx.ui.confirm(
          "Apply skill eval scaffold?",
          `Create evals/${plan.evalName}, add ${plan.packageScript} (node --experimental-strip-types evals/${plan.evalName}/run-eval.ts), and add eval results/bootstrap-lock ignore rules in ${packageRoot}?`,
        );
        if (!confirmed) throw new Error("Skill eval scaffold apply was not confirmed");
        result = await withFileMutationQueue(join(packageRoot, "package.json"), () => bootstrapSkillEval(options));
      } else {
        result = await bootstrapSkillEval(options);
      }
      return { content: [{ type: "text", text: formatBootstrap(result) }], details: result };
    },
  });

  pi.registerTool({
    name: "skill_eval_review",
    label: "Review Skill Eval",
    description: "Read-only structural and methodology review of a package-owned Pi skill behavioral eval. Checks cases, trigger controls, isolation, budgets, package scripts, and result hygiene without running an agent.",
    promptSnippet: "Review a package-owned skill eval without running provider-backed trials",
    promptGuidelines: ["Use skill_eval_review before expensive behavioral runs and treat its findings as structural guidance, not proof that the skill itself behaves correctly."],
    parameters: Type.Object({
      targetPackagePath: Type.Optional(Type.String({ description: "Package path relative to the current workspace; defaults to current directory" })),
      evalPath: Type.String({ description: "Eval directory relative to the target package" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const result = await reviewSkillEval({ workspaceRoot: ctx.cwd, ...(params.targetPackagePath ? { targetPackagePath: params.targetPackagePath } : {}), evalPath: params.evalPath });
      return { content: [{ type: "text", text: formatReview(result) }], details: result };
    },
  });
}
