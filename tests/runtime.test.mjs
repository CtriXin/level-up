import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runAutopilot } from "../src/autopilot.mjs";
import { evaluateExperiment } from "../src/evaluator.mjs";
import { parseDuration } from "../src/duration.mjs";
import { runDevLoop } from "../src/dev-loop.mjs";
import { generateIdeas } from "../src/ideation.mjs";
import { buildFeishuPostPayload, notifyFeishu } from "../src/notify.mjs";
import { generatePrPack } from "../src/pr-pack.mjs";
import { runRedlineAudit } from "../src/redline.mjs";
import { generateRunReport } from "../src/report.mjs";
import { appendLedger, createRun, createWorktree, finalizeStateCoreRun, readJson, scanTarget } from "../src/runtime.mjs";
import { generateRunnerPacket } from "../src/runner.mjs";
import { reviewExperiment } from "../src/self-review.mjs";
import { selectNextCandidate } from "../src/strategy.mjs";
import { generateWorkPack } from "../src/work-pack.mjs";
import { cleanupMergedWorktrees } from "../src/worktree-cleanup.mjs";
import runPostMergeCleanup from "../src/post-merge.mjs";
import {
  StateCoreCliError,
  advance,
  readTaskState,
  reportSlot,
  resolveStateCoreCli,
  setLedger,
  setRunner
} from "../src/state-core.mjs";

function sh(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "level-up-test-"));
  sh(dir, "git", ["init"]);
  sh(dir, "git", ["config", "user.name", "Test"]);
  sh(dir, "git", ["config", "user.email", "test@example.com"]);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        type: "module",
        scripts: {
          check: "node --version",
          build: "node --version"
        },
        dependencies: {
          vite: "^6.0.0",
          vue: "^3.0.0"
        }
      },
      null,
      2
    )
  );
  sh(dir, "git", ["add", "package.json"]);
  sh(dir, "git", ["commit", "-m", "init"]);
  return dir;
}

function fakeStateCore({ readState, failAdvanceDone = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "level-up-state-core-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  const logPath = join(dir, "calls.jsonl");
  const cliPath = join(dir, "src", "cli.py");
  writeFileSync(
    cliPath,
    `#!/usr/bin/env python3
import json
import sys

args = sys.argv[1:]
with open(${JSON.stringify(logPath)}, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(args, ensure_ascii=False) + "\\n")

command = args[0] if args else ""
if command == "read":
    print(json.dumps(${JSON.stringify(readState ?? {
      schema_version: "0.1.0",
      task_id: "demo-task",
      intent: {"raw": "Raw intent", "goal": "Goal from state", "kind": "feature"},
      size: "medium",
      risk: "low",
      phase: "intake",
      slots: {},
      human_decisions: [],
      next_action: "Run level-up"
    })}, ensure_ascii=False))
elif command == "advance" and "--phase" in args and args[args.index("--phase") + 1] == "done" and ${failAdvanceDone ? "True" : "False"}:
    print("error: cannot advance to done; unmet slots: ['recorder']", file=sys.stderr)
    raise SystemExit(1)
else:
    print("/tmp/state-path")
`
  );
  chmodSync(cliPath, 0o755);
  return { dir, logPath, calls: () => readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("createRun writes a goal contract and ready state", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Make homepage faster",
    metric: "Decrease mobile LCP"
  });
  assert.match(result.runRoot, /\.level-up\/runs\//);
  assert.equal(result.goal.mode, "l3-local-autopilot");
  assert.equal(result.goal.primaryMetric.direction, "decrease");
  assert.equal(result.state.status, "ready");
});

test("state-core adapter reads JSON and reports clear missing CLI errors", () => {
  const fake = fakeStateCore();
  const state = readTaskState("demo-task", { stateCoreDir: fake.dir });

  assert.equal(state.intent.goal, "Goal from state");
  assert.deepEqual(fake.calls()[0], ["read", "--task-id", "demo-task"]);
  assert.equal(resolveStateCoreCli({ stateCoreDir: fake.dir }).endsWith("src/cli.py"), true);
  assert.throws(
    () => readTaskState("missing", { stateCoreDir: join(fake.dir, "missing") }),
    (error) => error instanceof StateCoreCliError && /state-core CLI not found/.test(error.message)
  );
});

test("state-core adapter wraps set, report, and advance CLI commands", () => {
  const fake = fakeStateCore();

  setRunner("demo-task", { stateCoreDir: fake.dir });
  setLedger("demo-task", ".level-up/runs/run-1/", { stateCoreDir: fake.dir });
  reportSlot("demo-task", "verify", "pass", "kept useful experiment", {
    stateCoreDir: fake.dir,
    evidenceRefs: [".level-up/runs/run-1/ledger.tsv"],
    details: { runRoot: ".level-up/runs/run-1" }
  });
  advance("demo-task", "verifying", { stateCoreDir: fake.dir });

  const calls = fake.calls();
  assert.deepEqual(calls[0], ["set", "--task-id", "demo-task", "--runner", "level-up"]);
  assert.deepEqual(calls[1], ["set", "--task-id", "demo-task", "--ledger-ref", ".level-up/runs/run-1/"]);
  assert.equal(calls[2][0], "report");
  assert.ok(calls[2].includes("--details-json"));
  assert.deepEqual(calls[3], ["advance", "--task-id", "demo-task", "--phase", "verifying"]);
});

test("state-core adapter propagates done-gate failures", () => {
  const fake = fakeStateCore({ failAdvanceDone: true });

  assert.throws(
    () => advance("demo-task", "done", { stateCoreDir: fake.dir }),
    (error) => error instanceof StateCoreCliError && error.stderr.includes("unmet slots")
  );
});

test("createRun normalizes long metric names for readable packets", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Improve packet readability",
    metric: "Increase runtime usefulness by adding candidate generation while keeping tests and schemas passing"
  });
  assert.equal(result.goal.primaryMetric.name.endsWith("_"), false);
});

