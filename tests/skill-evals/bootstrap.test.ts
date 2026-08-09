import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapSkillEval } from "../../dist/pi/skill-evals/bootstrap.js";

const root = await mkdtemp(join(tmpdir(), "pi-package-development-skill-evals-bootstrap-"));
const packageRoot = join(root, "target");
await mkdir(join(packageRoot, "skills/example-skill"), { recursive: true });
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: "example", scripts: { test: "echo test" } }, null, 2)}\n`);
await writeFile(join(packageRoot, "skills/example-skill/SKILL.md"), "---\nname: example-skill\ndescription: Example skill for tests.\n---\n\n# Example\n");

const options = {
  workspaceRoot: root,
  targetPackagePath: "target",
  skillPath: "skills/example-skill/SKILL.md",
  positiveCases: [{ id: "known_failure", prompt: "Use the example skill for this known failure.", promptKind: "implicit" as const }],
  negativeCases: [{ id: "unrelated", prompt: "Review an unrelated text file." }],
};

try {
  const preview = await bootstrapSkillEval(options);
  assert.equal(preview.mode, "preview");
  assert.equal(preview.caseCounts.positive, 1);
  assert(preview.plannedFiles.includes("evals/example-skill/run-eval.ts"));
  await assert.rejects(readFile(join(packageRoot, "evals/example-skill/cases.json")), /ENOENT/);

  const applied = await bootstrapSkillEval({ ...options, mode: "apply" });
  assert.equal(applied.mode, "apply");
  const cases = JSON.parse(await readFile(join(packageRoot, "evals/example-skill/cases.json"), "utf8"));
  assert.equal(cases.length, 2);
  assert.equal(cases[0].should_trigger, true);
  assert.equal(cases[0].prompt_kind, "implicit");
  assert.equal(cases[1].should_trigger, false);
  assert.equal(cases[1].prompt_kind, "negative-control");
  const config = JSON.parse(await readFile(join(packageRoot, "evals/example-skill/eval.config.json"), "utf8"));
  assert.deepEqual(config.conditions, ["available", "baseline"]);
  assert.equal(config.skillPath, "../../skills/example-skill/SKILL.md");
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["eval:example-skill"], "node --experimental-strip-types evals/example-skill/run-eval.ts");
  assert(!(pkg.scripts.test as string).includes("run-eval"));
  assert((await readFile(join(packageRoot, ".gitignore"), "utf8")).includes("evals/example-skill/latest-results.json"));
  assert((await readFile(join(packageRoot, "evals/example-skill/.npmignore"), "utf8")).split(/\r?\n/).includes("latest-results.json"));
  assert((await readFile(join(packageRoot, "evals/example-skill/run-eval.ts"), "utf8")).includes('stdio: ["ignore", "pipe", "pipe"]'));

  await assert.rejects(bootstrapSkillEval({ ...options, mode: "apply" }), /already exists/);
  await assert.rejects(bootstrapSkillEval({ ...options, skillPath: "../outside/SKILL.md" }), /escapes/);
  await assert.rejects(bootstrapSkillEval({ ...options, negativeCases: [] }), /At least one negative case/);
  await assert.rejects(bootstrapSkillEval({ ...options, positiveCases: [{ id: "escape", prompt: "x", fixture: "../outside" }] }), /Invalid fixture path/);
  await assert.rejects(bootstrapSkillEval({ ...options, positiveCases: [{ id: "wrong_kind", prompt: "x", promptKind: "negative-control" }] }), /Invalid positive prompt kind/);

  const linkedPackage = join(root, "linked-target");
  const externalEvals = join(root, "external-evals");
  await mkdir(join(linkedPackage, "skills/example-skill"), { recursive: true });
  await mkdir(externalEvals, { recursive: true });
  await writeFile(join(linkedPackage, "package.json"), `${JSON.stringify({ name: "linked" })}\n`);
  await writeFile(join(linkedPackage, "skills/example-skill/SKILL.md"), "---\nname: example-skill\ndescription: Example.\n---\n");
  try {
    await symlink(externalEvals, join(linkedPackage, "evals"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(bootstrapSkillEval({ ...options, targetPackagePath: "linked-target", mode: "apply" }), /symbolic link|junction/i);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }

  const concurrentPackage = join(root, "concurrent-target");
  await mkdir(join(concurrentPackage, "skills/example-skill"), { recursive: true });
  await writeFile(join(concurrentPackage, "package.json"), `${JSON.stringify({ name: "concurrent" })}\n`);
  await writeFile(join(concurrentPackage, "skills/example-skill/SKILL.md"), "---\nname: example-skill\ndescription: Example.\n---\n");
  const concurrentOptions = { ...options, targetPackagePath: "concurrent-target", mode: "apply" as const };
  const concurrentResults = await Promise.allSettled([bootstrapSkillEval(concurrentOptions), bootstrapSkillEval(concurrentOptions)]);
  assert.equal(concurrentResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrentResults.filter((item) => item.status === "rejected").length, 1);
  assert((await readFile(join(concurrentPackage, "evals/example-skill/cases.json"), "utf8")).includes("known_failure"));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("pi-package-development skill-eval bootstrap tests passed");
