import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { advance, reportSlot, setLedger } from "./state-core.mjs";

export const VERSION = "0.1.0";

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "goal";
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function runGit(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr.trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

export function assertGitRepo(target) {
  const result = runGit(target, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`Target is not a git repository: ${target}`);
  }
  return realpathSync(result.stdout);
}

export function getGitHead(target) {
  return runGit(target, ["rev-parse", "--short=12", "HEAD"]).stdout;
}

export function getGitStatus(target) {
  return runGit(target, ["status", "--porcelain"], { allowFailure: true }).stdout;
}

export function defaultGuardrails() {
  return [
    "build must pass",
    "tests must pass when available",
    "no secrets, billing, ads, or production data changes",
    "no global config changes",
    "no merge or deploy without human approval",
    "no destructive cleanup in the user's current worktree"
  ];
}

export function defaultQuestions() {
  return [
    {
      id: "upgrade-lanes",
      title: "Which upgrade lanes should this run consider?",
      mode: "multi",
      blocking: true,
      allowCustom: true,
      chatAboutThis: true,
      options: [
        {
          id: "performance",
          label: "Performance",
          description: "Optimize measurable loading/runtime metrics.",
          recommended: true
        },
        {
          id: "ui",
          label: "UI quality",
          description: "Improve visual polish, responsive behavior, and accessibility."
        },
        {
          id: "code-health",
          label: "Code health",
          description: "Reduce complexity, duplication, brittle tests, or risky structure."
        },
        {
          id: "custom",
          label: "Custom",
          description: "Let the user define a target that does not fit the defaults."
        }
      ]
    },
    {
      id: "autopilot-budget",
      title: "How much local autonomy should this run get?",
      mode: "single",
      blocking: true,
      allowCustom: true,
      chatAboutThis: true,
      options: [
        {
          id: "l3-8-rounds",
          label: "L3, 8 rounds",
          description: "Local worktree experiments, auto keep/discard, stop before merge/deploy.",
          recommended: true
        },
        {
          id: "l3-3-rounds",
          label: "L3, 3 rounds",
          description: "Short probe for unknown repos."
        },
        {
          id: "plan-only",
          label: "Plan only",
          description: "No code mutation; useful when risk is high."
        }
      ]
    }
  ];
}

export function createRun(options) {
  const targetInput = options.target ? resolve(options.target) : process.cwd();
  const target = assertGitRepo(targetInput);
  const objective = options.goal?.trim();
  if (!objective) {
    throw new Error("Missing required --goal value.");
  }

  const dirtyStatus = getGitStatus(target);
  const dirty = dirtyStatus.length > 0;
  const head = getGitHead(target);
  const createdAt = nowIso();
  const runId = `${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${slugify(objective)}`;
  const workspace = options.workspace ? resolve(options.workspace) : target;
  const runRoot = join(workspace, ".level-up", "runs", runId);
  ensureDir(runRoot);

  const blockedByDirtyTarget = dirty && !options.allowDirty;
  const goal = {
    version: VERSION,
    runId,
    createdAt,
    target: {
      path: target,
      head,
      dirty
    },
    objective,
    mode: "l3-local-autopilot",
    primaryMetric: parseMetric(options.metric),
    guardrails: defaultGuardrails(),
    nonGoals: [
      "Do not merge.",
      "Do not deploy.",
      "Do not change product behavior unless explicitly part of the goal.",
      "Do not modify unrelated repositories."
    ],
    forbiddenActions: [
      "merge",
      "deploy",
      "force-push",
      "global config changes",
      "secret access or disclosure",
      "billing, ads, or production data mutation"
    ],
    stopConditions: {
      maxRounds: Number(options.maxRounds ?? 8),
      maxMinutesPerRound: Number(options.maxMinutesPerRound ?? 20),
      maxNoImprovementRounds: Number(options.maxNoImprovementRounds ?? 3)
    },
    humanGates: ["merge", "deploy", "production data mutation", "cross-repository write"]
  };
  if (options.stateCoreTask) {
    goal.stateCore = normalizeStateCoreTask(options.stateCoreTask);
  }

  const state = {
    runId,
    status: blockedByDirtyTarget ? "blocked" : "ready",
    blockReason: blockedByDirtyTarget
      ? "target worktree is dirty; rerun with --allow-dirty only when user changes are understood"
      : null,
    currentRound: 0,
    nextAction: blockedByDirtyTarget
      ? "Inspect target dirty files before creating experiment worktrees."
      : "Run scan, then create an isolated experiment worktree.",
    createdAt,
    updatedAt: createdAt
  };

  writeJson(join(runRoot, "goal.json"), goal);
  writeJson(join(runRoot, "state.json"), state);
  writeJson(join(runRoot, "questions.json"), { version: VERSION, questions: defaultQuestions() });
  writeFileSync(join(runRoot, "ledger.tsv"), "round\tcommit\tscore\tstatus\tdescription\tcreated_at\n");

  return { runRoot, goal, state };
}