test("createRun can bind a canonical state-core task without breaking run files", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Goal from state",
    stateCoreTask: {
      taskId: "demo-task",
      size: "medium",
      intentRaw: "Raw intent"
    }
  });

  assert.equal(result.goal.stateCore.taskId, "demo-task");
  assert.equal(result.goal.stateCore.size, "medium");
  assert.equal(result.goal.stateCore.slot, "verify");
  assert.equal(readJson(join(result.runRoot, "goal.json")).stateCore.taskId, "demo-task");
});

test("scanTarget detects package scripts and frameworks", () => {
  const repo = fixtureRepo();
  const scan = scanTarget(repo);
  assert.equal(scan.package.name, "fixture");
  assert.deepEqual(scan.package.frameworks.sort(), ["vite", "vue"]);
  assert.deepEqual(scan.suggestedValidation, ["npm run check", "npm run build"]);
});

test("createWorktree creates an isolated branch and updates state", () => {
  const repo = fixtureRepo();
  const result = createRun({ target: repo, goal: "Try a safe experiment" });
  const worktree = createWorktree(result.runRoot);
  assert.match(worktree.branch, /^level-up\//);
  assert.match(worktree.worktreePath, /level-up-worktrees/);
  assert.equal(worktree.state.status, "worktree-ready");
});

test("cleanupMergedWorktrees removes clean merged non-current worktrees only when executed", () => {
  const repo = fixtureRepo();
  const extraRoot = mkdtempSync(join(tmpdir(), "level-up-cleanup-"));
  const worktreePath = join(extraRoot, "merged-worktree");
  sh(repo, "git", ["branch", "cleanup-merged"]);
  sh(repo, "git", ["worktree", "add", worktreePath, "cleanup-merged"]);

  const dryRun = cleanupMergedWorktrees(repo, { baseRef: "HEAD" });
  const dryRunEntry = dryRun.worktrees.find((entry) => entry.branch === "cleanup-merged");
  assert.equal(dryRunEntry.removable, true);
  assert.equal(dryRunEntry.removed, false);
  assert.equal(existsSync(worktreePath), true);

  const executed = cleanupMergedWorktrees(repo, { baseRef: "HEAD", execute: true });
  const executedEntry = executed.worktrees.find((entry) => entry.branch === "cleanup-merged");
  assert.equal(executedEntry.removable, true);
  assert.equal(executedEntry.removed, true);
  assert.equal(executedEntry.branchDeleted, false);
  assert.equal(existsSync(worktreePath), false);
  assert.match(sh(repo, "git", ["branch", "--list", "cleanup-merged"]), /cleanup-merged/);

  const branchDeletePath = join(extraRoot, "branch-delete-worktree");
  sh(repo, "git", ["branch", "cleanup-delete"]);
  sh(repo, "git", ["worktree", "add", branchDeletePath, "cleanup-delete"]);
  const branchDelete = cleanupMergedWorktrees(repo, {
    baseRef: "HEAD",
    execute: true,
    deleteBranches: true
  });
  const branchDeleteEntry = branchDelete.worktrees.find((entry) => entry.branch === "cleanup-delete");
  assert.equal(branchDeleteEntry.removed, true);
  assert.equal(branchDeleteEntry.branchDeleted, true);
  assert.equal(existsSync(branchDeletePath), false);
  assert.equal(sh(repo, "git", ["branch", "--list", "cleanup-delete"]), "");
});

test("runPostMergeCleanup writes a readable cleanup report", () => {
  const repo = fixtureRepo();
  const outputDir = mkdtempSync(join(tmpdir(), "level-up-post-merge-"));

  const result = runPostMergeCleanup({
    repo,
    baseRef: "HEAD",
    outputDir
  });

  assert.equal(result.command, "post-merge");
  assert.equal(result.status, "checked");
  assert.equal(result.summary.removed, 0);
  assert.equal(result.summary.skipped, 1);
  assert.ok(existsSync(result.files.report));
  assert.ok(existsSync(result.files.manifest));

  const report = readFileSync(result.files.report, "utf8");
  assert.match(report, /Post-merge cleanup/);
  assert.match(report, /current worktree/);

  const manifest = JSON.parse(readFileSync(result.files.manifest, "utf8"));
  assert.equal(manifest.command, "post-merge");
  assert.equal(manifest.summary.skipped, 1);
});

test("runPostMergeCleanup prunes merged prefixed branches only when explicit", () => {
  const repo = fixtureRepo();
  sh(repo, "git", ["branch", "codex/prune-merged"]);

  const dryRun = runPostMergeCleanup({
    repo,
    baseRef: "HEAD",
    pruneBranches: true,
    branchPrefix: "codex/"
  });
  const dryRunEntry = dryRun.branchPrune.branches.find((entry) => entry.name === "codex/prune-merged");
  assert.equal(dryRunEntry.removable, true);
  assert.equal(dryRunEntry.deleted, false);
  assert.match(sh(repo, "git", ["branch", "--list", "codex/prune-merged"]), /codex\/prune-merged/);

  const executed = runPostMergeCleanup({
    repo,
    baseRef: "HEAD",
    execute: true,
    pruneBranches: true,
    branchPrefix: "codex/"
  });
  const executedEntry = executed.branchPrune.branches.find((entry) => entry.name === "codex/prune-merged");
  assert.equal(executedEntry.removable, true);
  assert.equal(executedEntry.deleted, true);
  assert.equal(executed.summary.branchPruned, 1);
  assert.equal(sh(repo, "git", ["branch", "--list", "codex/prune-merged"]), "");
});

test("appendLedger records rounds and stops at max rounds", () => {
  const repo = fixtureRepo();
  const result = createRun({ target: repo, goal: "Try two experiments", maxRounds: 1 });
  const recorded = appendLedger(result.runRoot, {
    status: "keep",
    score: 1.5,
    description: "baseline improvement"
  });
  assert.equal(recorded.round, 1);
  assert.equal(recorded.state.status, "stopped");
});

test("appendLedger does not require state-core when no canonical task is bound", () => {
  const repo = fixtureRepo();
  const fake = fakeStateCore();
  const original = process.env.STATE_CORE_DIR;
  process.env.STATE_CORE_DIR = join(fake.dir, "missing");
  try {
    const result = createRun({ target: repo, goal: "Legacy standalone run" });
    const recorded = appendLedger(result.runRoot, {
      status: "keep",
      score: 1,
      description: "legacy keep"
    });
    assert.equal(recorded.status, "keep");
  } finally {
    restoreEnv("STATE_CORE_DIR", original);
  }
});

test("appendLedger maps keep/discard to state-core slot reports", () => {
  const repo = fixtureRepo();
  const fake = fakeStateCore();
  const original = process.env.STATE_CORE_DIR;
  process.env.STATE_CORE_DIR = fake.dir;
  try {
    const keepRun = createRun({
      target: repo,
      goal: "Keep useful runtime result",
      stateCoreTask: { taskId: "medium-task", size: "medium" }
    });
    appendLedger(keepRun.runRoot, {
      status: "keep",
      score: 1,
      description: "medium verification passed"
    });
    const keepReport = fake.calls().find((call) => call[0] === "report");
    assert.ok(keepReport);
    assert.ok(keepReport.includes("--slot"));
    assert.equal(keepReport[keepReport.indexOf("--slot") + 1], "verify");
    assert.equal(keepReport[keepReport.indexOf("--verdict") + 1], "pass");

    const largeRun = createRun({
      target: repo,
      goal: "Discard failed runtime result",
      stateCoreTask: { taskId: "large-task", size: "large" }
    });
    appendLedger(largeRun.runRoot, {
      status: "discard",
      score: 0,
      description: "large executor failed"
    });
    const reports = fake.calls().filter((call) => call[0] === "report");
    const discardReport = reports.at(-1);
    assert.equal(discardReport[discardReport.indexOf("--slot") + 1], "executor");
    assert.equal(discardReport[discardReport.indexOf("--verdict") + 1], "fail");
  } finally {
    restoreEnv("STATE_CORE_DIR", original);
  }
});

test("finalizeStateCoreRun writes ledger_ref and advances phase", () => {
  const repo = fixtureRepo();
  const fake = fakeStateCore();
  const original = process.env.STATE_CORE_DIR;
  process.env.STATE_CORE_DIR = fake.dir;
  try {
    const result = createRun({
      target: repo,
      goal: "Finalize runtime state",
      stateCoreTask: { taskId: "finalize-task", size: "medium" }
    });
    const finalized = finalizeStateCoreRun(result.runRoot);
    assert.equal(finalized.taskId, "finalize-task");
    assert.equal(finalized.phase, "verifying");
    const calls = fake.calls();
    assert.ok(calls.some((call) => call[0] === "set" && call.includes("--ledger-ref")));
    assert.ok(calls.some((call) => call[0] === "advance" && call.includes("verifying")));
  } finally {
    restoreEnv("STATE_CORE_DIR", original);
  }
});

test("generateIdeas writes structured experiment candidates", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Improve runtime usefulness",
    metric: "Increase confidence"
  });
  scanTarget(repo, result.runRoot);
  const ideas = generateIdeas(result.runRoot);
  assert.equal(ideas.slot, "ideation");
  assert.ok(ideas.candidates.length >= 3);
  assert.equal(ideas.candidates[0].id, "baseline-validation");
  assert.equal(ideas.candidates[0].validation[0].command, "npm run check");
});

