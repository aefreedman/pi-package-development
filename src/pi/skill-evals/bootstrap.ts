import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoSymlinkComponents, resolveExistingWithin, resolveNewWithin } from "./path-safety.js";

export type PositivePromptKind = "explicit" | "implicit" | "contextual";
export type PromptKind = PositivePromptKind | "negative-control";

export type StarterCaseInput = {
  id: string;
  prompt: string;
  fixture?: string;
  expectedChecks?: string[];
  promptKind?: PromptKind;
};

export type BootstrapOptions = {
  workspaceRoot: string;
  targetPackagePath?: string | undefined;
  skillPath: string;
  evalName?: string | undefined;
  positiveCases: StarterCaseInput[];
  negativeCases: StarterCaseInput[];
  extensionPaths?: string[] | undefined;
  allowExtensionExecution?: boolean | undefined;
  tools?: string[] | undefined;
  allowHostMutation?: boolean | undefined;
  mode?: "preview" | "apply" | undefined;
  templateRoot?: string;
};

export type PlannedFile = { path: string; content: string };
export type BootstrapResult = {
  mode: "preview" | "apply";
  packageRoot: string;
  skillPath: string;
  evalName: string;
  evalDirectory: string;
  plannedFiles: string[];
  packageScript: string;
  caseCounts: { positive: number; negative: number };
};

function parseSkillName(text: string): string | undefined {
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  return frontmatter?.[1]?.match(/^name:\s*["']?([^\s"']+)["']?\s*$/m)?.[1];
}

function safeName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized || normalized.length > 64 || normalized.includes("--")) throw new Error(`Invalid eval name: ${value}`);
  return normalized;
}

