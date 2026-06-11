#!/usr/bin/env node
import { resolve } from "node:path";
import {
  VERSION,
  appendLedger,
  createRun,
  createWorktree,
  readJson,
  scanTarget
} from "./runtime.mjs";

function parseArgv(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function print(value) {
  if (typeof value === "string") {
    console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function help() {
  return `level-up ${VERSION}

Usage:
  level-up init --target <repo> --goal <goal> [--metric <metric>]
  level-up scan --run <run-root>
  level-up worktree --run <run-root> [--force]
  level-up record --run <run-root> --status keep|discard|crash --description <text> [--score <n>]
  level-up status --run <run-root>

L3 local autopilot stops before merge, deploy, and irreversible actions.`;
}

function requireValue(args, name) {
  const value = args[name];
  if (!value || value === true) {
    throw new Error(`Missing required --${name} value.`);
  }
  return value;
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const command = args._[0] ?? "help";

  if (command === "help" || args.help) {
    print(help());
    return;
  }

  if (command === "init") {
    const result = createRun({
      target: args.target ?? ".",
      workspace: args.workspace,
      goal: requireValue(args, "goal"),
      metric: args.metric,
      maxRounds: args["max-rounds"],
      maxMinutesPerRound: args["max-minutes-per-round"],
      maxNoImprovementRounds: args["max-no-improvement-rounds"],
      allowDirty: Boolean(args["allow-dirty"])
    });
    print({
      runRoot: result.runRoot,
      status: result.state.status,
      nextAction: result.state.nextAction
    });
    return;
  }

  if (command === "scan") {
    const runRoot = resolve(requireValue(args, "run"));
    const goal = readJson(resolve(runRoot, "goal.json"));
    print(scanTarget(goal.target.path, runRoot));
    return;
  }

  if (command === "worktree") {
    print(createWorktree(requireValue(args, "run"), { force: Boolean(args.force) }));
    return;
  }

  if (command === "record") {
    print(
      appendLedger(requireValue(args, "run"), {
        status: requireValue(args, "status"),
        score: args.score === undefined ? undefined : Number(args.score),
        description: requireValue(args, "description"),
        commit: args.commit,
        round: args.round
      })
    );
    return;
  }

  if (command === "status") {
    const runRoot = resolve(requireValue(args, "run"));
    print({
      goal: readJson(resolve(runRoot, "goal.json")),
      state: readJson(resolve(runRoot, "state.json"))
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`level-up: ${error.message}`);
  process.exitCode = 1;
});