test("generateWorkPack writes SPEC and TODO artifacts", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Make work reviewable",
    metric: "Increase review confidence"
  });
  const pack = generateWorkPack(result.runRoot);
  assert.ok(existsSync(pack.files.spec));
  assert.ok(existsSync(pack.files.todo));
  assert.match(readFileSync(pack.files.spec, "utf8"), /Make work reviewable/);
});

test("generateRunnerPacket writes current-session runner artifacts", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Let the current session act as the runner",
    metric: "Increase traceability"
  });
  scanTarget(repo, result.runRoot);
  generateIdeas(result.runRoot);
  generateWorkPack(result.runRoot);
  const worktree = createWorktree(result.runRoot);
  const packet = generateRunnerPacket(result.runRoot, {
    runner: "current-session",
    profile: "codex-session",
    worktreePath: worktree.worktreePath,
    skills: "level-up,interview",
    mcp: "github,browser"
  });
  assert.equal(packet.runner.type, "current-session");
  assert.equal(packet.runner.profile, "codex-session");
  assert.deepEqual(packet.skills, ["level-up", "interview"]);
  assert.ok(existsSync(packet.files.packet));
  assert.match(readFileSync(packet.files.packet, "utf8"), /Let the current session act as the runner/);
});

test("runDevLoop writes a dry-run phase plan", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Plan validation",
    metric: "Increase validation confidence"
  });
  scanTarget(repo, result.runRoot);
  const phase = runDevLoop(result.runRoot, { phase: "baseline" });
  assert.equal(phase.status, "planned");
  assert.equal(phase.executed, false);
  assert.equal(phase.commands[0].command, "npm run check");
});

