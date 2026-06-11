import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendLedger, createRun, createWorktree, scanTarget } from "../src/runtime.mjs";

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
