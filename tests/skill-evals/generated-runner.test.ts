import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapSkillEval } from "../../dist/pi/skill-evals/bootstrap.js";

const root = await mkdtemp(join(tmpdir(), "pi-package-development-skill-evals-runner-"));
const packageRoot = join(root, "target");
await mkdir(join(packageRoot, "skills/example-skill"), { recursive: true });
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: "example", version: "0.0.0", scripts: {} }, null, 2)}\n`);
await writeFile(join(packageRoot, ".npmignore"), "coverage/\n");
await writeFile(join(packageRoot, "skills/example-skill/SKILL.md"), "---\nname: example-skill\ndescription: Example.\n---\n");
const fakePi = join(root, "fake-pi.mjs");
await writeFile(fakePi, `
const args = process.argv.slice(2);
const skillIndex = args.indexOf("--skill");
const prompt = args.at(-1) ?? "";
console.log(JSON.stringify({ type: "session", version: 3, id: "fake", cwd: process.cwd() }));
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "turn_start" }));
if (skillIndex >= 0 && prompt.includes("known failure")) {
  console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "C:/skills/example-skill/SKILL.md" } }));
  console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "1", toolName: "read", result: {}, isError: false }));
}
const message = { role: "assistant", content: [{ type: "text", text: "usable answer" }], stopReason: "stop", usage: { input: 10, output: 2, totalTokens: 12, cost: { total: 0.01 } } };
console.log(JSON.stringify({ type: "message_start", message: { ...message, content: [] } }));
console.log(JSON.stringify({ type: "message_end", message }));
console.log(JSON.stringify({ type: "turn_end", message, toolResults: [] }));
console.log(JSON.stringify({ type: "agent_end", messages: [message] }));
console.log(JSON.stringify({ type: "agent_settled" }));
`, "utf8");

try {
  await bootstrapSkillEval({
    workspaceRoot: root,
    targetPackagePath: "target",
    skillPath: "skills/example-skill/SKILL.md",
    positiveCases: [{ id: "positive", prompt: "Handle this known failure.", promptKind: "implicit" }],
    negativeCases: [{ id: "negative", prompt: "Handle unrelated work." }],
    mode: "apply",
  });
  const runner = join(packageRoot, "evals/example-skill/run-eval.ts");
  const child = spawn(process.execPath, ["--experimental-strip-types", runner, "--condition", "all"], {
    cwd: packageRoot,
    env: { ...process.env, PI_CLI_PATH: fakePi },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  assert.equal(code, 0, stderr);
  const report = JSON.parse(await readFile(join(packageRoot, "evals/example-skill/latest-results.json"), "utf8"));
  assert.equal(report.summary.passed, 4, JSON.stringify(report.results, null, 2));
  assert.equal(report.summary.total, 4);
  const availablePositive = report.results.find((item: any) => item.id === "positive" && item.condition === "available");
  assert.equal(availablePositive.checks.skill_loaded, true);
  assert.equal(availablePositive.promptKind, "implicit");
  assert.equal(availablePositive.observations.streamValid, true);
  const baselineNegative = report.results.find((item: any) => item.id === "negative" && item.condition === "baseline");
  assert.equal(baselineNegative.checks.skill_not_loaded, null);
  assert.equal("answer" in baselineNegative, false, "Raw answers should be omitted by default");
  assert.equal(baselineNegative.metrics.usage.totalTokens, 12);

  assert(process.env.npm_execpath, "npm_execpath is required for the package-content check");
  const pack = spawn(process.execPath, [process.env.npm_execpath, "pack", "--dry-run", "--json"], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] });
  let packStdout = "";
  let packStderr = "";
  pack.stdout.setEncoding("utf8");
  pack.stderr.setEncoding("utf8");
  pack.stdout.on("data", (chunk) => { packStdout += chunk; });
  pack.stderr.on("data", (chunk) => { packStderr += chunk; });
  const packCode = await new Promise<number | null>((resolveExit) => pack.on("close", resolveExit));
  assert.equal(packCode, 0, packStderr);
  const packedFiles = JSON.parse(packStdout)[0].files.map((item: any) => item.path);
  assert(!packedFiles.some((path: string) => path.endsWith("latest-results.json")), "Diagnostic results must not enter npm packages");

  await writeFile(fakePi, `
console.log(JSON.stringify({ type: "session", version: 3, id: "incomplete", cwd: process.cwd() }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "stop", usage: {} } }));
console.log(JSON.stringify({ type: "agent_settled" }));
`, "utf8");
  const incomplete = spawn(process.execPath, ["--experimental-strip-types", runner, "--condition", "available", "--cases", "negative", "--include-events"], {
    cwd: packageRoot,
    env: { ...process.env, PI_CLI_PATH: fakePi },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let incompleteStderr = "";
  incomplete.stderr.setEncoding("utf8");
  incomplete.stderr.on("data", (chunk) => { incompleteStderr += chunk; });
  const incompleteCode = await new Promise<number | null>((resolveExit) => incomplete.on("close", resolveExit));
  assert.equal(incompleteCode, 0, incompleteStderr);
  const incompleteReport = JSON.parse(await readFile(join(packageRoot, "evals/example-skill/latest-results.json"), "utf8"));
  assert.equal(incompleteReport.summary.passed, 0);
  assert.equal(incompleteReport.results[0].observations.streamValid, false);
  assert(incompleteReport.results[0].eventTraceJsonl.includes('"type":"session"'));
  assert(incompleteReport.results[0].eventTraceJsonl.length <= 200_000);

  const configPath = join(packageRoot, "evals/example-skill/eval.config.json");
  const malformedConfig = JSON.parse(await readFile(configPath, "utf8"));
  delete malformedConfig.skillName;
  await writeFile(configPath, `${JSON.stringify(malformedConfig, null, 2)}\n`);
  const malformed = spawn(process.execPath, ["--experimental-strip-types", runner], { cwd: packageRoot, env: { ...process.env, PI_CLI_PATH: fakePi }, stdio: ["ignore", "pipe", "pipe"] });
  const malformedCode = await new Promise<number | null>((resolveExit) => malformed.on("close", resolveExit));
  assert.notEqual(malformedCode, 0, "Malformed config must fail before trials run");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi-package-development skill-eval generated-runner tests passed");
