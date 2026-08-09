import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapSkillEval } from "../../dist/pi/skill-evals/bootstrap.js";
import { reviewSkillEval } from "../../dist/pi/skill-evals/review.js";

const root = await mkdtemp(join(tmpdir(), "pi-package-development-skill-evals-review-"));
const packageRoot = join(root, "target");
await mkdir(join(packageRoot, "skills/example-skill"), { recursive: true });
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: "example", scripts: { test: "echo test" } }, null, 2)}\n`);
await writeFile(join(packageRoot, "skills/example-skill/SKILL.md"), "---\nname: example-skill\ndescription: Example.\n---\n");

try {
  await bootstrapSkillEval({
    workspaceRoot: root,
    targetPackagePath: "target",
    skillPath: "skills/example-skill/SKILL.md",
    positiveCases: [{ id: "positive", prompt: "Use this skill.", promptKind: "implicit" }],
    negativeCases: [{ id: "negative", prompt: "Do something unrelated." }],
    mode: "apply",
  });
  const clean = await reviewSkillEval({ workspaceRoot: root, targetPackagePath: "target", evalPath: "evals/example-skill" });
  assert.equal(clean.summary.errors, 0);
  assert.equal(clean.summary.cases, 2);
  assert.equal(clean.summary.positiveCases, 1);
  assert.equal(clean.summary.negativeCases, 1);
  assert(clean.findings.some((item) => item.ruleId === "cases.small-prompt-set"));
  assert(clean.findings.some((item) => item.ruleId === "budgets.single-trial"));
  assert(clean.findings.some((item) => item.ruleId === "cases.no-explicit"));
  assert(clean.findings.some((item) => item.ruleId === "cases.no-contextual"));

  const casesPath = join(packageRoot, "evals/example-skill/cases.json");
  const cases = JSON.parse(await readFile(casesPath, "utf8"));
  const positiveOnly = cases.filter((item: any) => item.should_trigger);
  positiveOnly[0].prompt_kind = "negative-control";
  await writeFile(casesPath, `${JSON.stringify(positiveOnly, null, 2)}\n`);
  const runnerPath = join(packageRoot, "evals/example-skill/run-eval.ts");
  await writeFile(runnerPath, (await readFile(runnerPath, "utf8")).replaceAll("includeEvents", "eventCapture"));
  await rm(join(packageRoot, "evals/example-skill/.npmignore"));
  const pkgPath = join(packageRoot, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.scripts.test = "npx tsx evals/example-skill/run-eval.ts";
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const broken = await reviewSkillEval({ workspaceRoot: root, targetPackagePath: "target", evalPath: "evals/example-skill" });
  assert(broken.findings.some((item) => item.ruleId === "cases.no-negative" && item.level === "error"));
  assert(broken.findings.some((item) => item.ruleId === "cases.prompt-kind-trigger" && item.level === "error"));
  assert(broken.findings.some((item) => item.ruleId === "package.behavioral-in-test" && item.level === "error"));
  assert(broken.findings.some((item) => item.ruleId === "evidence.events-opt-in" && item.level === "warning"));
  assert(broken.findings.some((item) => item.ruleId === "results.npmignore" && item.level === "warning"));
  await assert.rejects(reviewSkillEval({ workspaceRoot: root, targetPackagePath: "../outside", evalPath: "evals/example-skill" }), /escapes/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi-package-development skill-eval review tests passed");
