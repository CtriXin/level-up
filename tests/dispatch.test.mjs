/**
 * tests/dispatch.test.mjs
 *
 * Unit tests for src/dispatch.mjs.
 * Uses Node.js built-in test runner (node --test).
 *
 * Strategy:
 * - All tests use dryRun=true to avoid any real GitHub issue creation or
 *   state-core mutations.
 * - Sets up a temporary filesystem fixture:
 *     <tmpDir>/.state/auto-research-abc/task-state.json    (intake, should be dispatched)
 *     <tmpDir>/.state/auto-research-xyz/task-state.json    (scoped, should be skipped — already dispatched)
 *     <tmpDir>/.state/other-task-123/task-state.json       (intake, non-auto-research, should be silently skipped)
 *     <tmpDir>/.state/auto-research-nopacket/task-state.json (intake, missing packet)
 * - Sets up a temporary git repo for scope.path with a fake GitHub remote.
 * - Asserts correct filtering, repo inference, title/body assembly, dryRunPlan
 *   structure, and that NO real side effects occur.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { runDispatch } from "../src/dispatch.mjs";

// ---------------------------------------------------------------------------
// Scratchpad / tmp helpers
// ---------------------------------------------------------------------------

const SCRATCHPAD = "/private/tmp/claude-501/-Users-xin-auto-skills/0ce65334-1626-4ec3-9005-93cc305a16d6/scratchpad";

function makeTempDir(label) {
  const base = existsSync(SCRATCHPAD) ? SCRATCHPAD : tmpdir();
  return mkdtempSync(join(base, `dispatch-test-${label}-`));
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let tmpDir;         // dataRoot — holds .state/*/task-state.json
let scopeRepoDir;   // a git repo used as packet.scope.path

const FAKE_GITHUB_REMOTE = "git@github.com:CtriXin/diagramming-skill.git";
const EXPECTED_OWNER_REPO = "CtriXin/diagramming-skill";

/** Build a minimal packet.json object for testing. */
function makePacket(candidateId, overrides = {}) {
  return {
    task_mode: "research",
    work_type: "analysis",
    size_hint: "small",
    scope: {
      path: scopeRepoDir,
      ...((overrides.scope) ?? {})
    },
    action_spec: {
      summary: `Test summary for ${candidateId}`,
      hypothesis: `Hypothesis for ${candidateId}`,
      expected_impact: `Expected impact for ${candidateId}`,
      ...(overrides.action_spec ?? {})
    },
    acceptance: `Acceptance criteria for ${candidateId}`,
    meta: {
      candidate_id: candidateId,
      risk_hint: "Low",
      rollback: `Rollback for ${candidateId}`,
      ...(overrides.meta ?? {})
    },
    ...overrides
  };
}

/** Write a task fixture: task-state.json + packet.json at ledger_ref. */
function writeTaskFixture({ dataRoot, taskId, phase, packet }) {
  const stateDir = join(dataRoot, ".state", taskId);
  mkdirSync(stateDir, { recursive: true });

  const packetPath = join(stateDir, "packet.json");
  if (packet) {
    writeFileSync(packetPath, JSON.stringify(packet, null, 2) + "\n");
  }

  const taskState = {
    task_id: taskId,
    phase,
    intent: {
      raw: `raw intent for ${taskId}`,
      goal: `goal for ${taskId}`
    },
    ledger_ref: packet ? packetPath : null
  };
  writeFileSync(join(stateDir, "task-state.json"), JSON.stringify(taskState, null, 2) + "\n");
}

