import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runAutopilot } from "../src/autopilot.mjs";
import { runDevLoop } from "../src/dev-loop.mjs";
import { generateIdeas } from "../src/ideation.mjs";
import { buildFeishuPostPayload, notifyFeishu } from "../src/notify.mjs";
import { generatePrPack } from "../src/pr-pack.mjs";
import { appendLedger, createRun, createWorktree, scanTarget } from "../src/runtime.mjs";
import { generateRunnerPacket } from "../src/runner.mjs";
import { reviewExperiment } from "../src/self-review.mjs";
import { generateWorkPack } from "../src/work-pack.mjs";

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

test("createRun normalizes long metric names for readable packets", () => {
  const repo = fixtureRepo();
  const result = createRun({
    target: repo,
    goal: "Improve packet readability",
    metric: "Increase runtime usefulness by adding candidate generation while keeping tests and schemas passing"
  });
  assert.equal(result.goal.primaryMetric.name.endsWith("_"), false);
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
