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

test("release guidance separates repository assets from consumer artifacts", async () => {
  const readiness = await readFile(new URL("../references/package-development/release-readiness.md", import.meta.url), "utf8");
  assert.match(readiness, /Public repository and consumer artifact/);
  assert.match(readiness, /Owning a file in the package repository does not establish that npm consumers need it/);
  assert.match(readiness, /Initial-release narrative hygiene/);
  assert.match(readiness, /link: true/);
  assert.match(readiness, /Packed class \| Files\/bytes \| Consumer purpose \| Decision/);

  const smells = await readFile(new URL("../references/package-development/smell-catalog.md", import.meta.url), "utf8");
  for (const heading of ["Local-link lockfile contamination", "Development-only tarball leakage", "Pre-public migration narrative", "Transient release-operator documentation"]) {
    assert.match(smells, new RegExp(heading));
  }
});