before(() => {
  // Create temp dataRoot
  tmpDir = makeTempDir("dataroot");

  // Create a minimal git repo for scope.path
  scopeRepoDir = makeTempDir("scope-repo");
  spawnSync("git", ["init", scopeRepoDir], { stdio: "ignore" });
  spawnSync("git", ["-C", scopeRepoDir, "config", "user.email", "test@test.com"], { stdio: "ignore" });
  spawnSync("git", ["-C", scopeRepoDir, "config", "user.name", "Test"], { stdio: "ignore" });
  spawnSync("git", ["-C", scopeRepoDir, "remote", "add", "origin", FAKE_GITHUB_REMOTE], { stdio: "ignore" });

  // Fixture 1: auto-research-abc — intake phase, should be dispatched
  writeTaskFixture({
    dataRoot: tmpDir,
    taskId: "auto-research-abc",
    phase: "intake",
    packet: makePacket("abc")
  });

  // Fixture 2: auto-research-xyz — scoped phase, should be silently skipped (already dispatched)
  writeTaskFixture({
    dataRoot: tmpDir,
    taskId: "auto-research-xyz",
    phase: "scoped",
    packet: makePacket("xyz")
  });

  // Fixture 3: other-task-123 — non-auto-research prefix, should be silently skipped
  writeTaskFixture({
    dataRoot: tmpDir,
    taskId: "other-task-123",
    phase: "intake",
    packet: makePacket("other")
  });

  // Fixture 4: auto-research-nopacket — intake, missing packet (ledger_ref=null)
  writeTaskFixture({
    dataRoot: tmpDir,
    taskId: "auto-research-nopacket",
    phase: "intake",
    packet: null  // no packet → ledger_ref is null, should be skipped with reason
  });
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (scopeRepoDir) rmSync(scopeRepoDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Core filtering tests
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — filtering", () => {
  let results;

  before(() => {
    results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "AI-P3",
      dryRun: true
    });
  });

  it("returns an array", () => {
    assert.ok(Array.isArray(results));
  });

  it("only auto-research-* tasks appear in results (non-prefixed silently skipped)", () => {
    for (const r of results) {
      assert.ok(
        r.taskId.startsWith("auto-research-"),
        `unexpected taskId in results: ${r.taskId}`
      );
    }
    const ids = results.map((r) => r.taskId);
    assert.ok(!ids.includes("other-task-123"), "other-task-123 must not appear in results");
  });

  it("auto-research-xyz (phase=scoped) is silently skipped and not in results", () => {
    const ids = results.map((r) => r.taskId);
    assert.ok(!ids.includes("auto-research-xyz"), "scoped task must be silently skipped (de-dup)");
  });

  it("auto-research-abc (phase=intake) is present in results", () => {
    const ids = results.map((r) => r.taskId);
    assert.ok(ids.includes("auto-research-abc"), "intake task must appear");
  });

  it("auto-research-nopacket (missing packet) appears as skipped with a reason", () => {
    const r = results.find((x) => x.taskId === "auto-research-nopacket");
    assert.ok(r, "auto-research-nopacket should appear in results");
    assert.ok(r.skippedReason, `should have skippedReason, got: ${r.skippedReason}`);
    assert.equal(r.dispatched, false);
    assert.equal(r.issueUrl, null);
  });
});

// ---------------------------------------------------------------------------
// GitHub repo inference
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — repo inference", () => {
  let abcResult;

  before(() => {
    const results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "AI-P3",
      dryRun: true
    });
    abcResult = results.find((r) => r.taskId === "auto-research-abc");
  });

  it("infers correct owner/repo from git remote", () => {
    assert.ok(abcResult, "auto-research-abc result must exist");
    assert.equal(abcResult.repo, EXPECTED_OWNER_REPO);
  });

  it("repo is not null for a valid GitHub remote", () => {
    assert.ok(abcResult.repo !== null, "repo must not be null");
  });

  it("skippedReason is null when inference succeeds", () => {
    assert.equal(abcResult.skippedReason, null);
  });
});

// ---------------------------------------------------------------------------
// Issue title and dryRunPlan assembly
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — issue title/body assembly", () => {
  let abcResult;

  before(() => {
    const results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "AI-P3",
      dryRun: true
    });
    abcResult = results.find((r) => r.taskId === "auto-research-abc");
  });

  it("issueTitle comes from packet.action_spec.summary", () => {
    assert.ok(abcResult, "result must exist");
    assert.equal(abcResult.issueTitle, "Test summary for abc");
  });

  it("label is passed through", () => {
    assert.equal(abcResult.label, "AI-P3");
  });

  it("dryRunPlan is present", () => {
    assert.ok(abcResult.dryRunPlan !== null, "dryRunPlan must be present");
  });

  it("dryRunPlan.ghCommand contains repo and title", () => {
    const cmd = abcResult.dryRunPlan.ghCommand;
    assert.ok(cmd.includes(EXPECTED_OWNER_REPO), `ghCommand must include repo: ${cmd}`);
    assert.ok(cmd.includes("AI-P3"), `ghCommand must include label: ${cmd}`);
  });

  it("dryRunPlan.setNextAction references task-id and dataRoot", () => {
    const cmd = abcResult.dryRunPlan.setNextAction;
    assert.ok(cmd.includes("auto-research-abc"), `setNextAction must include taskId: ${cmd}`);
    assert.ok(cmd.includes(tmpDir), `setNextAction must include dataRoot: ${cmd}`);
  });

  it("dryRunPlan.advanceCommand uses phase=scoped", () => {
    const cmd = abcResult.dryRunPlan.advanceCommand;
    assert.ok(cmd.includes("scoped"), `advanceCommand must use phase=scoped: ${cmd}`);
    assert.ok(cmd.includes("auto-research-abc"), `advanceCommand must include taskId: ${cmd}`);
  });
});

