import assert from "node:assert/strict";
import test from "node:test";
import { evalEffects, evalSuccess, evalFailure } from "../dist/pi/skill-eval-output.js";

test("bootstrap presentation omission is independent; admitted relative refs remain exact", () => {
  const effects = evalEffects(); effects.state = "none";
  const result = { mode: "preview", evalName: "example", packageScript: "eval:example", scriptCommand: "node --experimental-strip-types evals/example/run-eval.ts", caseCounts: { positive: 20, negative: 20 }, plannedFiles: Array.from({ length: 46 }, (_, i) => `evals/example/${i}-${"x".repeat(500)}`) };
  const native = evalSuccess("skill_eval_bootstrap", result, effects);
  assert.equal(native.structuredContent.result.plannedFiles.length, 46);
  assert.deepEqual(native.structuredContent.result.plannedFiles, result.plannedFiles);
  const display = JSON.parse(native.content[0].text);
  assert(display.presentationOmittedFiles > 0);
  assert.equal(display.plannedFiles.length + display.presentationOmittedFiles, 46);
  assert(Buffer.byteLength(native.content[0].text) <= 8192);
  assert(Buffer.byteLength(JSON.stringify(native.structuredContent)) <= 32768);
  assert.throws(() => evalSuccess("skill_eval_bootstrap", { ...result, plannedFiles: Array(46).fill("evals/" + "x".repeat(1000)) }, effects), /output_contract_error/);
  const exact = "evals/" + "x".repeat(4090);
  assert.equal(evalSuccess("skill_eval_bootstrap", { ...result, plannedFiles: [exact] }, effects).structuredContent.result.plannedFiles[0], exact);
  assert.throws(() => evalSuccess("skill_eval_bootstrap", { ...result, plannedFiles: [exact + "x"] }, effects), /output_contract_error/);
});

test("unsafe reconciliation references are withheld explicitly, never clipped", () => {
  const effects = evalEffects(); effects.state = "completed";
  effects.changedReferences = ["evals/" + "x".repeat(4096)];
  const failure = evalFailure("skill_eval_bootstrap", new Error("output_contract_error"), effects);
  assert.equal(failure.structuredContent.effects.state, "may_have_changed");
  assert.equal(failure.structuredContent.effects.referencesOmitted, true);
  assert.deepEqual(failure.structuredContent.effects.changedReferences, []);
});
