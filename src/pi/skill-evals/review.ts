import { access, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isWithin, resolveExistingWithin } from "./path-safety.js";

export type ReviewFinding = {
  level: "error" | "warning" | "info";
  ruleId: string;
  message: string;
  path?: string;
};

export type ReviewResult = {
  packageRoot: string;
  evalDirectory: string;
  findings: ReviewFinding[];
  summary: { errors: number; warnings: number; infos: number; cases: number; positiveCases: number; negativeCases: number };
};

type EvalConfig = {
  version?: number;
  skillName?: string;
  skillPath?: string;
  extensionPaths?: string[];
  allowExtensionExecution?: boolean;
  tools?: string[];
  allowHostMutation?: boolean;
  conditions?: string[];
  trials?: number;
  timeoutMs?: number;
  maxToolCalls?: number;
};

type PromptKind = "explicit" | "implicit" | "contextual" | "negative-control";
type EvalCase = { id?: string; prompt?: string; fixture?: string; prompt_kind?: PromptKind; should_trigger?: boolean; expected_checks?: string[] };

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  if (text.length > 1024 * 1024) throw new Error(`File exceeds 1 MiB review limit: ${path}`);
  return JSON.parse(text) as T;
}

export async function reviewSkillEval(options: { workspaceRoot: string; targetPackagePath?: string; evalPath: string }): Promise<ReviewResult> {
  const packageRoot = await resolveExistingWithin(options.workspaceRoot, options.targetPackagePath ?? ".");
  const evalDirectory = await resolveExistingWithin(packageRoot, options.evalPath);
  const findings: ReviewFinding[] = [];
  const add = (level: ReviewFinding["level"], ruleId: string, message: string, path?: string) => findings.push({ level, ruleId, message, ...(path ? { path } : {}) });
  const rel = (path: string) => relative(packageRoot, path).replaceAll("\\", "/");

  const required = ["eval.config.json", "cases.json", "checks.ts", "run-eval.ts", "README.md"];
  for (const name of required) if (!await exists(join(evalDirectory, name))) add("error", "structure.missing-file", `Missing required eval file: ${name}`, rel(join(evalDirectory, name)));

  let config: EvalConfig = {};
  let cases: EvalCase[] = [];
  try { config = await readJson<EvalConfig>(join(evalDirectory, "eval.config.json")); }
  catch (error) { add("error", "config.invalid", `Could not parse eval.config.json: ${error instanceof Error ? error.message : String(error)}`); }
  try {
    const value = await readJson<unknown>(join(evalDirectory, "cases.json"));
    if (!Array.isArray(value)) throw new Error("cases.json must contain an array");
    cases = value as EvalCase[];
  } catch (error) { add("error", "cases.invalid", `Could not parse cases.json: ${error instanceof Error ? error.message : String(error)}`); }

  if (config.version !== 1) add("warning", "config.version", "Expected eval config version 1.");
  if (!config.skillPath) add("error", "config.skill-path", "skillPath is required.");
  else {
    const skill = resolve(evalDirectory, config.skillPath);
    if (!isWithin(packageRoot, skill)) add("error", "config.skill-escape", `Configured skill escapes the target package: ${config.skillPath}`);
    else if (!await exists(skill)) add("error", "config.skill-missing", `Configured skill does not exist: ${config.skillPath}`);
    else if (!skill.endsWith("SKILL.md")) add("warning", "config.skill-file", "Configured skill path should normally point to SKILL.md.");
  }
  if ((config.extensionPaths?.length ?? 0) > 0 && !config.allowExtensionExecution) add("error", "config.extension-authorization", "Extension paths require allowExtensionExecution=true because they execute host code.");
  for (const extensionPath of config.extensionPaths ?? []) {
    const extension = resolve(evalDirectory, extensionPath);
    if (!isWithin(packageRoot, extension)) add("error", "config.extension-escape", `Configured extension escapes the target package: ${extensionPath}`);
    else if (!await exists(extension)) add("error", "config.extension-missing", `Configured extension does not exist: ${extensionPath}`);
  }
  if ((config.tools ?? []).some((tool) => ["bash", "edit", "write"].includes(tool))) {
    if (!config.allowHostMutation) add("error", "config.host-mutation-authorization", "bash, edit, or write requires allowHostMutation=true because Pi tools are not sandboxed to the fixture.");
    else add("info", "config.mutating-tools", "Mutating or shell tools are enabled; confirm each is required by the eval outcome and use OS sandboxing for untrusted fixtures.");
  }
  if (!(config.conditions ?? []).includes("available")) add("warning", "conditions.available", "Add the available condition to test automatic skill selection.");
  if (!(config.conditions ?? []).includes("baseline")) add("warning", "conditions.baseline", "Add a no-skill baseline to measure incremental value and retirement readiness.");
  if ((config.trials ?? 0) < 1 || (config.trials ?? 0) > 5) add("error", "budgets.trials", "trials must be between 1 and 5.");
  else if (config.trials === 1) add("info", "budgets.single-trial", "One trial is suitable for a pilot; use 3–5 for distributional evidence.");
  if ((config.timeoutMs ?? 0) < 1_000 || (config.timeoutMs ?? 0) > 3_600_000) add("error", "budgets.timeout", "timeoutMs must be between 1 second and 1 hour.");
  if ((config.maxToolCalls ?? 0) < 1) add("error", "budgets.tool-calls", "maxToolCalls must be positive.");

  const ids = new Set<string>();
  for (const [index, item] of cases.entries()) {
    const label = item.id || `case[${index}]`;
    if (!item.id || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id)) add("error", "cases.id", `Invalid case id: ${label}`);
    else if (ids.has(item.id)) add("error", "cases.duplicate-id", `Duplicate case id: ${item.id}`);
    else ids.add(item.id);
    if (!item.prompt?.trim()) add("error", "cases.prompt", `${label} has an empty prompt.`);
    if (typeof item.should_trigger !== "boolean") add("error", "cases.trigger", `${label} must declare should_trigger.`);
    const promptKinds: PromptKind[] = ["explicit", "implicit", "contextual", "negative-control"];
    if (!item.prompt_kind) add("warning", "cases.prompt-kind", `${label} should classify prompt_kind as explicit, implicit, contextual, or negative-control.`);
    else if (!promptKinds.includes(item.prompt_kind)) add("error", "cases.prompt-kind-invalid", `${label} has unsupported prompt_kind: ${item.prompt_kind}`);
    else if ((item.prompt_kind === "negative-control") !== (item.should_trigger === false)) add("error", "cases.prompt-kind-trigger", `${label} prompt_kind does not agree with should_trigger.`);
    if (!Array.isArray(item.expected_checks) || item.expected_checks.length === 0) add("error", "cases.criteria", `${label} needs per-case expected_checks.`);
    if (!item.fixture) add("warning", "cases.fixture", `${label} does not name an isolated fixture.`);
    else {
      const fixture = resolve(evalDirectory, "fixtures", item.fixture);
      const fixturesRoot = resolve(evalDirectory, "fixtures");
      if (!isWithin(fixturesRoot, fixture)) add("error", "cases.fixture-escape", `${label} fixture escapes the eval fixture root: ${item.fixture}`);
      else if (!await exists(fixture)) add("error", "cases.fixture-missing", `${label} fixture does not exist: ${item.fixture}`);
    }
  }
  const positives = cases.filter((item) => item.should_trigger === true).length;
  const negatives = cases.filter((item) => item.should_trigger === false).length;
  if (positives === 0) add("error", "cases.no-positive", "At least one relevant prompt must expect the skill to trigger.");
  if (negatives === 0) add("error", "cases.no-negative", "At least one unrelated prompt must verify that the skill does not trigger.");
  const positiveKinds = new Set(cases.filter((item) => item.should_trigger === true).map((item) => item.prompt_kind));
  if (!positiveKinds.has("explicit")) add("info", "cases.no-explicit", "Add an explicit-invocation prompt to verify direct usage separately from forced runner injection.");
  if (!positiveKinds.has("implicit")) add("info", "cases.no-implicit", "Add an ordinary-language prompt that expresses the core intent without naming the skill.");
  if (!positiveKinds.has("contextual")) add("info", "cases.no-contextual", "Add a realistic contextual/noisy prompt to test selection beyond the skill's own terminology.");
  if (cases.length < 10) add("info", "cases.small-prompt-set", "Start with real failures, then grow toward 10–20 focused prompts.");

  const runnerPath = join(evalDirectory, "run-eval.ts");
  if (await exists(runnerPath)) {
    const runner = await readFile(runnerPath, "utf8");
    for (const [ruleId, snippet, message] of [
      ["isolation.temp-copy", "mkdtemp", "Runner should create a fresh temporary workspace per trial."],
      ["isolation.no-approve", "--no-approve", "Runner should decline fixture-local project resources."],
      ["isolation.no-context", "--no-context-files", "Runner should disable unrelated context-file loading."],
      ["isolation.no-skills", "--no-skills", "Runner should explicitly control skill availability."],
      ["isolation.stdin", 'stdio: ["ignore"', "Runner should close stdin in noninteractive mode."],
      ["evidence.json-mode", '"--mode", "json"', "Runner should capture Pi's structured JSON event stream."],
      ["evidence.results", "latest-results.json", "Runner should write a structured result artifact."],
      ["evidence.raw-opt-in", "includeRaw", "Runner should make raw answer/stderr retention opt-in."],
      ["evidence.events-opt-in", "includeEvents", "Runner should make raw JSONL event retention opt-in."],
      ["isolation.cleanup", "finally", "Runner should clean temporary workspaces in a finally block."],
    ] as const) if (!runner.includes(snippet)) add("warning", ruleId, message, rel(runnerPath));
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const pkg = await readJson<{ scripts?: Record<string, string> }>(packageJsonPath);
  const scriptEntries = Object.entries(pkg.scripts ?? {});
  const expectedRunner = rel(runnerPath);
  if (!scriptEntries.some(([name, command]) => name.startsWith("eval:") && command.includes(expectedRunner))) add("warning", "package.eval-script", "Add an opt-in eval:* package script for this runner.");
  if (pkg.scripts?.test?.includes(expectedRunner)) add("error", "package.behavioral-in-test", "Do not run provider-backed behavioral evals in ordinary npm test.");

  const gitignorePath = join(packageRoot, ".gitignore");
  const ignored = await exists(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
  if (!ignored.includes("latest-results.json")) add("warning", "results.gitignore", "Ignore transient latest-results.json artifacts.");
  const evalNpmignorePath = join(evalDirectory, ".npmignore");
  const npmIgnored = await exists(evalNpmignorePath) ? await readFile(evalNpmignorePath, "utf8") : "";
  if (!npmIgnored.split(/\r?\n/).includes("latest-results.json")) add("warning", "results.npmignore", "Add an eval-local .npmignore rule for latest-results.json so diagnostic output cannot enter npm packages.", rel(evalNpmignorePath));

  findings.sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.level] - ({ error: 0, warning: 1, info: 2 }[b.level])));
  return {
    packageRoot: await realpath(packageRoot),
    evalDirectory: await realpath(evalDirectory),
    findings,
    summary: {
      errors: findings.filter((item) => item.level === "error").length,
      warnings: findings.filter((item) => item.level === "warning").length,
      infos: findings.filter((item) => item.level === "info").length,
      cases: cases.length,
      positiveCases: positives,
      negativeCases: negatives,
    },
  };
}
