import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCustomCheck, type CheckContext } from "./checks.ts";

type Condition = "available" | "baseline" | "forced";
type EvalConfig = {
  version: 1;
  skillName: string;
  skillPath: string;
  extensionPaths: string[];
  allowExtensionExecution: boolean;
  tools: string[];
  requiredLocalReferencePaths: string[];
  allowHostMutation: boolean;
  conditions: Condition[];
  trials: number;
  timeoutMs: number;
  maxToolCalls: number;
};
type PromptKind = "explicit" | "implicit" | "contextual" | "negative-control";
type LocalReferenceMode = "available" | "unavailable";
type EvalCase = { id: string; prompt: string; fixture: string; prompt_kind?: PromptKind; should_trigger: boolean; local_reference_mode?: LocalReferenceMode; expected_checks: string[] };
type Snapshot = Record<string, string>;

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(here, "eval.config.json"), "utf8")) as EvalConfig;
const cases = JSON.parse(await readFile(join(here, "cases.json"), "utf8")) as EvalCase[];
const supportedConditions = new Set<Condition>(["available", "baseline", "forced"]);
if (config.version !== 1) throw new Error(`Unsupported eval config version: ${String(config.version)}`);
if (typeof config.skillName !== "string" || !config.skillName.trim() || typeof config.skillPath !== "string" || !config.skillPath.trim()) throw new Error("skillName and skillPath are required strings");
if (!Array.isArray(config.extensionPaths) || config.extensionPaths.some((item) => typeof item !== "string") || new Set(config.extensionPaths).size !== config.extensionPaths.length) throw new Error("extensionPaths must contain unique strings");
if (typeof config.allowExtensionExecution !== "boolean" || typeof config.allowHostMutation !== "boolean") throw new Error("authorization fields must be booleans");
if (!Array.isArray(config.tools) || config.tools.length === 0 || config.tools.some((item) => typeof item !== "string" || !item.trim()) || new Set(config.tools).size !== config.tools.length) throw new Error("tools must contain unique non-empty strings");
if (!Array.isArray(config.requiredLocalReferencePaths) || config.requiredLocalReferencePaths.length === 0 || config.requiredLocalReferencePaths.some((item) => typeof item !== "string" || !item.trim() || isAbsolute(item) || item.split(/[\\/]/).includes(".."))) throw new Error("requiredLocalReferencePaths must contain package-relative non-empty paths");
if (!Array.isArray(config.conditions) || config.conditions.length === 0 || new Set(config.conditions).size !== config.conditions.length || config.conditions.some((item) => !supportedConditions.has(item))) throw new Error("conditions must contain unique supported values");
if (!Number.isInteger(config.trials) || config.trials < 1 || config.trials > 5) throw new Error("trials must be between 1 and 5");
if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 3_600_000) throw new Error("timeoutMs must be between 1000 and 3600000");
if (!Number.isInteger(config.maxToolCalls) || config.maxToolCalls < 1) throw new Error("maxToolCalls must be positive");
if (!Array.isArray(cases) || cases.length === 0) throw new Error("cases.json must contain at least one case");
const caseIds = new Set<string>();
for (const item of cases) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id) || caseIds.has(item.id)) throw new Error(`Invalid or duplicate case id: ${String(item.id)}`);
  caseIds.add(item.id);
  if (!item.prompt?.trim() || !item.fixture?.trim() || isAbsolute(item.fixture) || item.fixture.split(/[\\/]/).includes("..") || typeof item.should_trigger !== "boolean" || !Array.isArray(item.expected_checks) || item.expected_checks.length === 0 || item.expected_checks.some((check) => typeof check !== "string" || !check.trim()) || new Set(item.expected_checks).size !== item.expected_checks.length) throw new Error(`Invalid case definition: ${item.id}`);
  if (item.prompt_kind && !["explicit", "implicit", "contextual", "negative-control"].includes(item.prompt_kind)) throw new Error(`Invalid prompt_kind for case ${item.id}`);
  if (item.prompt_kind && (item.prompt_kind === "negative-control") !== !item.should_trigger) throw new Error(`prompt_kind and should_trigger disagree for case ${item.id}`);
  if (item.local_reference_mode && !["available", "unavailable"].includes(item.local_reference_mode)) throw new Error(`Invalid local_reference_mode for case ${item.id}`);
  if (!existsSync(join(here, "fixtures", item.fixture))) throw new Error(`Missing fixture for case ${item.id}: ${item.fixture}`);
}
if (config.extensionPaths.length > 0 && !config.allowExtensionExecution) throw new Error("Extension execution is not authorized by eval.config.json");
if (config.tools.some((tool) => ["bash", "edit", "write"].includes(tool)) && !config.allowHostMutation) throw new Error("Host mutation tools are not authorized by eval.config.json");
const packageRoot = resolve(here, "../..");
for (const referencePath of config.requiredLocalReferencePaths) {
  const reference = resolve(packageRoot, referencePath);
  if (relative(packageRoot, reference).startsWith("..") || isAbsolute(relative(packageRoot, reference)) || !existsSync(reference)) throw new Error(`Missing required local reference: ${referencePath}`);
}