test("generatePrPack writes PR body, bug review, and visual evidence artifacts", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Improve homepage visual performance",
    metric: "Increase confidence"
  });
  scanTarget(repo, result.runRoot);
  generateIdeas(result.runRoot);
  generateWorkPack(result.runRoot);
  runDevLoop(result.runRoot, { phase: "baseline" });
  appendLedger(result.runRoot, {
    status: "keep",
    score: 1,
    commit: "abc1234",
    description: "kept a useful local experiment"
  });
  const pack = generatePrPack(result.runRoot, {
    visual: true,
    reviewerBot: "@review-bot"
  });
  assert.equal(pack.visualMode, true);
  assert.match(pack.files.prBody, /PR_BODY\.md$/);
  assert.match(pack.files.bugReview, /BUG_REVIEW_REQUEST\.md$/);
  assert.match(pack.files.visualEvidence, /VISUAL_EVIDENCE\.md$/);
  assert.match(readFileSync(pack.files.prBody, "utf8"), /## Work Pack/);
  assert.match(readFileSync(pack.files.prBody, "utf8"), /## Dev Loop/);
});

test("generateRunReport writes a readable Chinese run summary", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Explain what level-up did after an autopilot run",
    metric: "Increase user-readable traceability"
  });
  scanTarget(repo, result.runRoot);
  generateIdeas(result.runRoot);
  generateWorkPack(result.runRoot);
  generateRunnerPacket(result.runRoot, {
    runner: "current-session",
    profile: "codex-session",
    skills: "level-up,interview"
  });
  runDevLoop(result.runRoot, { phase: "baseline" });
  appendLedger(result.runRoot, {
    status: "keep",
    score: 1,
    commit: "abc1234",
    description: "kept a useful local experiment"
  });
  generatePrPack(result.runRoot, { visual: true });

  const report = generateRunReport(result.runRoot, {
    link: "https://github.com/CtriXin/level-up/pull/6",
    notifyStatus: "Feishu 已通知"
  });
  const body = readFileSync(report.files.report, "utf8");

  assert.match(report.files.report, /REPORT\.zh\.md$/);
  assert.match(body, /## 做了什么/);
  assert.match(body, /## PR \/ MR/);
  assert.match(body, /Feishu 已通知/);
  assert.match(body, /kept a useful local experiment/);
});

test("buildFeishuPostPayload includes model, repo, and branch for quick triage", () => {
  const payload = buildFeishuPostPayload({
    model: "gpt-5",
    family: "openai",
    repo: "level-up",
    branch: "codex/example -> main",
    title: "perf: 优化首页首屏加载和事件逻辑",
    link: "https://github.com/CtriXin/level-up/pull/5",
    status: "check/build 通过",
    effect: "首页主 JS gzip 下降",
    nextStep: "请 review diff，确认后 merge。"
  });
  const text = JSON.stringify(payload);
  assert.equal(payload.msg_type, "post");
  assert.ok(text.includes("Model: gpt-5 / openai"));
  assert.ok(text.includes("Repo: level-up"));
  assert.ok(text.includes("Branch: codex/example -> main"));
  assert.ok(text.includes("请 review diff"));
});

