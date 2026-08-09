import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function stripAtPrefix(value: string): string {
  return value.trim().replace(/^@/, "");
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function resolveExistingWithin(root: string, input: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const lexical = resolve(canonicalRoot, stripAtPrefix(input));
  if (!isWithin(canonicalRoot, lexical)) throw new Error(`Path escapes workspace root: ${input}`);
  const stats = await lstat(lexical);
  if (stats.isSymbolicLink()) throw new Error(`Symbolic-link targets are not accepted: ${input}`);
  const canonical = await realpath(lexical);
  if (!isWithin(canonicalRoot, canonical)) throw new Error(`Canonical path escapes workspace root: ${input}`);
  return canonical;
}

export function resolveNewWithin(root: string, input: string): string {
  const candidate = resolve(root, stripAtPrefix(input));
  if (!isWithin(root, candidate)) throw new Error(`Path escapes package root: ${input}`);
  return candidate;
}

export async function assertNoSymlinkComponents(root: string, target: string): Promise<void> {
  if (!isWithin(root, target)) throw new Error(`Mutation target escapes package root: ${target}`);
  const components: string[] = [];
  let current = target;
  while (isWithin(root, current) && current !== root) {
    components.push(current);
    current = dirname(current);
  }
  for (const component of components.reverse()) {
    try {
      const stats = await lstat(component);
      if (stats.isSymbolicLink()) throw new Error(`Mutation path contains a symbolic link or junction: ${component}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") break;
      throw error;
    }
  }
}
