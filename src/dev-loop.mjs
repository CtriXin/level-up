// DEPRECATED/FROZEN: level-up 执行环已废弃,改用 looper;勿新增依赖。见 docs/STATUS.md
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, VERSION, writeJson } from "./runtime.mjs";

const PHASES = new Set(["baseline", "experiment", "final"]);

export function runDevLoop(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const phase = options.phase || "baseline";
  if (!PHASES.has(phase)) {
    throw new Error("--phase must be one of: baseline, experiment, final");
  }

  const goal = readJson(join(runRoot, "goal.json"));
  const state = readJson(join(runRoot, "state.json"));
  const scan = readOptionalJson(join(runRoot, "scan.json"));
  const createdAt = new Date().toISOString();
  const cwd = chooseCwd(goal, state, phase);
  const commands = buildCommands({ phase, scan, cwd });
  const executable = Boolean(options.execute);

  const result = {
    version: VERSION,
    runId: goal.runId,
    phase,
    status: "planned",
    executed: executable,
    cwd,
    commands,
    createdAt
  };

  if (commands.length === 0) {
    result.status = "blocked";
    result.summary = "No validation commands detected. Define validation before running this phase.";
  } else if (executable) {
    result.commands = commands.map((command) => runCommand(cwd, command.command));
    result.status = result.commands.every((command) => command.status === "pass") ? "pass" : "fail";
  }

  const outPath = join(runRoot, `dev-loop-${phase}.json`);
  writeJson(outPath, result);
  return result;
}

function readOptionalJson(path) {
  return existsSync(path) ? readJson(path) : null;
}

function chooseCwd(goal, state, phase) {
  if ((phase === "experiment" || phase === "final") && state.worktreePath) {
    return state.worktreePath;
  }
  return goal.target.path;
}

function buildCommands({ phase, scan }) {
  const validation = scan?.suggestedValidation ?? [];
  const commands = [];
  if (phase === "experiment") {
    commands.push({ command: "git diff --check", status: "pending" });
  }
  for (const command of validation) {
    commands.push({ command, status: "pending" });
  }
  if (phase === "final") {
    commands.push({ command: "git status --short", status: "pending" });
  }
  return commands;
}

function runCommand(cwd, command) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    command,
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}