test("notifyFeishu dry-run returns payload without requiring a webhook", async () => {
  const result = await notifyFeishu({
    dryRun: true,
    repo: "level-up",
    branch: "codex/example -> main",
    title: "docs: 测试飞书通知",
    link: "https://github.com/CtriXin/level-up/pull/5"
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.channel, "feishu");
  assert.equal(result.payload.content.post.zh_cn.title, "【AI PR】level-up");
});

test("runAutopilot discards a no-op experiment and still writes PR evidence", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Reach practical L3 by trying a local no-op safely",
    metric: "Increase autopilot safety confidence"
  });
  const summary = runAutopilot(result.runRoot, {
    prPack: true,
    runner: "current-session",
    runnerProfile: "codex-session",
    skills: "level-up,interview"
  });
  assert.equal(summary.status, "stopped");
  assert.equal(summary.rounds.length, 1);
  assert.equal(summary.rounds[0].decision, "discard");
  assert.equal(summary.rounds[0].changed, false);
  assert.equal(summary.rounds[0].runner.runner.type, "current-session");
  assert.match(readFileSync(summary.prPack.files.prBody, "utf8"), /## Runner/);
  assert.ok(summary.prPack.files.prBody.endsWith("PR_BODY.md"));
});

test("runAutopilot keeps a structured write-file apply result", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Let apply adapter create a small useful file",
    metric: "Increase runner apply confidence"
  });
  const summary = runAutopilot(result.runRoot, {
    execute: true,
    runner: "current-session",
    runnerProfile: "codex-session",
    applyWriteFile: "src/level-up-generated.txt",
    applyContent: "generated by level-up apply adapter\n"
  });
  const round = summary.rounds[0];

  assert.equal(summary.status, "pass");
  assert.equal(round.decision, "keep");
  assert.equal(round.apply.mode, "write-file");
  assert.equal(round.apply.status, "pass");
  assert.ok(existsSync(round.apply.files.manifest));
  assert.equal(readFileSync(round.apply.targetPath, "utf8"), "generated by level-up apply adapter\n");
});

test("runAutopilot proves multi-round strategy by keeping different candidates", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Prove level-up can try multiple strategies autonomously",
    metric: "Increase multi-round autonomy confidence"
  });
  const summary = runAutopilot(result.runRoot, {
    rounds: 2,
    execute: true,
    commitKept: true,
    runner: "current-session",
    runnerProfile: "codex-session",
    applyWriteFile: "proof/{roundPadded}-{candidateId}.txt",
    applyContent: "round {round}: {candidateId}\n"
  });
  const candidateIds = summary.rounds.map((round) => round.candidateId);

  assert.equal(summary.status, "pass");
  assert.equal(summary.rounds.length, 2);
  assert.equal(new Set(candidateIds).size, 2);
  for (const round of summary.rounds) {
    assert.equal(round.decision, "keep");
    assert.equal(round.evaluation.decision, "keep");
    assert.equal(round.evaluation.checks.changed, true);
    assert.ok(existsSync(round.strategy.files.manifest));
    assert.ok(existsSync(round.evaluation.files.manifest));
    assert.notEqual(round.commit, "0000000");
  }
});

test("runAutopilot adapts after a no-change discard with concrete apply", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Adapt after a no-change experiment",
    metric: "Increase adaptive strategy confidence"
  });
  const summary = runAutopilot(result.runRoot, {
    rounds: 2,
    execute: true,
    commitKept: true,
    runner: "current-session",
    runnerProfile: "codex-session"
  });
  const [first, second] = summary.rounds;

  assert.equal(summary.status, "adapted");
  assert.equal(first.decision, "discard");
  assert.equal(first.evaluation.checks.changed, false);
  assert.equal(second.strategy.adaptation.trigger, "no-change");
  assert.equal(second.strategy.adaptation.action, "concretize-apply");
  assert.equal(second.apply.mode, "write-file");
  assert.equal(second.apply.status, "pass");
  assert.equal(second.decision, "keep");
  assert.notEqual(second.commit, "0000000");
  assert.ok(existsSync(second.strategy.files.manifest));
  assert.ok(existsSync(second.evaluation.files.manifest));
});

test("runAutopilot executes a validation repair apply after validation failure", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Repair after a validation failure",
    metric: "Increase validation repair confidence"
  });
  const summary = runAutopilot(result.runRoot, {
    rounds: 2,
    execute: true,
    runner: "current-session",
    runnerProfile: "codex-session",
    applyCommand: "node -e \"require('fs').appendFileSync('package.json', '\\n  \\n')\""
  });
  const [first, second] = summary.rounds;

  assert.equal(first.decision, "discard");
  assert.equal(first.evaluation.checks.validationPassed, false);
  assert.equal(second.candidateId, "adaptive-validation-repair");
  assert.equal(second.strategy.syntheticCandidate, true);
  assert.equal(second.strategy.adaptation.trigger, "validation-failed");
  assert.equal(second.strategy.adaptation.proposal.mode, "command");
  assert.equal(second.strategy.adaptation.proposal.kind, "validation-repair");
  assert.match(second.strategy.adaptation.proposal.objective, /trailing whitespace/);
  assert.equal(second.strategy.adaptation.apply.mode, "command");
  assert.equal(second.apply.mode, "command");
  assert.equal(second.apply.status, "pass");
  assert.match(second.apply.command, /'diff', '--check'/);
  assert.equal(second.decision, "keep");
  assert.equal(second.evaluation.checks.validationPassed, true);
  assert.equal(second.evaluation.checks.reviewPassed, true);
});

