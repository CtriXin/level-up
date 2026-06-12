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
import { runRedlineAudit } from "../src/redline.mjs";
import { generateRunReport } from "../src/report.mjs";
import { appendLedger, createRun, createWorktree, scanTarget } from "../src/runtime.mjs";
import { generateRunnerPacket } from "../src/runner.mjs";
import { reviewExperiment } from "../src/self-review.mjs";
import { selectNextCandidate } from "../src/strategy.mjs";
import { generateWorkPack } from "../src/work-pack.mjs";
import { cleanupMergedWorktrees } from "../src/worktree-cleanup.mjs";

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
  assert.equal(existsSync(worktreePath), false);
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