function resolvePiCliPath(): string {
  const candidates = [
    process.env.PI_CLI_PATH,
    process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    process.env.npm_config_prefix && join(process.env.npm_config_prefix, "lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    join(dirname(process.execPath), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  ].filter((value): value is string => Boolean(value));
  const match = candidates.find(existsSync);
  if (!match) throw new Error("Could not resolve Pi CLI. Set PI_CLI_PATH to the Pi dist/cli.js file.");
  return match;
}

function parseArgs(args: string[]) {
  let trials = config.trials;
  let selectedConditions = config.conditions;
  let caseIds: string[] = [];
  let model: string | undefined;
  let keep = false;
  let includeRaw = false;
  let includeEvents = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--trials") trials = Number(args[++index]);
    else if (value === "--condition") {
      const requested = args[++index];
      selectedConditions = requested === "all" ? config.conditions : [requested as Condition];
    } else if (value === "--cases") caseIds = args[++index].split(",").filter(Boolean);
    else if (value === "--model") model = args[++index];
    else if (value === "--keep") keep = true;
    else if (value === "--include-raw") includeRaw = true;
    else if (value === "--include-events") includeEvents = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(trials) || trials < 1 || trials > 5) throw new Error("--trials must be between 1 and 5");
  if (new Set(selectedConditions).size !== selectedConditions.length) throw new Error("Duplicate conditions are not allowed");
  for (const condition of selectedConditions) if (!supportedConditions.has(condition) || !config.conditions.includes(condition)) throw new Error(`Condition is not enabled: ${condition}`);
  return { trials, selectedConditions, caseIds, model, keep, includeRaw, includeEvents };
}

async function walk(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walk(root, full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function snapshot(root: string): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const path of await walk(root)) {
    const content = await readFile(path);
    result[relative(root, path).replaceAll("\\", "/")] = createHash("sha256").update(content).digest("hex");
  }
  return result;
}

function changedPaths(before: Snapshot, after: Snapshot): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]).sort();
}

function assistantText(message: any): string {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text ?? "").join("");
}

function sameAssistant(left: any, right: any): boolean {
  if (left?.role !== "assistant" || right?.role !== "assistant") return false;
  if (left.responseId && right.responseId) return left.responseId === right.responseId;
  return left.stopReason === right.stopReason && assistantText(left) === assistantText(right);
}