test("runAutopilot executes a review blocker repair apply after self-review blocks", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Repair after a self-review blocker",
    metric: "Increase review repair confidence"
  });
  const fakeReviewToken = `ghp_${"12345678901234567890"}`;
  const summary = runAutopilot(result.runRoot, {
    rounds: 2,
    execute: true,
    runner: "current-session",
    runnerProfile: "codex-session",
    applyCommand: `node -e "const fs=require('fs'); const path='package.json'; const p=JSON.parse(fs.readFileSync(path, 'utf8')); p.token='${fakeReviewToken}'; fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\\n')"`
  });
  const [first, second] = summary.rounds;

  assert.equal(first.decision, "discard");
  assert.equal(first.evaluation.checks.validationPassed, true);
  assert.equal(first.evaluation.checks.reviewPassed, false);
  assert.equal(second.candidateId, "adaptive-review-blocker-repair");
  assert.equal(second.strategy.syntheticCandidate, true);
  assert.equal(second.strategy.adaptation.trigger, "review-blocked");
  assert.equal(second.strategy.adaptation.apply.mode, "write-file");
  assert.equal(second.apply.mode, "write-file");
  assert.equal(second.apply.status, "pass");
  assert.equal(second.apply.targetFile, "proof/repair-002-adaptive-review-blocker-repair.md");
  const repairDoc = readFileSync(second.apply.targetPath, "utf8");
  assert.match(repairDoc, /Trigger: review-blocked/);
  assert.match(repairDoc, /Previous candidate: metric-/);
  assert.match(repairDoc, /## Proposal/);
  assert.match(repairDoc, /Mode: write-file/);
  assert.match(repairDoc, /Objective: Remove the blocker/);
  assert.match(repairDoc, /blocker:/);
  assert.match(repairDoc, /secretRedaction: true/);
  assert.doesNotMatch(repairDoc, /ghp_[A-Za-z0-9_]{20,}/);
});

test("selectNextCandidate generates a validation repair candidate after validation failure", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Generate validation repair candidate",
    metric: "Increase adaptive validation repair confidence"
  });
  const ideas = generateIdeas(result.runRoot);
  const strategy = selectNextCandidate(result.runRoot, {
    round: 2,
    candidates: ideas.candidates,
    priorResults: [
      {
        round: 1,
        candidateId: "metric-primary-score",
        decision: "discard",
        apply: { status: "pass" },
        validation: [{ phase: "final", status: "fail", executed: true }],
        evaluation: {
          checks: {
            changed: true,
            applyPassed: true,
            validationPassed: false,
            reviewPassed: true
          },
          reasons: ["one or more validation phases failed"]
        }
      }
    ]
  });

  assert.equal(strategy.candidate.id, "adaptive-validation-repair");
  assert.equal(strategy.manifest.syntheticCandidate, true);
  assert.equal(strategy.manifest.adaptation.trigger, "validation-failed");
  assert.equal(strategy.manifest.adaptation.action, "generate-validation-repair-candidate");
  assert.equal(strategy.manifest.adaptation.proposal.kind, "validation-repair");
  assert.equal(strategy.manifest.adaptation.proposal.mode, "write-file");
  assert.equal(strategy.manifest.adaptation.proposal.safety.repeatsFailedApply, false);
  assert.equal(strategy.manifest.adaptation.apply.mode, "write-file");
  assert.equal(strategy.manifest.adaptation.apply.targetFile, "proof/repair-{roundPadded}-{candidateId}.md");
  assert.ok(existsSync(strategy.manifest.files.manifest));
});

test("selectNextCandidate generates a review blocker repair candidate after review failure", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Generate review blocker repair candidate",
    metric: "Increase adaptive review repair confidence"
  });
  const ideas = generateIdeas(result.runRoot);
  const strategy = selectNextCandidate(result.runRoot, {
    round: 2,
    candidates: ideas.candidates,
    priorResults: [
      {
        round: 1,
        candidateId: "code-health-simplification",
        decision: "discard",
        apply: { status: "pass" },
        review: { status: "blocked", blockers: ["unsafe apply command"] },
        evaluation: {
          checks: {
            changed: true,
            applyPassed: true,
            validationPassed: true,
            reviewPassed: false
          },
          reasons: ["review blocked the experiment: unsafe apply command"]
        }
      }
    ]
  });

  assert.equal(strategy.candidate.id, "adaptive-review-blocker-repair");
  assert.equal(strategy.manifest.syntheticCandidate, true);
  assert.equal(strategy.manifest.adaptation.trigger, "review-blocked");
  assert.equal(strategy.manifest.adaptation.action, "generate-review-blocker-repair-candidate");
  assert.equal(strategy.manifest.adaptation.proposal.kind, "review-blocker-repair");
  assert.equal(strategy.manifest.adaptation.proposal.mode, "write-file");
  assert.equal(strategy.manifest.adaptation.proposal.safety.rawOutputIncluded, false);
  assert.equal(strategy.manifest.adaptation.apply.mode, "write-file");
  assert.equal(strategy.manifest.adaptation.apply.targetFile, "proof/repair-{roundPadded}-{candidateId}.md");
  assert.ok(existsSync(strategy.manifest.files.manifest));
});