export function parseMetric(metric) {
  const description = metric?.trim() || "Improve the primary score while all guardrails pass.";
  const lower = description.toLowerCase();
  const direction = /\b(decrease|lower|reduce|faster|smaller|less|drop)\b/.test(lower)
    ? "decrease"
    : "increase";
  return {
    name: metricName(description),
    direction,
    description
  };
}

function metricName(description) {
  return slugify(description).replace(/-/g, "_").slice(0, 64).replace(/^_+|_+$/g, "") || "primary_score";
}

export function scanTarget(targetInput, runRoot) {
  const target = assertGitRepo(resolve(targetInput));
  const files = {
    packageJson: join(target, "package.json"),
    pnpmLock: join(target, "pnpm-lock.yaml"),
    yarnLock: join(target, "yarn.lock"),
    packageLock: join(target, "package-lock.json"),
    nuxtConfig: join(target, "nuxt.config.ts"),
    viteConfig: join(target, "vite.config.js")
  };
  const packageJson = existsSync(files.packageJson) ? readJson(files.packageJson) : null;
  const scripts = packageJson?.scripts ?? {};
  const packageManager = existsSync(files.pnpmLock)
    ? "pnpm"
    : existsSync(files.yarnLock)
      ? "yarn"
      : existsSync(files.packageLock)
        ? "npm"
        : "unknown";
  const frameworks = [];
  if (existsSync(files.nuxtConfig) || packageJson?.dependencies?.nuxt || packageJson?.devDependencies?.nuxt) {
    frameworks.push("nuxt");
  }
  if (existsSync(files.viteConfig) || packageJson?.dependencies?.vite || packageJson?.devDependencies?.vite) {
    frameworks.push("vite");
  }
  if (packageJson?.dependencies?.vue || packageJson?.devDependencies?.vue) {
    frameworks.push("vue");
  }
  if (packageJson?.dependencies?.react || packageJson?.devDependencies?.react) {
    frameworks.push("react");
  }

  const scan = {
    version: VERSION,
    target,
    scannedAt: nowIso(),
    git: {
      head: getGitHead(target),
      dirty: getGitStatus(target).length > 0
    },
    package: packageJson
      ? {
          name: packageJson.name ?? null,
          packageManager,
          scripts,
          frameworks: [...new Set(frameworks)]
        }
      : null,
    suggestedValidation: suggestValidationCommands(packageManager, scripts)
  };

  if (runRoot) {
    writeJson(join(resolve(runRoot), "scan.json"), scan);
  }
  return scan;
}

export function suggestValidationCommands(packageManager, scripts) {
  const runner = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm run";
  const commands = [];
  for (const name of ["check", "lint", "test", "build"]) {
    if (scripts[name]) {
      commands.push(runner === "npm run" ? `npm run ${name}` : `${runner} ${name}`);
    }
  }
  return commands;
}