function validateCases(cases: StarterCaseInput[], label: string): void {
  if (cases.length === 0) throw new Error(`At least one ${label} case is required`);
  const ids = new Set<string>();
  for (const item of cases) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id)) throw new Error(`Invalid case id: ${item.id}`);
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} case id: ${item.id}`);
    ids.add(item.id);
    if (!item.prompt.trim()) throw new Error(`Case ${item.id} has an empty prompt`);
    if (item.fixture && (!/^[a-z0-9][a-z0-9_/-]{0,119}$/.test(item.fixture) || item.fixture.split("/").includes(".."))) throw new Error(`Invalid fixture path: ${item.fixture}`);
    const allowedKinds: PromptKind[] = label === "positive" ? ["explicit", "implicit", "contextual"] : ["negative-control"];
    if (item.promptKind && !allowedKinds.includes(item.promptKind)) throw new Error(`Invalid ${label} prompt kind for ${item.id}: ${item.promptKind}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function normalizeRelative(from: string, to: string): string {
  const value = relative(from, to).replaceAll("\\", "/");
  return value.startsWith(".") ? value : `./${value}`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function loadTemplate(root: string, name: string, replacements: Record<string, string>): Promise<string> {
  let text = await readFile(join(root, name), "utf8");
  for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(`{{${key}}}`, value);
  return text;
}

async function bootstrapSkillEvalUnlocked(options: BootstrapOptions): Promise<BootstrapResult> {
  validateCases(options.positiveCases, "positive");
  validateCases(options.negativeCases, "negative");
  const allIds = new Set<string>();
  for (const item of [...options.positiveCases, ...options.negativeCases]) {
    if (allIds.has(item.id)) throw new Error(`Duplicate case id across positive/negative cases: ${item.id}`);
    allIds.add(item.id);
  }

  if ((options.extensionPaths?.length ?? 0) > 0 && !options.allowExtensionExecution) {
    throw new Error("allowExtensionExecution=true is required when extensionPaths are configured because extensions execute host code");
  }
  if ((options.tools ?? []).some((tool) => ["bash", "edit", "write"].includes(tool)) && !options.allowHostMutation) {
    throw new Error("allowHostMutation=true is required when bash, edit, or write tools are configured");
  }
  const packageRoot = await resolveExistingWithin(options.workspaceRoot, options.targetPackagePath ?? ".");
  const packageJsonPath = join(packageRoot, "package.json");
  await assertNoSymlinkComponents(packageRoot, packageJsonPath);
  const packageJsonText = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
  const skill = await resolveExistingWithin(packageRoot, options.skillPath);
  const skillText = await readFile(skill, "utf8");
  const skillName = parseSkillName(skillText);
  if (!skillName) throw new Error(`Could not read skill name from ${options.skillPath}`);
  const evalName = safeName(options.evalName ?? skillName);
  const evalDirectory = resolveNewWithin(packageRoot, `evals/${evalName}`);
  const mode = options.mode ?? "preview";
  const templateRoot = options.templateRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/building-skill-evals/assets/starter");
  const packageScript = `eval:${evalName}`;

  const config = {
    version: 1,
    skillName,
    skillPath: normalizeRelative(evalDirectory, skill),
    extensionPaths: (options.extensionPaths ?? []).map((path) => normalizeRelative(evalDirectory, resolveNewWithin(packageRoot, path))),
    allowExtensionExecution: options.allowExtensionExecution ?? false,
    tools: options.tools ?? ["read"],
    allowHostMutation: options.allowHostMutation ?? false,
    conditions: ["available", "baseline"],
    trials: 1,
    timeoutMs: 600_000,
    maxToolCalls: 20,
  };
  const cases = [
    ...options.positiveCases.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      fixture: item.fixture ?? "starter",
      ...(item.promptKind ? { prompt_kind: item.promptKind } : {}),
      should_trigger: true,
      expected_checks: item.expectedChecks ?? ["skill_loaded", "answer_not_empty", "bounded_tool_calls"],
    })),
    ...options.negativeCases.map((item) => ({
      id: item.id,
      prompt: item.prompt,
      fixture: item.fixture ?? "starter",
      prompt_kind: "negative-control" as const,
      should_trigger: false,
      expected_checks: item.expectedChecks ?? ["skill_not_loaded", "answer_not_empty", "bounded_tool_calls"],
    })),
  ];
  const replacements = { EVAL_NAME: evalName, SKILL_NAME: skillName };
  const fixtureReadme = await loadTemplate(templateRoot, "fixture-README.md", replacements);
  const fixtureNames = [...new Set(cases.map((item) => item.fixture))];
  const planned: PlannedFile[] = [
    { path: join(evalDirectory, "eval.config.json"), content: `${JSON.stringify(config, null, 2)}\n` },
    { path: join(evalDirectory, "cases.json"), content: `${JSON.stringify(cases, null, 2)}\n` },
    { path: join(evalDirectory, "checks.ts"), content: await loadTemplate(templateRoot, "checks.ts", replacements) },
    { path: join(evalDirectory, "run-eval.ts"), content: await loadTemplate(templateRoot, "run-eval.ts", replacements) },
    { path: join(evalDirectory, "README.md"), content: await loadTemplate(templateRoot, "README.md", replacements) },
    { path: join(evalDirectory, ".npmignore"), content: "latest-results.json\n.latest-results.tmp-*.json\n" },
    ...fixtureNames.map((fixture) => ({ path: resolveNewWithin(evalDirectory, `fixtures/${fixture}/README.md`), content: fixtureReadme })),
  ];

  const result: BootstrapResult = {
    mode,
    packageRoot,
    skillPath: skill,
    evalName,
    evalDirectory,
    plannedFiles: planned.map((item) => relative(packageRoot, item.path).replaceAll("\\", "/")),
    packageScript,
    caseCounts: { positive: options.positiveCases.length, negative: options.negativeCases.length },
  };
  if (mode === "preview") return result;

  await assertNoSymlinkComponents(packageRoot, evalDirectory);
  if (await exists(evalDirectory)) throw new Error(`Eval directory already exists: ${relative(packageRoot, evalDirectory)}`);
  const scriptCommand = `node --experimental-strip-types evals/${evalName}/run-eval.ts`;
  const existingScript = packageJson.scripts?.[packageScript];
  if (existingScript && existingScript !== scriptCommand) throw new Error(`Package script already exists with different content: ${packageScript}`);

  const gitignorePath = join(packageRoot, ".gitignore");
  await assertNoSymlinkComponents(packageRoot, gitignorePath);
  const gitignoreExisted = await exists(gitignorePath);
  const currentIgnore = gitignoreExisted ? await readFile(gitignorePath, "utf8") : "";
  const ignoreRules = [`evals/${evalName}/latest-results.json`, ".pi-package-development-skill-evals-bootstrap.lock"];
  let nextIgnore = currentIgnore;
  for (const ignoreRule of ignoreRules) {
    if (!nextIgnore.split(/\r?\n/).includes(ignoreRule)) nextIgnore = `${nextIgnore}${nextIgnore && !nextIgnore.endsWith("\n") ? "\n" : ""}${ignoreRule}\n`;
  }
  packageJson.scripts = { ...(packageJson.scripts ?? {}), [packageScript]: scriptCommand };
  const nextPackageJson = `${JSON.stringify(packageJson, null, 2)}\n`;

  const staging = join(dirname(evalDirectory), `.${basename(evalDirectory)}.tmp-${process.pid}-${Date.now()}`);
  await assertNoSymlinkComponents(packageRoot, staging);
  await mkdir(staging, { recursive: true });
  let packageCommitted = false;
  let gitignoreCommitted = false;
  try {
    for (const item of planned) {
      const stagedPath = join(staging, relative(evalDirectory, item.path));
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, item.content, "utf8");
    }
    await atomicWrite(packageJsonPath, nextPackageJson);
    packageCommitted = true;
    await atomicWrite(gitignorePath, nextIgnore);
    gitignoreCommitted = true;
    await rename(staging, evalDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    await rm(evalDirectory, { recursive: true, force: true });
    if (packageCommitted) await atomicWrite(packageJsonPath, packageJsonText);
    if (gitignoreCommitted) {
      if (gitignoreExisted) await atomicWrite(gitignorePath, currentIgnore);
      else await rm(gitignorePath, { force: true });
    }
    throw error;
  }
  return result;
}

export async function bootstrapSkillEval(options: BootstrapOptions): Promise<BootstrapResult> {
  if ((options.mode ?? "preview") === "preview") return bootstrapSkillEvalUnlocked(options);
  const packageRoot = await resolveExistingWithin(options.workspaceRoot, options.targetPackagePath ?? ".");
  const lockPath = join(packageRoot, ".pi-package-development-skill-evals-bootstrap.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Another skill eval bootstrap may be active. Verify no apply is running before removing ${lockPath}`);
    throw error;
  }
  try {
    return await bootstrapSkillEvalUnlocked(options);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