// ---------------------------------------------------------------------------
// dryRun=true does not open issues or write state-core
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — no side effects", () => {
  it("issueUrl is null for all results in dry run", () => {
    const results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "AI-P3",
      dryRun: true
    });
    for (const r of results) {
      assert.equal(r.issueUrl, null, `issueUrl should be null in dryRun for ${r.taskId}`);
    }
  });

  it("dispatched is false for all results in dry run", () => {
    const results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "AI-P3",
      dryRun: true
    });
    for (const r of results) {
      assert.equal(r.dispatched, false, `dispatched should be false in dryRun for ${r.taskId}`);
    }
  });

  it("task-state.json files are NOT modified by dryRun", () => {
    // Run dispatch in dry-run mode and verify the phase file is unchanged
    runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "AI-P3",
      dryRun: true
    });
    // readFileSync is already imported at the top of the file
    const afterPath = join(tmpDir, ".state", "auto-research-abc", "task-state.json");
    const afterContent = JSON.parse(readFileSync(afterPath, "utf8"));
    assert.equal(afterContent.phase, "intake", "phase must remain 'intake' after dryRun");
  });
});

// ---------------------------------------------------------------------------
// Repo inference: non-GitHub remote → skip with reason
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — non-GitHub remote skip", () => {
  let nonGitHubDir;
  let nonGHTaskDataRoot;

  before(() => {
    // Set up a git repo with a non-GitHub remote
    nonGitHubDir = makeTempDir("nongithub-repo");
    spawnSync("git", ["init", nonGitHubDir], { stdio: "ignore" });
    spawnSync("git", ["-C", nonGitHubDir, "remote", "add", "origin", "https://gitlab.com/foo/bar.git"], { stdio: "ignore" });

    nonGHTaskDataRoot = makeTempDir("nongithub-dataroot");
    writeTaskFixture({
      dataRoot: nonGHTaskDataRoot,
      taskId: "auto-research-nongithub",
      phase: "intake",
      packet: makePacket("nongithub", { scope: { path: nonGitHubDir } })
    });
  });

  after(() => {
    if (nonGitHubDir) rmSync(nonGitHubDir, { recursive: true, force: true });
    if (nonGHTaskDataRoot) rmSync(nonGHTaskDataRoot, { recursive: true, force: true });
  });

  it("non-GitHub remote causes skip with skippedReason", () => {
    const results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: nonGHTaskDataRoot,
      label: "AI-P3",
      dryRun: true
    });
    const r = results.find((x) => x.taskId === "auto-research-nongithub");
    assert.ok(r, "result for non-GitHub task must exist");
    assert.ok(r.skippedReason, `must have a skippedReason, got: ${r.skippedReason}`);
    assert.equal(r.repo, null);
    assert.equal(r.dispatched, false);
  });
});

// ---------------------------------------------------------------------------
// Custom label
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — custom label", () => {
  it("custom label is passed to dryRunPlan", () => {
    const results = runDispatch({
      stateCoreDir: "/tmp/fake-state-core-not-called",
      dataRoot: tmpDir,
      label: "custom-label-x",
      dryRun: true
    });
    const r = results.find((x) => x.taskId === "auto-research-abc");
    assert.ok(r, "result must exist");
    assert.equal(r.label, "custom-label-x");
    assert.ok(r.dryRunPlan.ghCommand.includes("custom-label-x"), "ghCommand must use custom label");
  });
});

// ---------------------------------------------------------------------------
// Empty dataRoot (no .state dir)
// ---------------------------------------------------------------------------

describe("runDispatch dryRun=true — empty dataRoot", () => {
  it("returns empty array when no tasks exist", () => {
    const emptyRoot = makeTempDir("empty-root");
    try {
      const results = runDispatch({
        stateCoreDir: "/tmp/fake-state-core-not-called",
        dataRoot: emptyRoot,
        label: "AI-P3",
        dryRun: true
      });
      assert.ok(Array.isArray(results), "returns array");
      assert.equal(results.length, 0, "empty array for empty dataRoot");
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

describe("runDispatch — parameter validation", () => {
  it("throws if stateCoreDir is missing", () => {
    assert.throws(
      () => runDispatch({ dataRoot: "/tmp/x", dryRun: true }),
      /stateCoreDir/
    );
  });

  it("throws if dataRoot is missing", () => {
    assert.throws(
      () => runDispatch({ stateCoreDir: "/tmp/x", dryRun: true }),
      /dataRoot/
    );
  });
});
