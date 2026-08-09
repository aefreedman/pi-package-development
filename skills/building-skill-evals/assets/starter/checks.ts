export type CheckContext = {
  answer: string;
  guidance: string;
  changedPaths: string[];
  toolCalls: Array<{ name: string; args: unknown }>;
  toolErrors: number;
  condition: "available" | "baseline" | "forced";
  skillLoaded: boolean;
  auditRoot: string;
};

/**
 * Add package-specific, outcome-focused checks here.
 * Return undefined for check IDs this module does not own.
 */
export function evaluateCustomCheck(checkId: string, context: CheckContext): boolean | undefined {
  void context;
  switch (checkId) {
    // Example:
    // case "expected_api_used": return context.answer.includes("expectedApi(");
    default: return undefined;
  }
}