test("runAutopilot blocks unsafe command apply before it can keep", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Block dangerous apply commands in the runner layer",
    metric: "Increase safety"
  });
  const summary = runAutopilot(result.runRoot, {
    applyCommand: "git reset --hard HEAD"
  });
  const round = summary.rounds[0];

  assert.equal(summary.status, "stopped");
  assert.equal(round.decision, "discard");
  assert.equal(round.apply.status, "blocked");
  assert.equal(round.apply.safety.blocked, true);
  assert.match(round.apply.safety.blockers.join("\n"), /unsafe apply command/);
});

test("reviewExperiment blocks unsafe apply commands before keep", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Keep unsafe commands out of autopilot",
    metric: "Increase safety"
  });
  const worktree = createWorktree(result.runRoot);
  const review = reviewExperiment({
    worktreePath: worktree.worktreePath,
    candidate: {
      id: "unsafe-command",
      hypothesis: "unsafe command detection should block the run",
      expectedImpact: "fewer dangerous local mutations",
      rollback: "discard the experiment worktree"
    },
    applyCommand: "git reset --hard HEAD",
    devLoopResults: []
  });
  assert.equal(review.status, "blocked");
  assert.match(review.blockers.join("\n"), /unsafe apply command/);
});

test("runRedlineAudit writes a redline manifest with adapter result", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Check merge readiness after level-up",
    metric: "Increase review confidence"
  });
  const fakeCli = join(mkdtempSync(join(tmpdir(), "redline-fake-")), "fake-redline.mjs");
  writeFileSync(fakeCli, `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const outIndex = process.argv.indexOf("--out");
const urlIndex = process.argv.indexOf("--url");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : process.cwd();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "audit-result.json"), JSON.stringify({
  decision: "mergeable",
  repo: "fixture",
  url: urlIndex >= 0 ? process.argv[urlIndex + 1] : ""
}, null, 2));
writeFileSync(join(out, "audit-result.md"), "# fake redline\\n");
`);
  const redline = runRedlineAudit(result.runRoot, {
    url: "https://github.com/CtriXin/example/pull/1",
    bin: process.execPath,
    commandArgs: [fakeCli]
  });
  assert.equal(redline.status, "pass");
  assert.equal(redline.decision, "mergeable");
  assert.ok(existsSync(redline.files.manifest));

  const report = generateRunReport(result.runRoot, {
    link: "https://github.com/CtriXin/example/pull/1"
  });
  const reportText = readFileSync(report.files.report, "utf8");
  assert.match(reportText, /Redline Guard 预审/);
  assert.match(reportText, /mergeable/);
});

test("runAutopilot stops after the no-improvement threshold instead of one discard", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Keep trying after a failed experiment until improvement stalls",
    metric: "Increase experiment density"
  });
  writeFileSync(join(result.runRoot, "metric-baseline.json"), JSON.stringify({ value: 100 }));
  const metricPath = join(result.runRoot, "experiments", "round-{roundPadded}", "metric.json");
  const applyScript = [
    "const fs=require('fs');",
    `fs.writeFileSync(${JSON.stringify(metricPath)}, JSON.stringify({ value: 100 }));`,
    "fs.mkdirSync('proof',{recursive:true});",
    "fs.writeFileSync('proof/no-gain-{roundPadded}.txt','no metric gain\\n');"
  ].join("");
  const summary = runAutopilot(result.runRoot, {
    rounds: 5,
    maxNoImprovement: 2,
    runner: "current-session",
    runnerProfile: "codex-session",
    applyCommand: `node -e ${JSON.stringify(applyScript)}`
  });

  assert.equal(summary.status, "stopped");
  assert.equal(summary.stopReason, "no-improvement");
  assert.equal(summary.rounds.length, 2);
  assert.equal(summary.noImprovementRounds, 2);
  assert.ok(summary.rounds.every((round) => round.decision === "discard"));
});

test("runAutopilot honors a wall-clock budget and records timing", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Bound autopilot by wall-clock budget like overnight runs",
    metric: "Increase budgeted autonomy"
  });
  const summary = runAutopilot(result.runRoot, {
    rounds: 5,
    budgetMs: 0,
    runner: "current-session"
  });

  assert.equal(summary.stopReason, "budget-exhausted");
  assert.equal(summary.budgetMs, 0);
  assert.equal(summary.rounds.length, 0);
  assert.equal(summary.status, "stopped");
  assert.equal(typeof summary.elapsedMs, "number");
});

test("runAutopilot records a soft round-timeout stop after an over-budget round", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Stop after a round exceeds its per-round time budget",
    metric: "Increase timeout explainability",
    maxMinutesPerRound: 1
  });
  const originalNow = Date.now;
  let calls = 0;
  Date.now = () => (calls++ < 2 ? 0 : 60000);
  let summary;
  try {
    summary = runAutopilot(result.runRoot, {
      rounds: 3,
      execute: true,
      runner: "current-session",
      applyWriteFile: "proof/round-timeout.txt",
      applyContent: "round timeout proof\n"
    });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(summary.stopReason, "round-timeout");
  assert.equal(summary.rounds.length, 1);
  assert.equal(summary.rounds[0].decision, "keep");
});

