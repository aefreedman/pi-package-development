import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import register from "../dist/pi/register.js";
import { bootstrapSkillEval } from "../dist/pi/skill-evals/bootstrap.js";
import { evalEffects, observeEffects, evalFailure, evalSuccess, bootstrapProjection } from "../dist/pi/skill-eval-output.js";
const canary = "PRIVATE_MALFORMED_CONFIG_CANARY";
const params = { skillPath: "skills/example/SKILL.md", positiveCases: [{ id: "positive", prompt: canary, promptKind: "explicit" }], negativeCases: [{ id: "negative", prompt: canary }] };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pi-eval-native-"));
  await mkdir(join(root, "skills/example"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"synthetic","scripts":{}}\n');
  await writeFile(join(root, "skills/example/SKILL.md"), "---\nname: example\ndescription: Synthetic.\n---\n");
  const tools = new Map(); register({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } });
  const ctx = { cwd: root, hasUI: false };
  const call = (name, args, context = ctx) => tools.get(name).execute("test", args, undefined, undefined, context);
  const check = (name, result) => { assert(Value.Check(tools.get(name).outputSchema, result.structuredContent)); assert(Buffer.byteLength(JSON.stringify(result.structuredContent)) <= 32768); assert(Buffer.byteLength(result.content[0].text) <= 8192); assert(!JSON.stringify(result).includes(canary)); assert(!JSON.stringify(result).includes(root)); };
  try { await run({ root, tools, ctx, call, check }); } finally { await rm(root, { recursive: true, force: true }); }
}

test("preview, denied/noUI and confirmed apply preserve authorization and publish only plans/stages", async () => fixture(async ({ root, call, check, ctx }) => {
  const preview = await call("skill_eval_bootstrap", params); check("skill_eval_bootstrap", preview);
  assert.equal(preview.structuredContent.ok, true); assert.equal(preview.structuredContent.effects.state, "none");
  assert.equal(preview.structuredContent.result.caseCounts.positive, 1);
  assert(preview.structuredContent.result.plannedFiles.includes("evals/example/cases.json"));
  await assert.rejects(readFile(join(root, "evals/example/cases.json")), /ENOENT/);
  const noUI = await call("skill_eval_bootstrap", { ...params, mode: "apply" }); check("skill_eval_bootstrap", noUI);
  assert.equal(noUI.isError, true); assert.equal(noUI.structuredContent.error.code, "confirmation_required");
  assert.equal(noUI.structuredContent.effects.state, "not_dispatched");
  const denied = await call("skill_eval_bootstrap", { ...params, mode: "apply" }, { ...ctx, hasUI: true, ui: { confirm: async () => false } });
  assert.equal(denied.structuredContent.effects.state, "not_dispatched");
  const applied = await call("skill_eval_bootstrap", { ...params, mode: "apply" }, { ...ctx, hasUI: true, ui: { confirm: async () => true } }); check("skill_eval_bootstrap", applied);
  assert.equal(applied.structuredContent.effects.state, "completed");
  for (const stage of ["lock", "staging", "packageJson", "gitignore", "evalDirectory", "cleanup"]) assert.equal(applied.structuredContent.effects.stages[stage], "completed");
  assert.deepEqual(applied.structuredContent.effects.changedReferences, ["package.json", ".gitignore", "evals/example"]);
  const duplicate = await call("skill_eval_bootstrap", { ...params, mode: "apply" }, { ...ctx, hasUI: true, ui: { confirm: async () => true } });
  assert.equal(duplicate.isError, true); assert.equal(duplicate.structuredContent.effects.state, "may_have_changed", "dispatched lock effects are not denial");
}));

test("review >50 findings retains totals and safe messages; findings are successful inspection", async () => fixture(async ({ root, call, check }) => {
  await bootstrapSkillEval({ workspaceRoot: root, ...params, mode: "apply" });
  await writeFile(join(root, "evals/example/cases.json"), JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ id: `${canary}${i}`, prompt_kind: canary, fixture: `../../${canary}`, should_trigger: i % 2 === 0 }))));
  await writeFile(join(root, "evals/example/eval.config.json"), `{ ${canary} INVALID`);
  const review = await call("skill_eval_review", { evalPath: "evals/example" }); check("skill_eval_review", review);
  assert.equal(review.structuredContent.ok, true); assert(review.structuredContent.result.summary.errors > 50);
  assert.equal(review.structuredContent.result.returned, 100);
  assert.equal(review.structuredContent.result.total, review.structuredContent.result.returned + review.structuredContent.result.omitted);
  assert(JSON.parse(review.content[0].text).presentationOmittedFindings > 0);
  const missing = await call("skill_eval_review", { evalPath: "missing" }); check("skill_eval_review", missing);
  assert.equal(missing.isError, true); assert.equal(missing.structuredContent.ok, false);
}));

test("real disposable scaffold stages report rollback and failed rollback without replay", async () => {
  for (const failRollback of [false, true]) await fixture(async ({ root }) => {
    const effects = evalEffects(); let commits = 0;
    const before = await readFile(join(root, "package.json"), "utf8");
    let failure;
    try { await bootstrapSkillEval({ workspaceRoot: root, ...params, mode: "apply", observe(event) {
      observeEffects(effects, event);
      if (event.stage === "packageJson" && event.state === "completed") { commits++; throw new Error("injected after package write"); }
      if (failRollback && event.stage === "rollback" && event.state === "started") throw new Error("injected rollback failure");
    } }); } catch (error) { failure = error; }
    assert(failure); assert.equal(commits, 1);
    assert.equal(effects.stages.packageJson, "failed");
    assert.equal(effects.stages.rollback, failRollback ? "failed" : "completed");
    effects.state = failRollback ? "may_have_changed" : "rolled_back";
    const receipt = evalFailure("skill_eval_bootstrap", failure, effects);
    assert.equal(receipt.isError, true); assert(receipt.structuredContent.effects.changedReferences.includes("package.json"));
    if (!failRollback) assert.equal(await readFile(join(root, "package.json"), "utf8"), before);
    else assert.notEqual(await readFile(join(root, "package.json"), "utf8"), before);
  });
});

test("post-effect projection errors preserve effects and never scaffold again", async () => fixture(async ({ root }) => {
  const effects = evalEffects(); let dispatches = 0;
  const result = await bootstrapSkillEval({ workspaceRoot: root, ...params, mode: "apply", observe(event) { observeEffects(effects, event); if (event.stage === "evalDirectory" && event.state === "completed") dispatches++; } });
  assert.throws(() => evalSuccess("skill_eval_bootstrap", { ...bootstrapProjection(result), plannedFiles: ["evals/" + "x".repeat(4096)] }, effects), /output_contract_error/);
  effects.state = "may_have_changed";
  const failure = evalFailure("skill_eval_bootstrap", new Error("output_contract_error"), effects);
  assert.equal(failure.structuredContent.effects.stages.evalDirectory, "completed");
  assert.equal(dispatches, 1); assert.equal(JSON.parse(await readFile(join(root, "evals/example/cases.json"), "utf8")).length, 2);
}));