export function createWorktree(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const state = readJson(join(runRoot, "state.json"));
  if (state.status === "blocked" && !options.force) {
    throw new Error(`Run is blocked: ${state.blockReason}`);
  }
  const target = goal.target.path;
  const worktreeRoot = options.worktreeRoot
    ? resolve(options.worktreeRoot)
    : join(dirname(target), `${basename(target)}-level-up-worktrees`);
  ensureDir(worktreeRoot);
  const worktreePath = join(worktreeRoot, goal.runId);
  const branch = options.branch || `level-up/${goal.runId}`;
  if (!existsSync(worktreePath)) {
    runGit(target, ["worktree", "add", "-b", branch, worktreePath, goal.target.head]);
  }

  const updatedAt = nowIso();
  const nextState = {
    ...state,
    status: "worktree-ready",
    branch,
    worktreePath,
    nextAction: "Run one experiment in the isolated worktree, then record the result.",
    updatedAt
  };
  writeJson(join(runRoot, "state.json"), nextState);
  return { branch, worktreePath, state: nextState };
}

export function appendLedger(runRootInput, entry) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const state = readJson(join(runRoot, "state.json"));
  const status = entry.status;
  if (!["keep", "discard", "crash"].includes(status)) {
    throw new Error("--status must be one of: keep, discard, crash");
  }
  const round = Number(entry.round ?? state.currentRound + 1);
  const commit = entry.commit || "0000000";
  const score = entry.score ?? "";
  const description = entry.description?.trim();
  if (!description) {
    throw new Error("Missing required --description value.");
  }
  const createdAt = nowIso();
  const row = [
    round,
    commit,
    score,
    status,
    description.replace(/\t|\n/g, " "),
    createdAt
  ].join("\t");
  writeFileSync(join(runRoot, "ledger.tsv"), `${row}\n`, { flag: "a" });

  const nextState = {
    ...state,
    currentRound: Math.max(state.currentRound ?? 0, round),
    status: round >= goal.stopConditions.maxRounds ? "stopped" : "ready",
    nextAction:
      round >= goal.stopConditions.maxRounds
        ? "Max rounds reached. Summarize results and request human review."
        : "Select the next experiment candidate.",
    updatedAt: createdAt
  };
  writeJson(join(runRoot, "state.json"), nextState);
  syncLedgerToStateCore({ runRoot, goal, status, description });
  return { round, status, state: nextState };
}

export function finalizeStateCoreRun(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  if (!goal.stateCore?.taskId) {
    return null;
  }
  const stateCoreOptions = runtimeStateCoreOptions(goal, options.stateCore);
  setLedger(goal.stateCore.taskId, options.ledgerRef ?? runRoot, stateCoreOptions);
  const phase = options.phase ?? "verifying";
  const advanced = advance(goal.stateCore.taskId, phase, stateCoreOptions);
  return { taskId: goal.stateCore.taskId, ledgerRef: options.ledgerRef ?? runRoot, phase, advanced };
}

function normalizeStateCoreTask(task) {
  if (!task.taskId) {
    throw new Error("stateCoreTask.taskId is required");
  }
  return {
    taskId: task.taskId,
    size: task.size ?? null,
    slot: task.slot ?? defaultStateCoreSlot(task.size),
    intentRaw: task.intentRaw ?? null,
    root: task.root ?? null,
    stateCoreDir: task.stateCoreDir ?? null
  };
}

function defaultStateCoreSlot(size) {
  return size === "large" ? "executor" : "verify";
}

function syncLedgerToStateCore({ runRoot, goal, status, description }) {
  if (!goal.stateCore?.taskId) {
    return;
  }
  const verdict = status === "keep" ? "pass" : "fail";
  const slot = goal.stateCore.slot || defaultStateCoreSlot(goal.stateCore.size);
  reportSlot(goal.stateCore.taskId, slot, verdict, description, {
    ...runtimeStateCoreOptions(goal),
    details: {
      runRoot,
      levelUpStatus: status
    }
  });
}

function runtimeStateCoreOptions(goal, overrides = {}) {
  return {
    stateCoreDir: overrides?.stateCoreDir ?? goal.stateCore?.stateCoreDir ?? undefined,
    root: overrides?.root ?? goal.stateCore?.root ?? undefined
  };
}
