/**
 * ideation.mjs — file-I/O wrapper around generateCandidates.
 *
 * Behaviour contract (unchanged for callers):
 * - Reads goal.json and scan.json from runRoot; runs scanTarget() when scan.json absent.
 * - Writes ideas.json to runRoot.
 * - Returns the same result object that was written.
 *
 * Internal implementation delegates candidate generation to auto-research.mjs
 * so that callers who only need pure logic can import generateCandidates directly.
 */

import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readJson, scanTarget, writeJson } from "./runtime.mjs";
import { generateCandidates } from "./auto-research.mjs";

export function generateIdeas(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const scanPath = join(runRoot, "scan.json");
  const scan = existsSync(scanPath) ? readJson(scanPath) : scanTarget(goal.target.path, runRoot);
  const result = generateCandidates({
    targetPath: goal.target.path,
    goal,
    scan,
    limit: options.limit ?? 5
  });
  const ideasResult = {
    ...result,
    runId: goal.runId
  };
  writeJson(join(runRoot, "ideas.json"), ideasResult);
  return ideasResult;
}