test("autopilot result schema declares emitted summary and round fields", () => {
  const schema = readJson(join(process.cwd(), "schemas", "autopilot-result.schema.json"));
  for (const key of ["stateCore", "report"]) {
    assert.ok(schema.properties[key], `missing top-level schema property ${key}`);
  }
  const roundProperties = schema.properties.rounds.items.properties;
  for (const key of ["blocked", "strategy", "evaluation"]) {
    assert.ok(roundProperties[key], `missing round schema property ${key}`);
  }
});

test("evaluateExperiment keeps only metric-improving experiments when a metric exists", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Make the metric slot decide keep/discard",
    metric: "Decrease primary latency"
  });
  assert.equal(readJson(join(result.runRoot, "goal.json")).primaryMetric.direction, "decrease");
  writeFileSync(join(result.runRoot, "metric-baseline.json"), JSON.stringify({ value: 100 }));

  const passingGates = {
    changed: true,
    apply: { status: "pass" },
    validation: [{ status: "pass" }],
    review: { status: "ok" }
  };

  const improvedDir = join(result.runRoot, "experiments", "round-001");
  mkdirSync(improvedDir, { recursive: true });
  writeFileSync(join(improvedDir, "metric.json"), JSON.stringify({ value: 80 }));
  const improved = evaluateExperiment(result.runRoot, { round: 1, candidate: { id: "improve" }, ...passingGates });
  assert.equal(improved.decision, "keep");
  assert.equal(improved.metric.available, true);
  assert.equal(improved.metric.improved, true);
  assert.equal(improved.score, 20);

  const regressedDir = join(result.runRoot, "experiments", "round-002");
  mkdirSync(regressedDir, { recursive: true });
  writeFileSync(join(regressedDir, "metric.json"), JSON.stringify({ value: 120 }));
  const regressed = evaluateExperiment(result.runRoot, { round: 2, candidate: { id: "regress" }, ...passingGates });
  assert.equal(regressed.decision, "discard");
  assert.equal(regressed.metric.improved, false);
  assert.equal(regressed.score, -20);
  assert.match(regressed.reasons.join("\n"), /primary metric did not improve/);
});

test("runAutopilot never advances a bound state-core task to done", () => {
  const repo = fixtureRepo();
  const fake = fakeStateCore();
  const original = process.env.STATE_CORE_DIR;
  process.env.STATE_CORE_DIR = fake.dir;
  try {
    const result = createRun({
      target: repo,
      goal: "Freeze the state-core boundary so level-up never owns the done-gate",
      stateCoreTask: { taskId: "boundary-task", size: "medium" }
    });
    runAutopilot(result.runRoot, {
      execute: true,
      runner: "current-session",
      applyWriteFile: "src/level-up-boundary.txt",
      applyContent: "boundary proof\n"
    });
    const advances = fake.calls().filter((call) => call[0] === "advance");
    assert.ok(advances.length > 0, "expected at least one advance call");
    assert.ok(advances.every((call) => call[call.indexOf("--phase") + 1] !== "done"));
    assert.ok(advances.some((call) => call.includes("verifying")));
  } finally {
    restoreEnv("STATE_CORE_DIR", original);
  }
});

test("parseDuration fails hard on an invalid budget instead of disabling it", () => {
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration("5m"), 300000);
  assert.equal(parseDuration("30s"), 30000);
  assert.equal(parseDuration("90000"), 90000);
  assert.throws(() => parseDuration("5min"), /invalid --budget/);
  assert.throws(() => parseDuration(true), /requires a value/);
});

test("evaluateExperiment discards a round that beats baseline but loses to the incumbent best", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Compare each round against the best kept value, not a fixed baseline",
    metric: "Decrease primary latency"
  });
  writeFileSync(join(result.runRoot, "metric-baseline.json"), JSON.stringify({ value: 100 }));
  writeFileSync(join(result.runRoot, "metric-incumbent.json"), JSON.stringify({ value: 80 }));

  const passingGates = {
    changed: true,
    apply: { status: "pass" },
    validation: [{ status: "pass" }],
    review: { status: "ok" }
  };

  // 90 beats the original baseline (100) but is worse than the incumbent (80).
  const dir = join(result.runRoot, "experiments", "round-001");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metric.json"), JSON.stringify({ value: 90 }));
  const evaluation = evaluateExperiment(result.runRoot, { round: 1, candidate: { id: "regress" }, ...passingGates });

  assert.equal(evaluation.decision, "discard");
  assert.equal(evaluation.metric.reference, 80);
  assert.equal(evaluation.metric.baseline, 100);
  assert.equal(evaluation.metric.improved, false);
  assert.match(evaluation.reasons.join("\n"), /best-so-far/);
});

test("runAutopilot defaults the wall-clock budget from the goal contract", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Carry the wall-clock budget in the contract, not only on the CLI",
    metric: "Increase contract-driven autonomy",
    maxWallClockMs: 600000
  });
  assert.equal(readJson(join(result.runRoot, "goal.json")).stopConditions.maxWallClockMs, 600000);

  const summary = runAutopilot(result.runRoot, { runner: "current-session" });
  // A contract budget is read without any CLI flag, and it opts the run into
  // multi-round mode (defaultRounds comes from the contract, not 1).
  assert.equal(summary.budgetMs, 600000);
  assert.ok(summary.rounds.length > 1);
  assert.equal(summary.stopReason, "no-improvement");
});
