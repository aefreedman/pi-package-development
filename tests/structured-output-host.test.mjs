import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, VERSION } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import register from "../dist/pi/register.js";
import { bootstrapSkillEval } from "../dist/pi/skill-evals/bootstrap.js";
const runtimeVersion = VERSION;

test("current Pi compiled entry: direct, codemode, nested outcomes, hooks and transcript boundary", { timeout: 60000 }, async t => {
  assert.equal(runtimeVersion, "1.1.0");
  const root = await mkdtemp(join(tmpdir(), "pi-development-host-"));
  let session;
  const events = [], outputs = [], queue = [], nestedOutcomes = [];
  let hookMode = "none";
  try {
    await mkdir(join(root, "skills/example"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"synthetic","scripts":{}}');
    await writeFile(join(root, "skills/example/SKILL.md"), "---\nname: example\ndescription: Fixture.\n---\n");
    const bootstrapArgs = { skillPath: "skills/example/SKILL.md", positiveCases: [{ id: "positive", prompt: "Synthetic positive", promptKind: "explicit" }], negativeCases: [{ id: "negative", prompt: "Synthetic unrelated" }] };
    await bootstrapSkillEval({ workspaceRoot: root, ...bootstrapArgs, mode: "apply" });
    const timestamp = Date.parse("2026-01-02T12:00:00Z");
    await writeFile(join(root, "synthetic.jsonl"), [
      { type: "session", version: 3, id: "synthetic", timestamp },
      { type: "message", id: "a", parentId: null, timestamp, message: { role: "assistant", content: [{ type: "toolCall", name: "read", id: "read1", arguments: { path: "PRIVATE_NOT_PUBLISHED" } }] } },
      { type: "message", id: "b", parentId: "a", timestamp, message: { role: "toolResult", toolName: "read", toolCallId: "read1", content: [], isError: true } },
    ].map(JSON.stringify).join("\n"));
    const agentDir = join(root, "agent"); await mkdir(agentDir);
    const settingsManager = SettingsManager.inMemory({ defaultTools: ["pi_analyze_session", "pi_query_session", "skill_eval_review", "skill_eval_bootstrap", "codemode", "fixture_probe", "fixture_throw"], enableModelNetwork: false, retry: { enabled: false } });
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerProvider("fixture-local", {
      api: "fixture-local", apiKey: "fixture-not-a-secret", baseUrl: "http://invalid.local",
      models: [{ id: "scripted", name: "Local scripted fixture", api: "fixture-local", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
      streamSimple(model) {
        const content = queue.shift(); assert(content, "only deterministic scheduled turns are allowed");
        const stopReason = content.some(block => block.type === "toolCall") ? "toolUse" : "stop";
        const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason, timestamp: Date.now() };
        const stream = createAssistantMessageEventStream(); stream.push({ type: "start", partial: message });
        for (const [contentIndex, block] of content.entries()) {
          if (block.type === "toolCall") { stream.push({ type: "toolcall_start", contentIndex, partial: message }); stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message }); }
          else { stream.push({ type: "text_start", contentIndex, partial: message }); stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: message }); stream.push({ type: "text_end", contentIndex, content: block.text, partial: message }); }
        }
        stream.push({ type: "done", reason: stopReason, message }); stream.end(); return stream;
      },
    });
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true, extensionFactories: [register, createCodemodeExtension({ mode: "on", models: false }), pi => {
      pi.registerTool({ name: "fixture_throw", label: "Fixture throw", description: "No DTO failure fixture", parameters: Type.Object({}), outputSchema: Type.Object({ ok: Type.Boolean() }), async execute() { throw new Error("fixture-no-dto"); } });
      pi.registerTool({ name: "fixture_probe", label: "Fixture nested probe", description: "Outcome wrapper fixture", parameters: Type.Object({}), async execute(_id, _params, _signal, _update, ctx) {
        const outcome = await ctx.executeTool("skill_eval_review", { evalPath: "evals/example" }); nestedOutcomes.push(outcome);
        assert.equal(outcome.isError, false); assert.equal(outcome.result.structuredContent.ok, true);
        assert.equal(outcome.toolCall.name, "skill_eval_review");
        const failure = await ctx.executeTool("pi_query_session", { reportRef: "r_invalid" }); nestedOutcomes.push(failure);
        assert.equal(failure.isError, true); assert.equal(failure.result.structuredContent.ok, false);
        return { content: [{ type: "text", text: "nested wrapper verified" }], details: { success: true } };
      } });
      pi.on("tool_call", event => { if (hookMode === "block" && event.toolName === "skill_eval_review") return { block: true, reason: "fixture-blocked" }; });
      pi.on("tool_result", event => {
        if (event.toolName !== "skill_eval_review") return;
        if (hookMode === "drop") return { content: [{ type: "text", text: "fixture-redacted" }] };
        if (hookMode === "alter") return { structuredContent: { fixtureAltered: true } };
      });
    }] });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await createAgentSession({ cwd: root, agentDir, modelRuntime, model: modelRuntime.getModel("fixture-local", "scripted"), resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(root), tools: ["pi_analyze_session", "pi_query_session", "skill_eval_review", "skill_eval_bootstrap", "codemode", "fixture_probe", "fixture_throw"] }));
    await session.bindExtensions({});
    session.subscribe(event => { events.push(JSON.parse(JSON.stringify(event))); if (event.type === "tool_execution_end") outputs.push(event); });
    let callId = 0;
    const run = async (name, args) => {
      const id = `fixture-${++callId}`;
      queue.push([{ type: "toolCall", id, name, arguments: args }], [{ type: "text", text: "fixture finished" }]);
      await session.prompt("Run the scheduled deterministic fixture turn.");
      const end = outputs.find(event => event.toolCallId === id); assert(end, `${name} emitted a final SDK execution event`); return end;
    };
    const scan = await run("pi_analyze_session", { session: "synthetic.jsonl", since: "2026-01-02", until: "2026-01-02" });
    assert.equal(scan.isError, false, JSON.stringify(scan)); assert.equal(scan.result.structuredContent.ok, true);
    assert.equal(JSON.parse(scan.result.content[0].text).totals.failures, 1);
    const ref = scan.result.structuredContent.report.reportRef;
    const page = await run("pi_query_session", { reportRef: ref, limit: 10 });
    assert.equal(page.result.structuredContent.report.rows.length, 2);
    const preview = await run("skill_eval_bootstrap", bootstrapArgs); assert.equal(preview.result.structuredContent.result.mode, "preview");
    const review = await run("skill_eval_review", { evalPath: "evals/example" }); assert.equal(review.result.structuredContent.ok, true);
    assert(JSON.parse(review.result.content[0].text).summary.cases === 2);
    const noUI = await run("skill_eval_bootstrap", { ...bootstrapArgs, mode: "apply" }); assert.equal(noUI.isError, true); assert.equal(noUI.result.structuredContent.effects.state, "not_dispatched");
    const selected = await run("codemode", { code: `const declaration = await describeTool("pi_query_session"); if (!declaration.includes("contractVersion")) throw new Error("missing output declaration"); const r = await tools.pi_query_session({reportRef:${JSON.stringify(ref)},limit:10}); if (!r.ok) throw new Error(r.error.code); text({returned:r.report.returned,kinds:r.report.rows.map(row=>row.kind)}); const f = await tools.pi_query_session({reportRef:"r_invalid"}); text({failureResolved:f.ok===false,code:f.error.code}); try { await tools.fixture_throw({}); throw new Error("expected rejection"); } catch(e) { text({noDtoRejected:String(e).includes("fixture-no-dto")}); }` });
    assert.equal(selected.isError, false, JSON.stringify(selected)); assert.match(selected.result.content.map(block => block.text ?? "").join(), /"returned":2/); assert.match(selected.result.content.map(block => block.text ?? "").join(), /"failureResolved":true/); assert.match(selected.result.content.map(block => block.text ?? "").join(), /"noDtoRejected":true/);
    assert(!selected.result.content.map(block => block.text ?? "").join().includes("PRIVATE_NOT_PUBLISHED"));
    const probe = await run("fixture_probe", {}); assert.equal(probe.isError, false); assert.equal(nestedOutcomes.length, 2);
    hookMode = "alter";
    const altered = await run("skill_eval_review", { evalPath: "evals/example" }); assert.deepEqual(altered.result.structuredContent, { fixtureAltered: true });
    hookMode = "drop";
    const dropped = await run("skill_eval_review", { evalPath: "evals/example" }); assert.equal(dropped.result.structuredContent, undefined);
    hookMode = "block";
    const blocked = await run("codemode", { code: 'try { await tools.skill_eval_review({evalPath:"evals/example"}); text({rejected:false}); } catch(e) { text({rejected:true}); }' }); assert.match(blocked.result.content.map(block => block.text ?? "").join(), /"rejected":true/);
    const messages = session.sessionManager.getBranch().filter(entry => entry.type === "message").map(entry => entry.message);
    assert(messages.filter(message => message.role === "toolResult").every(message => !Object.hasOwn(message, "structuredContent")));
    assert(messages.some(message => message.role === "toolResult" && message.toolName === "fixture_probe" && message.nestedCalls?.calls.length === 2));
    assert(events.some(event => event.type === "tool_execution_end" && event.parentToolCallId));
    assert(events.some(event => event.type === "tool_execution_end" && event.result?.structuredContent?.contractVersion === 1));
    assert.doesNotThrow(() => JSON.stringify(events)); assert.equal(queue.length, 0);
    t.diagnostic(JSON.stringify({ runtimeVersion, compiledEntry: "dist/pi/register.js", finalEvents: outputs.length, transport: "in-process SDK; no RPC/CLI wire" }));
  } finally { session?.dispose(); await rm(root, { recursive: true, force: true }); }
});
