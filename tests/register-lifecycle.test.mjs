import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import test from "node:test";
import registerPackageDevelopment from "../dist/pi/register.js";
import { packageReferenceOwnersV1 } from "@aefree/pi-package-references/runtime/v1";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageRoot = await realpath(new URL("../", import.meta.url));

class FakePi {
  handlers = new Map();

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  async emit(event, sessionManager) {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler({}, { sessionManager });
    }
  }
}

function owners(sessionManager) {
  return packageReferenceOwnersV1(sessionManager);
}

test("session_start registers the package's public reference mount and shutdown cleans it up", async () => {
  const pi = new FakePi();
  const sessionManager = {};
  registerPackageDevelopment(pi);

  assert.equal(pi.handlers.get("session_start")?.length, 1);
  assert.equal(pi.handlers.get("session_shutdown")?.length, 1);
  await pi.emit("session_start", sessionManager);

  const [owner] = owners(sessionManager);
  assert.equal(owners(sessionManager).length, 1);
  assert.deepEqual({
    contractVersion: owner.contractVersion,
    packageName: owner.packageName,
    packageVersion: owner.packageVersion,
    packageRoot: owner.packageRoot,
    registeredBy: owner.registeredBy,
    publicMounts: owner.publicMounts.map(({ prefix, directory, extensions }) => ({
      prefix,
      directory,
      extensions,
    })),
  }, {
    contractVersion: 1,
    packageName: manifest.name,
    packageVersion: manifest.version,
    packageRoot,
    registeredBy: "extensions/index.ts",
    publicMounts: [{
      prefix: "references/package-development/",
      directory: "references/package-development",
      extensions: [".md"],
    }],
  });

  await pi.emit("session_shutdown", sessionManager);
  assert.deepEqual(owners(sessionManager), []);
  await pi.emit("session_shutdown", sessionManager);
  assert.deepEqual(owners(sessionManager), []);
});

test("repeated starts replace old registrations and stale shutdown cannot clear the active session", async () => {
  const pi = new FakePi();
  const firstSessionManager = {};
  const secondSessionManager = {};
  registerPackageDevelopment(pi);

  await pi.emit("session_start", firstSessionManager);
  assert.equal(owners(firstSessionManager).length, 1);
  await pi.emit("session_start", firstSessionManager);
  assert.equal(owners(firstSessionManager).length, 1);

  await pi.emit("session_start", secondSessionManager);
  assert.deepEqual(owners(firstSessionManager), []);
  assert.equal(owners(secondSessionManager).length, 1);

  await pi.emit("session_shutdown", firstSessionManager);
  assert.equal(owners(secondSessionManager).length, 1);
  await pi.emit("session_shutdown", secondSessionManager);
  assert.deepEqual(owners(secondSessionManager), []);
});
