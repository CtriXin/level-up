// 独立机器 intake 源:不依赖 level-up 执行环,可被外部复用;入口见 machine-intake.mjs
/**
 * machine-intake.mjs — end-to-end machine intake entry point.
 *
 * Orchestrates: scan repo → generate candidates (auto-research) →
 * map to packets (outpact-adapter) → register tasks in state-core via CLI.
 *
 * Constraints:
 * - May import auto-research.mjs, outpact-adapter.mjs, util.mjs only.
 * - Does NOT import state-core.mjs or any execution-environment module
 *   (autopilot, strategy, evaluator, apply, runner, etc.).
 * - Calls state-core CLI via spawnSync child process only.
 * - dryRun=true: no file I/O, no CLI calls; returns "will-execute" commands.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { generateCandidates } from "./auto-research.mjs";
import { candidatesToPackets } from "./outpact-adapter.mjs";

// ---------------------------------------------------------------------------
// Risk normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a free-text risk_hint like "Low; may reveal missing scripts" to
 * one of "low" | "medium" | "high". Defaults to "low" when unrecognised.
 *
 * @param {string|undefined} riskHint
 * @returns {"low"|"medium"|"high"}
 */
function normalizeRisk(riskHint) {
  if (!riskHint || typeof riskHint !== "string") return "low";
  const first = riskHint.trim().toLowerCase().split(/[;,\s]/)[0];
  if (first === "high") return "high";
  if (first === "medium") return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Task-id de-duplication
// ---------------------------------------------------------------------------

/**
 * Build a unique task-id for a packet within this batch.
 * Base: `auto-research-<candidate_id>`.
 * Duplicates get `-2`, `-3`, … suffix.
 *
 * @param {string} candidateId
 * @param {Set<string>} seen   Mutated in place.
 * @returns {string}
 */
function makeTaskId(candidateId, seen) {
  const base = `auto-research-${candidateId}`;
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let n = 2;
  while (seen.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  seen.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// CLI invocation helpers
// ---------------------------------------------------------------------------

/**
 * Run a state-core CLI subcommand via spawnSync.
 * Throws on non-zero exit with the captured stderr.
 *
 * @param {string} stateCoreDir  Path to state-core repo root (contains src/cli.py).
 * @param {string[]} cliArgs     Arguments after "python3 src/cli.py".
 */
function runStateCoreCliArgs(stateCoreDir, cliArgs) {
  const result = spawnSync("python3", ["src/cli.py", ...cliArgs], {
    cwd: stateCoreDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      `state-core CLI failed (exit ${result.status}): ${stderr || "(no stderr)"}`
    );
  }
  return result.stdout ?? "";
}

/**
 * Build the arg-list for `python3 src/cli.py new ...`.
 *
 * @param {string}  taskId
 * @param {object}  packet
 * @param {string}  dataRoot   state-core data root (--root), NOT the code dir.
 * @returns {string[]}
 */
function buildNewArgs(taskId, packet, dataRoot) {
  const intent = [
    packet.scope.path,
    packet.work_type,
    packet.action_spec.summary
  ].join(" | ");

  return [
    "new",
    "--task-id", taskId,
    "--intent", intent,
    "--goal", packet.action_spec.expected_impact ?? "",
    "--kind", "feature",
    "--size", packet.size_hint ?? "small",
    "--risk", normalizeRisk(packet.meta?.risk_hint),
    "--root", dataRoot
  ];
}

/**
 * Build the arg-list for `python3 src/cli.py set ...`.
 *
 * @param {string}  taskId
 * @param {object}  packet
 * @param {string}  dataRoot       state-core data root (--root), NOT the code dir.
 * @param {string}  evidenceDir    Base evidence directory.
 * @returns {string[]}
 */
function buildSetArgs(taskId, packet, dataRoot, evidenceDir) {
  const nextAction = `[${packet.task_mode}] ${packet.action_spec.hypothesis}`;
  const evidenceRoot = resolve(join(evidenceDir, taskId));
  const ledgerRef = join(evidenceRoot, "packet.json");

  return [
    "set",
    "--task-id", taskId,
    "--next-action", nextAction,
    "--owner", "auto-research",
    "--evidence-root", evidenceRoot,
    "--ledger-ref", ledgerRef,
    "--root", dataRoot
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * End-to-end machine intake: scan repo → candidates → packets → state-core tasks.
 *
 * @param {object} params
 * @param {string}  params.targetPath     Absolute path to the git repo to scan.
 * @param {object}  params.goal           Parsed goal object (from goal.json).
 * @param {string}  params.stateCoreDir   Absolute path to state-core repo root.
 *                                        Used ONLY as the CLI cwd so python can
 *                                        resolve src/cli.py + its imports.
 * @param {string}  [params.dataRoot]     state-core data root passed as --root.
 *                                        Defaults to stateCoreDir (backward compat),
 *                                        but callers/tests SHOULD pass an isolated
 *                                        directory so task data does not land in
 *                                        the state-core source tree.
 * @param {string}  [params.evidenceDir]  Where to write per-task packet.json files.
 *                                        Defaults to "<cwd>/evidence".
 * @param {number}  [params.limit=5]      Max candidates to generate.
 * @param {boolean} [params.dryRun=false] When true, collect commands but do not
 *                                        execute them or write any files.
 * @returns {Array<{taskId, packet, newArgs, setArgs, executed: boolean}>}
 */
export function runMachineIntake({
  targetPath,
  goal,
  stateCoreDir,
  dataRoot,
  evidenceDir,
  limit = 5,
  dryRun = false
}) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error("runMachineIntake: targetPath (string) is required");
  }
  if (!goal || typeof goal !== "object") {
    throw new Error("runMachineIntake: goal (object) is required");
  }
  if (!stateCoreDir || typeof stateCoreDir !== "string") {
    throw new Error("runMachineIntake: stateCoreDir (string) is required");
  }

  const resolvedEvidenceDir = resolve(evidenceDir ?? join(process.cwd(), "evidence"));
  const resolvedStateCoreDir = resolve(stateCoreDir);
  // dataRoot defaults to stateCoreDir for backward compat; callers SHOULD pass
  // an isolated dir to keep machine-generated task data out of the source tree.
  const resolvedDataRoot = resolve(dataRoot ?? stateCoreDir);

  // Step a: generate candidates
  const ideation = generateCandidates({ targetPath, goal, limit });

  // Step b: map to packets
  const packets = candidatesToPackets(ideation, { targetPath, goal });

  // Step c: create state-core tasks
  const seen = new Set();
  const results = [];

  for (const packet of packets) {
    const taskId = makeTaskId(packet.meta.candidate_id, seen);
    const newArgs = buildNewArgs(taskId, packet, resolvedDataRoot);
    const setArgs = buildSetArgs(taskId, packet, resolvedDataRoot, resolvedEvidenceDir);

    if (!dryRun) {
      // Write packet.json evidence file
      const taskEvidenceDir = join(resolvedEvidenceDir, taskId);
      mkdirSync(taskEvidenceDir, { recursive: true });
      writeFileSync(
        join(taskEvidenceDir, "packet.json"),
        `${JSON.stringify(packet, null, 2)}\n`
      );

      // Execute: new
      runStateCoreCliArgs(resolvedStateCoreDir, newArgs);
      // Execute: set
      runStateCoreCliArgs(resolvedStateCoreDir, setArgs);
    }

    results.push({ taskId, packet, newArgs, setArgs, executed: !dryRun });
  }

  return results;
}
