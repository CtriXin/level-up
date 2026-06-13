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
import { generateIdeas } from "./ideation.mjs";
import { generatePrPack } from "./pr-pack.mjs";
import { runDevLoop } from "./dev-loop.mjs";
import { generateWorkPack } from "./work-pack.mjs";
import { runAutopilot } from "./autopilot.mjs";
import { generateRunnerPacket } from "./runner.mjs";
import { notifyFeishu } from "./notify.mjs";
import { generateRunReport } from "./report.mjs";
import { runRedlineAudit } from "./redline.mjs";
import { cleanupMergedWorktrees } from "./worktree-cleanup.mjs";
import runPostMergeCleanup from "./post-merge.mjs";
import { readTaskState, setRunner, taskStateToRunGoal } from "./state-core.mjs";
import { parseDuration } from "./duration.mjs";

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
  level-up init --target <repo> (--goal <goal>|--task-id <state-core-task>) [--metric <metric>]
  level-up scan --run <run-root>
  level-up ideas --run <run-root>
  level-up work-pack --run <run-root>
  level-up runner-pack --run <run-root> [--runner current-session|opencode-profile|mms-runner|external-command] [--runner-profile <name>]
  level-up dev-loop --run <run-root> --phase baseline|experiment|final [--execute]
  level-up run --run <run-root> [--execute] [--pr-pack] [--rounds <n>] [--budget <5m|30s|ms>] [--max-no-improvement <n>] [--runner <type>] [--runner-profile <name>] [--candidate <id>] [--apply-command <cmd>|--apply-patch <file>|--apply-write-file <path> --apply-content <text>] [--commit-kept]
  level-up worktree --run <run-root> [--force]
  level-up record --run <run-root> --status keep|discard|crash --description <text> [--score <n>]
  level-up pr-pack --run <run-root> [--visual] [--reviewer-bot <name>]
  level-up redline --run <run-root> --url <pr-or-mr-url> [--validate] [--notify]
  level-up report --run <run-root> [--format zh] [--link <pr-or-mr-url>] [--notify-status <text>]
  level-up notify --channel feishu --repo <name> --branch <source -> target> --title <title> --link <url> [--dry-run]
  level-up cleanup-worktrees [--repo <repo>] [--base-ref origin/main] [--execute] [--delete-branches]
  level-up post-merge [--repo <repo>] [--base-ref origin/main] [--run <run-root>] [--output-dir <dir>] [--execute] [--delete-branches] [--prune-branches] [--branch-prefix codex/]
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
    const stateCore = args["task-id"] ? readTaskState(args["task-id"], stateCoreOptions(args)) : null;
    const goal = args.goal === true ? null : args.goal;
    const result = createRun({
      target: args.target ?? ".",
      workspace: args.workspace,
      goal: goal || (stateCore ? taskStateToRunGoal(stateCore) : requireValue(args, "goal")),
      metric: args.metric,
      maxRounds: args["max-rounds"],
      maxMinutesPerRound: args["max-minutes-per-round"],
      maxNoImprovementRounds: args["max-no-improvement-rounds"],
      allowDirty: Boolean(args["allow-dirty"]),
      stateCoreTask: stateCore
        ? {
            taskId: stateCore.task_id,
            size: stateCore.size,
            intentRaw: stateCore.intent?.raw,
            root: args["state-root"] === true ? null : args["state-root"],
            stateCoreDir: args["state-core-dir"] === true ? null : args["state-core-dir"]
          }
        : null
    });
    if (stateCore) {
      setRunner(stateCore.task_id, stateCoreOptions(args));
    }
    print({
      runRoot: result.runRoot,
      status: result.state.status,
      nextAction: result.state.nextAction,
      stateCore: result.goal.stateCore ?? null
    });
    return;
  }

  if (command === "scan") {
    const runRoot = resolve(requireValue(args, "run"));
    const goal = readJson(resolve(runRoot, "goal.json"));
    print(scanTarget(goal.target.path, runRoot));
    return;
  }

  if (command === "ideas") {
    print(generateIdeas(requireValue(args, "run"), { limit: args.limit }));
    return;
  }

  if (command === "work-pack") {
    print(generateWorkPack(requireValue(args, "run")));
    return;
  }

  if (command === "runner-pack") {
    print(
      generateRunnerPacket(requireValue(args, "run"), {
        runner: args.runner === true ? null : args.runner,
        profile: args["runner-profile"] === true ? null : args["runner-profile"],
        candidate: args.candidate === true ? null : args.candidate,
        worktreePath: args.worktree === true ? null : args.worktree,
        skills: args.skills,
        mcp: args.mcp,
        tools: args.tools
      })
    );
    return;
  }

  if (command === "dev-loop") {
    print(
      runDevLoop(requireValue(args, "run"), {
        phase: requireValue(args, "phase"),
        execute: Boolean(args.execute)
      })
    );
    return;
  }

  if (command === "run") {
    const runRoot = requireValue(args, "run");
    const summary = runAutopilot(runRoot, {
        execute: Boolean(args.execute),
        prPack: Boolean(args["pr-pack"]),
        visual: Boolean(args.visual),
        force: Boolean(args.force),
        candidate: args.candidate === true ? null : args.candidate,
        applyCommand: args["apply-command"] === true ? null : args["apply-command"],
        applyPatch: args["apply-patch"] === true ? null : args["apply-patch"],
        applyWriteFile: args["apply-write-file"] === true ? null : args["apply-write-file"],
        applyContent: args["apply-content"] === true ? "" : args["apply-content"],
        applyContentFile: args["apply-content-file"] === true ? null : args["apply-content-file"],
        runner: args.runner === true ? null : args.runner,
        runnerProfile: args["runner-profile"] === true ? null : args["runner-profile"],
        skills: args.skills,
        mcp: args.mcp,
        tools: args.tools,
        commitKept: Boolean(args["commit-kept"]),
        rounds: args.rounds === true ? undefined : args.rounds,
        budgetMs: parseDuration(args.budget),
        maxNoImprovement: args["max-no-improvement"] === true ? undefined : args["max-no-improvement"]
    });
    if (args.report) {
      summary.report = generateRunReport(runRoot, reportOptions(args));
    }
    print(summary);
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

  if (command === "pr-pack") {
    print(
      generatePrPack(requireValue(args, "run"), {
        visual: Boolean(args.visual),
        reviewerBot: args["reviewer-bot"] === true ? null : args["reviewer-bot"]
      })
    );
    return;
  }

  if (command === "report") {
    if (args.redline) {
      runRedlineAudit(requireValue(args, "run"), redlineOptions(args));
    }
    print(generateRunReport(requireValue(args, "run"), reportOptions(args)));
    return;
  }

  if (command === "redline") {
    print(runRedlineAudit(requireValue(args, "run"), redlineOptions(args)));
    return;
  }

  if (command === "notify") {
    const channel = args.channel || "feishu";
    if (channel !== "feishu") {
      throw new Error(`Unsupported notify channel: ${channel}`);
    }
    print(
      await notifyFeishu({
        webhookEnv: args["webhook-env"] === true ? null : args["webhook-env"],
        model: args.model === true ? null : args.model,
        family: args.family === true ? null : args.family,
        repo: args.repo,
        branch: args.branch,
        title: args.title,
        link: args.link,
        status: args.status === true ? null : args.status,
        effect: args.effect === true ? null : args.effect,
        nextStep: args["next-step"] === true ? null : args["next-step"],
        provider: args.provider === true ? null : args.provider,
        dryRun: Boolean(args["dry-run"])
      })
    );
    return;
  }

  if (command === "cleanup-worktrees") {
    print(cleanupMergedWorktrees(args.repo === true ? "." : args.repo || ".", {
      baseRef: args["base-ref"] === true ? null : args["base-ref"],
      execute: Boolean(args.execute),
      deleteBranches: Boolean(args["delete-branches"])
    }));
    return;
  }

  if (command === "post-merge") {
    print(runPostMergeCleanup({
      repo: args.repo === true ? "." : args.repo || ".",
      baseRef: args["base-ref"] === true ? null : args["base-ref"],
      execute: Boolean(args.execute),
      deleteBranches: Boolean(args["delete-branches"]),
      pruneBranches: Boolean(args["prune-branches"]),
      branchPrefix: args["branch-prefix"] === true ? null : args["branch-prefix"],
      outputDir: args["output-dir"] === true
        ? null
        : args["output-dir"] || (args.run === true ? null : args.run)
    }));
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

function reportOptions(args) {
  return {
    format: args.format === true ? "zh" : args.format,
    link: args.link === true ? null : args.link,
    prLink: args["pr-link"] === true ? null : args["pr-link"],
    mrLink: args["mr-link"] === true ? null : args["mr-link"],
    notifyStatus: args["notify-status"] === true ? null : args["notify-status"]
  };
}

function redlineOptions(args) {
  return {
    url: args.url === true ? null : args.url,
    link: args.link === true ? null : args.link,
    prLink: args["pr-link"] === true ? null : args["pr-link"],
    mrLink: args["mr-link"] === true ? null : args["mr-link"],
    validate: Boolean(args.validate),
    notify: Boolean(args.notify),
    actions: Boolean(args.actions),
    reportUrl: args["report-url"] === true ? null : args["report-url"],
    webhookUrl: args["webhook-url"] === true ? null : args["webhook-url"],
    bin: args["redline-bin"] === true ? null : args["redline-bin"],
    timeoutMs: args["redline-timeout-ms"] === true ? null : args["redline-timeout-ms"]
  };
}

function stateCoreOptions(args) {
  return {
    stateCoreDir: args["state-core-dir"] === true ? null : args["state-core-dir"],
    root: args["state-root"] === true ? null : args["state-root"]
  };
}

main().catch((error) => {
  console.error(`level-up: ${error.message}`);
  process.exitCode = 1;
});