function validateEventLifecycle(events: any[]): boolean {
  if (events.length === 0 || events[0]?.type !== "session" || events[0].version !== 3) return false;
  let agentOpen = false;
  let turnOpen = false;
  let messageRole: string | undefined;
  let agentStarts = 0;
  let settledCount = 0;
  const activeTools = new Set<string>();
  const completedTools = new Set<string>();
  let finalAssistant: any;
  let finalTurnMessage: any;
  let finalAgentMessages: any[] = [];
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event || typeof event !== "object" || typeof event.type !== "string" || settledCount > 0) return false;
    switch (event.type) {
      case "session": return false;
      case "agent_start":
        if (agentOpen || turnOpen || messageRole || activeTools.size > 0) return false;
        agentOpen = true; agentStarts += 1; break;
      case "turn_start":
        if (!agentOpen || turnOpen || messageRole) return false;
        turnOpen = true; break;
      case "message_start":
        if (!agentOpen || !turnOpen || messageRole || typeof event.message?.role !== "string") return false;
        messageRole = event.message.role; break;
      case "message_end":
        if (!agentOpen || !turnOpen || !messageRole || event.message?.role !== messageRole) return false;
        if (event.message.role === "assistant") finalAssistant = event.message;
        messageRole = undefined; break;
      case "tool_execution_start":
        if (!agentOpen || !turnOpen || typeof event.toolCallId !== "string" || activeTools.has(event.toolCallId) || completedTools.has(event.toolCallId)) return false;
        activeTools.add(event.toolCallId); break;
      case "tool_execution_update":
        if (!activeTools.has(event.toolCallId)) return false;
        break;
      case "tool_execution_end":
        if (!activeTools.delete(event.toolCallId)) return false;
        completedTools.add(event.toolCallId); break;
      case "turn_end":
        if (!agentOpen || !turnOpen || messageRole || activeTools.size > 0 || event.message?.role !== "assistant") return false;
        finalTurnMessage = event.message; turnOpen = false; break;
      case "agent_end":
        if (!agentOpen || turnOpen || messageRole || activeTools.size > 0 || !Array.isArray(event.messages)) return false;
        finalAgentMessages = event.messages; agentOpen = false; break;
      case "agent_settled":
        if (agentOpen || turnOpen || messageRole || activeTools.size > 0 || index !== events.length - 1) return false;
        settledCount += 1; break;
      default:
        break;
    }
  }
  return agentStarts > 0 && settledCount === 1 && Boolean(finalAssistant)
    && sameAssistant(finalAssistant, finalTurnMessage)
    && finalAgentMessages.some((message) => sameAssistant(finalAssistant, message));
}

async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await new Promise<void>((resolveKill) => killer.on("close", () => resolveKill()));
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  try { process.kill(-child.pid, "SIGKILL"); } catch { if (child.exitCode === null) child.kill("SIGKILL"); }
}

