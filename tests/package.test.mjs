import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("declares its Pi resources", () => {
  assert.deepEqual(manifest.pi.extensions, ["./extensions/index.ts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.deepEqual(manifest.pi.prompts, ["./prompts"]);
});

test("ships the references required by the audit skill", async () => {
  const names = [
    "conventions.md",
    "smell-catalog.md",
    "audit-method.md",
    "release-readiness.md",
  ];
  for (const name of names) {
    const text = await readFile(
      new URL(`../references/package-development/${name}`, import.meta.url),
      "utf8",
    );
    assert.ok(text.length > 500, `${name} should contain substantive guidance`);
  }
});
