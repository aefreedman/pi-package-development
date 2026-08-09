import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerPackageDevelopment from "../dist/pi/register.js";

test("bootstrap confirmation identifies the resolved eval mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-development-confirmation-"));
  const packageRoot = join(root, "target");
  let confirmation;
  try {
    await mkdir(join(packageRoot, "skills/directory-name"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), '{"name":"target","scripts":{}}\n');
    await writeFile(join(packageRoot, "skills/directory-name/SKILL.md"), "---\nname: resolved-eval-name\ndescription: Example.\n---\n");

    const tools = new Map();
    registerPackageDevelopment({
      on() {},
      registerTool(tool) { tools.set(tool.name, tool); },
    });
    const bootstrap = tools.get("skill_eval_bootstrap");
    assert.ok(bootstrap);

    await assert.rejects(
      bootstrap.execute("confirmation", {
        targetPackagePath: "target",
        skillPath: "skills/directory-name/SKILL.md",
        positiveCases: [{ id: "positive", prompt: "Use this skill.", promptKind: "explicit" }],
        negativeCases: [{ id: "negative", prompt: "Do unrelated work." }],
        mode: "apply",
      }, undefined, undefined, {
        cwd: root,
        hasUI: true,
        ui: {
          async confirm(_title, detail) {
            confirmation = detail;
            return false;
          },
        },
      }),
      /was not confirmed/,
    );

    assert.match(confirmation, /evals\/resolved-eval-name/);
    assert.match(confirmation, /eval:resolved-eval-name/);
    assert.match(confirmation, /bootstrap-lock ignore rules/);
    assert.deepEqual(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).scripts, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