async function runTrial(testCase: EvalCase, condition: Condition, trial: number, options: ReturnType<typeof parseArgs>) {
  const workspace = await mkdtemp(join(tmpdir(), `pi-skill-eval-${testCase.id}-${condition}-${trial}-`));
  try {
  const consumerCwd = join(workspace, "consumer");
  const installedPackageRoot = join(workspace, "installed-package");
  await cp(join(here, "fixtures", testCase.fixture), consumerCwd, { recursive: true });
  const sourceSkillPath = resolve(here, config.skillPath);
  const sourceSkillRelativePath = relative(packageRoot, sourceSkillPath);
  if (sourceSkillRelativePath.startsWith("..") || isAbsolute(sourceSkillRelativePath)) throw new Error(`Skill must be package-local: ${config.skillPath}`);
  const skillPath = join(installedPackageRoot, sourceSkillRelativePath);
  await cp(dirname(sourceSkillPath), dirname(skillPath), { recursive: true });
  for (const referencePath of config.requiredLocalReferencePaths) {
    const sourceReference = resolve(packageRoot, referencePath);
    const trialReference = join(installedPackageRoot, referencePath);
    const consumerReference = join(consumerCwd, referencePath);
    if (relative(installedPackageRoot, trialReference).startsWith("..") || isAbsolute(relative(installedPackageRoot, trialReference))) throw new Error(`Staged reference escapes installed package: ${referencePath}`);
    await mkdir(dirname(trialReference), { recursive: true });
    await cp(sourceReference, trialReference, { recursive: true });
    if (testCase.local_reference_mode === "unavailable") await rm(trialReference, { force: true });
    if (existsSync(consumerReference)) throw new Error(`Consumer CWD must not contain a package-local reference: ${referencePath}`);
    if (existsSync(trialReference) === (testCase.local_reference_mode === "unavailable")) throw new Error(`Invalid staged local reference mode for: ${referencePath}`);
  }
  const before = await snapshot(workspace);
  const args = ["--mode", "json", "--no-session", "--no-approve", "--no-context-files", "--no-extensions"];
  for (const extension of config.extensionPaths) args.push("--extension", resolve(here, extension));
  args.push("--no-skills");
  if (condition !== "baseline") args.push("--skill", skillPath);
  args.push("--tools", config.tools.join(","));
  if (options.model) args.push("--model", options.model);
  const prompt = condition === "forced" ? `/skill:${config.skillName} ${testCase.prompt}` : testCase.prompt;
  args.push(prompt);

  const started = Date.now();
  const child = spawn(process.execPath, [resolvePiCliPath(), ...args], {
    cwd: consumerCwd,
    windowsHide: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const events: any[] = [];
  const traceLines: string[] = [];
  let traceBytes = 0;
  let traceTruncated = false;
  let malformedEventLines = 0;
  let eventLimitExceeded = false;
  let stderr = "";
  const maxTraceBytes = 200_000;
  const maxStderrBytes = 4_000;
  const maxEvents = 1_000;
  const compactMessage = (message: any) => ({
    role: message?.role,
    responseId: message?.responseId,
    stopReason: message?.stopReason,
    content: message?.role === "assistant" && Array.isArray(message.content)
      ? message.content.filter((part: any) => part?.type === "text").map((part: any) => ({ type: "text", text: String(part.text ?? "") }))
      : [],
  });
  const compactEvent = (event: any): any | undefined => {
    switch (event?.type) {
      case "session": return { type: event.type, version: event.version };
      case "agent_start": case "turn_start": case "agent_settled": return { type: event.type };
      case "message_start": case "message_end": return { type: event.type, message: compactMessage(event.message) };
      case "tool_execution_start": return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };
      case "tool_execution_end": return { type: event.type, toolCallId: event.toolCallId, isError: Boolean(event.isError) };
      case "turn_end": return { type: event.type, message: compactMessage(event.message) };
      case "agent_end": return { type: event.type, messages: Array.isArray(event.messages) ? event.messages.map(compactMessage) : event.messages };
      default: return undefined; // Streaming updates duplicate large provider payloads and are not lifecycle evidence.
    }
  };
  const output = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  output.on("line", (line) => {
    let event: any;
    try { event = JSON.parse(line); } catch { malformedEventLines += 1; return; }
    const compact = compactEvent(event);
    if (!compact) return;
    if (events.length >= maxEvents) { eventLimitExceeded = true; return; }
    events.push(compact);
    const trace = `${JSON.stringify(compact)}\n`;
    if (traceBytes + Buffer.byteLength(trace) <= maxTraceBytes) { traceLines.push(trace); traceBytes += Buffer.byteLength(trace); }
    else traceTruncated = true;
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-maxStderrBytes); });
  const timeout = setTimeout(() => { timedOut = true; termination = terminate(child); }, config.timeoutMs);
  const exitCode = await new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  clearTimeout(timeout);
  if (termination) await termination;
  if (!output.closed) await new Promise<void>((resolveOutput) => output.once("close", resolveOutput));

  const failedToolCallIds = new Set(events
    .filter((event: any) => event.type === "tool_execution_end" && event.isError)
    .map((event: any) => event.toolCallId));
  const toolCalls = events.filter((event: any) => event.type === "tool_execution_start").map((event: any) => ({ name: String(event.toolName), args: event.args, failed: failedToolCallIds.has(event.toolCallId) }));
  const toolErrors = failedToolCallIds.size;
  const assistantEnds = events.filter((event: any) => event.type === "message_end" && event.message?.role === "assistant");
  const finalAssistant = assistantEnds.at(-1)?.message;
  const answer = assistantText(finalAssistant);
  const streamValid = !eventLimitExceeded && malformedEventLines === 0 && finalAssistant?.stopReason === "stop" && validateEventLifecycle(events);
  const usage = assistantEnds.at(-1)?.message?.usage ?? {};
  const after = await snapshot(workspace);
  const changes = changedPaths(before, after);
  const isInstalledReferenceRead = (call: (typeof toolCalls)[number]) => call.name === "read" && config.requiredLocalReferencePaths.some((path) => {
    const requestedPath = (call.args && typeof call.args === "object" && typeof (call.args as { path?: unknown }).path === "string") ? (call.args as { path: string }).path : undefined;
    return requestedPath !== undefined && resolve(consumerCwd, requestedPath) === join(installedPackageRoot, path);
  });
  const expectedToolErrors = testCase.local_reference_mode === "unavailable" ? toolCalls.filter((call) => call.failed && isInstalledReferenceRead(call)).length : 0;
  const unexpectedToolErrors = toolErrors - expectedToolErrors;
  // --skill registers the supplied skill in Pi's initial skill context; it need not read SKILL.md again.
  const skillLoaded = condition !== "baseline";
  const context: CheckContext = { answer, guidance: "", changedPaths: changes, toolCalls, toolErrors: unexpectedToolErrors, condition, skillLoaded, auditRoot: consumerCwd, consumerCwd, installedPackageRoot };

  const evaluate = (checkId: string): boolean | null => {
    if (checkId === "skill_loaded") return condition === "baseline" ? null : skillLoaded;
    if (checkId === "skill_not_loaded") return condition === "baseline" || condition === "forced" ? null : !skillLoaded;
    if (checkId === "answer_not_empty") return answer.trim().length > 0;
    if (checkId === "no_files_changed") return changes.length === 0;
    if (checkId === "some_file_changed") return changes.length > 0;
    if (checkId === "bounded_tool_calls") return toolCalls.length <= config.maxToolCalls;
    if (checkId === "no_tool_errors") return unexpectedToolErrors === 0;
    const custom = evaluateCustomCheck(checkId, context);
    if (custom === undefined) throw new Error(`Unknown check id: ${checkId}`);
    return custom;
  };
  const checks = Object.fromEntries(testCase.expected_checks.map((check) => [check, evaluate(check)]));
  const values = Object.values(checks).filter((value): value is boolean => value !== null);
  const result = {
    id: testCase.id,
    condition,
    trial,
    shouldTrigger: testCase.should_trigger,
    promptKind: testCase.prompt_kind,
    passed: exitCode === 0 && !timedOut && streamValid && values.length > 0 && values.every(Boolean),
    checks,
    observations: { skillLoaded, toolErrors, expectedToolErrors, unexpectedToolErrors, timedOut, eventLimitExceeded, traceTruncated, streamValid, malformedEventLines, stopReason: finalAssistant?.stopReason },
    metrics: {
      durationMs: Date.now() - started,
      toolCalls: toolCalls.length,
      changedPaths: changes,
      exitCode,
      usage: { input: usage.input ?? 0, output: usage.output ?? 0, totalTokens: usage.totalTokens ?? 0, cost: usage.cost?.total ?? 0 },
    },
    ...(options.includeRaw ? { answer: answer.slice(0, 20_000), stderr } : {}),
    ...(options.includeEvents ? { eventTraceJsonl: traceLines.join("") } : {}),
    workspace: options.keep ? workspace : undefined,
  };
  return result;
  } finally {
    if (!options.keep) await rm(workspace, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
let selected = options.caseIds.length > 0 ? cases.filter((item) => options.caseIds.includes(item.id)) : cases;
if (options.caseIds.length > 0 && selected.length !== options.caseIds.length) throw new Error("One or more --cases IDs were not found");
const results: any[] = [];
for (const testCase of selected) {
  for (const condition of options.selectedConditions) {
    if (condition === "forced" && !testCase.should_trigger) continue;
    for (let trial = 1; trial <= options.trials; trial += 1) {
      process.stderr.write(`Running ${testCase.id} [${condition}] trial ${trial}...\n`);
      results.push(await runTrial(testCase, condition, trial, options));
    }
  }
}
const summary = {
  passed: results.filter((item) => item.passed).length,
  total: results.length,
  byCondition: Object.fromEntries(options.selectedConditions.map((condition) => {
    const rows = results.filter((item) => item.condition === condition);
    return [condition, { passed: rows.filter((item) => item.passed).length, total: rows.length }];
  })),
};
const report = { generatedAt: new Date().toISOString(), config, options, summary, results };
const outputPath = join(here, "latest-results.json");
const temporaryOutputPath = join(here, `.latest-results.tmp-${process.pid}-${Date.now()}.json`);
try {
  await writeFile(temporaryOutputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryOutputPath, outputPath);
} finally {
  await rm(temporaryOutputPath, { force: true });
}
console.log(JSON.stringify({ outputPath, ...summary }, null, 2));
