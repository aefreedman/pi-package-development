import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RegistrationToken } from "@aefree/pi-capability-registry";
import {
  registerPackageReferenceOwnerV1,
  unregisterPackageReferenceOwnerV1,
} from "@aefree/pi-package-references/runtime/v1";
import { registerSessionAnalysis } from "./session-analysis.js";

interface Manifest {
  name: string;
  version: string;
}

export default function registerPackageDevelopment(pi: ExtensionAPI): void {
  registerSessionAnalysis(pi);

  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  ) as Manifest;
  let activeScope: object | undefined;
  let token: RegistrationToken | undefined;

  pi.on("session_start", async (_event, ctx) => {
    unregisterPackageReferenceOwnerV1(token);
    activeScope = ctx.sessionManager;
    token = await registerPackageReferenceOwnerV1(ctx.sessionManager, {
      contractVersion: 1,
      packageName: manifest.name,
      packageVersion: manifest.version,
      packageRoot,
      registeredBy: "extensions/index.ts",
      publicMounts: [
        {
          prefix: "references/package-development/",
          directory: "references/package-development",
          extensions: [".md"],
        },
      ],
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.sessionManager !== activeScope) return;
    unregisterPackageReferenceOwnerV1(token);
    token = undefined;
    activeScope = undefined;
  });
}
