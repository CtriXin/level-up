import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVEL_UP_ROOT = resolve(HERE, "..");

export class StateCoreCliError extends Error {
  constructor(message, result = {}) {
    super(message);
    this.name = "StateCoreCliError";
    this.status = result.status ?? 1;
    this.stdout = result.stdout ?? "";
    this.stderr = result.stderr ?? "";
  }
}

export function resolveStateCoreDir(options = {}) {
  return resolve(options.stateCoreDir ?? process.env.STATE_CORE_DIR ?? resolve(LEVEL_UP_ROOT, "..", "state-core"));
}

export function resolveStateCoreCli(options = {}) {
  return resolve(resolveStateCoreDir(options), "src", "cli.py");
}

export function runStateCoreCli(args, options = {}) {
  const cli = resolveStateCoreCli(options);
  if (!existsSync(cli)) {
    throw new StateCoreCliError(`state-core CLI not found at ${cli}`);
  }
  const result = spawnSync(options.python ?? "python3", [cli, ...args], {
    cwd: options.cwd ?? LEVEL_UP_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    throw new StateCoreCliError(`state-core CLI failed to start: ${result.error.message}`, {
      status: 1,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new StateCoreCliError(
      `state-core CLI failed (${result.status}): python3 ${[cli, ...args].join(" ")}${stderr ? `: ${stderr}` : ""}`,
      result
    );
  }
  return result.stdout.trim();
}

export function readTaskState(taskId, options = {}) {
  const stdout = runStateCoreCli(["read", "--task-id", taskId, ...rootArgs(options)], options);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new StateCoreCliError(`state-core read returned invalid JSON for ${taskId}: ${error.message}`, {
      status: 1,
      stdout,
      stderr: ""
    });
  }
}

export function setRunner(taskId, options = {}) {
  return runStateCoreCli(["set", "--task-id", taskId, "--runner", options.runner ?? "level-up", ...rootArgs(options)], options);
}

export function setLedger(taskId, ref, options = {}) {
  return runStateCoreCli(["set", "--task-id", taskId, "--ledger-ref", ref, ...rootArgs(options)], options);
}

export function reportSlot(taskId, slot, verdict, summary, options = {}) {
  const args = [
    "report",
    "--task-id",
    taskId,
    "--slot",
    slot,
    "--verdict",
    verdict,
    "--summary",
    summary,
    ...rootArgs(options)
  ];
  for (const ref of options.evidenceRefs ?? []) {
    args.push("--evidence-ref", ref);
  }
  if (options.details) {
    args.push("--details-json", JSON.stringify(options.details));
  }
  return runStateCoreCli(args, options);
}

export function advance(taskId, phase, options = {}) {
  return runStateCoreCli(["advance", "--task-id", taskId, "--phase", phase, ...rootArgs(options)], options);
}

export function taskStateToRunGoal(state) {
  const goal = state.intent?.goal || state.intent?.raw;
  if (!goal) {
    throw new Error(`task-state ${state.task_id ?? "<unknown>"} has no intent.goal or intent.raw`);
  }
  return goal;
}

function rootArgs(options) {
  return options.root ? ["--root", options.root] : [];
}
