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

test("ships session analysis tooling and prompt guidance", async () => {
  const source = await readFile(new URL("../src/pi/session-analysis.ts", import.meta.url), "utf8");
  const prompt = await readFile(new URL("../prompts/analyze-session.md", import.meta.url), "utf8");
  assert.match(source, /name: "pi_analyze_session"/);
  assert.match(source, /historical\/untrusted evidence/);
  assert.match(source, /approvedSourceRoots/);
  assert.match(prompt, /Review the analysis method itself/);

  for (const fixture of ["parallel-search-10.jsonl", "parallel-search-8.jsonl", "identifier-bulk-amplification.jsonl", "windows-secondary.jsonl", "malformed.jsonl"]) {
    const contents = await readFile(new URL(`../tests/fixtures/session-analysis/${fixture}`, import.meta.url), "utf8");
    assert.ok(contents.length > 0, `${fixture} should contain synthetic regression evidence`);
  }
});

test("ships Pi-native streamlining guidance", async () => {
  const skill = await readFile(new URL("../skills/streamlining-skills/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /name: streamlining-skills/);
  assert.match(skill, /Pi loads the selected skill's complete `SKILL\.md`/);
  assert.doesNotMatch(skill, /Follow nested `@/);

  for (const name of ["checklist.md", "frontmatter.md", "ref-splitting.md", "section-normalization.md"]) {
    const reference = await readFile(new URL(`../skills/streamlining-skills/references/${name}`, import.meta.url), "utf8");
    assert.ok(reference.length > 400, `${name} should contain substantive Pi guidance`);
  }
});

test("ships the expected trusted-publishing release workflow", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /release:\s*\n\s+types:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /environment: npm/);
  assert.match(workflow, /npm@\^11\.5\.1/);
  assert.match(workflow, /npm publish --access public --provenance/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
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
