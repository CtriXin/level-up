/**
 * auto-research.test.mjs
 *
 * Tests for the generateCandidates pure function module.
 * Uses a minimal fixture git repo as targetPath so scanTarget() can run.
 * Verifies:
 *   1. Returns non-empty candidates without writing any files.
 *   2. Each candidate has all fields required by idea.schema.json.
 *   3. Accepts a pre-computed scan (no scanTarget() call needed).
 *   4. Respects the limit parameter.
 *   5. Throws on missing goal.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { generateCandidates } from "../src/auto-research.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sh(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Create a minimal git repo with a package.json. */
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ar-test-"));
  sh(dir, "git", ["init"]);
  sh(dir, "git", ["config", "user.name", "Test"]);
  sh(dir, "git", ["config", "user.email", "test@example.com"]);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "ar-fixture",
        type: "module",
        scripts: { check: "node --version", test: "node --version" }
      },
      null,
      2
    )
  );
  sh(dir, "git", ["add", "package.json"]);
  sh(dir, "git", ["commit", "-m", "init"]);
  return dir;
}

/** A minimal goal object matching what goal.json would contain. */
function fixtureGoal(targetPath) {
  return {
    version: "0.1.0",
    runId: "test-run-001",
    createdAt: new Date().toISOString(),
    target: { path: targetPath, head: "aabbccdd", dirty: false },
    objective: "Improve code quality",
    mode: "l3-local-autopilot",
    primaryMetric: {
      name: "primary_score",
      direction: "increase",
      description: "Improve code quality score"
    },
    guardrails: ["build must pass"],
    nonGoals: [],
    forbiddenActions: [],
    stopConditions: { maxRounds: 8, maxMinutesPerRound: 20, maxNoImprovementRounds: 3, maxWallClockMs: null },
    humanGates: ["merge", "deploy"]
  };
}

/** Required candidate fields from idea.schema.json */
const REQUIRED_FIELDS = ["id", "title", "hypothesis", "expectedImpact", "risk", "validation", "rollback", "scoreHint"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("generateCandidates returns non-empty candidates array", () => {
  const targetPath = fixtureRepo();
  const goal = fixtureGoal(targetPath);
  const result = generateCandidates({ targetPath, goal });
  assert.ok(Array.isArray(result.candidates), "candidates should be an array");
  assert.ok(result.candidates.length > 0, "candidates should be non-empty");
});

test("generateCandidates result has required top-level shape", () => {
  const targetPath = fixtureRepo();
  const goal = fixtureGoal(targetPath);
  const result = generateCandidates({ targetPath, goal });
  assert.equal(result.slot, "ideation");
  assert.equal(result.skipped, false);
  assert.ok(typeof result.version === "string", "version should be a string");
  assert.ok(typeof result.generatedAt === "string", "generatedAt should be an ISO string");
});

test("each candidate has all fields required by idea.schema.json", () => {
  const targetPath = fixtureRepo();
  const goal = fixtureGoal(targetPath);
  const result = generateCandidates({ targetPath, goal });
  for (const candidate of result.candidates) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in candidate, `candidate missing required field: ${field}`);
      assert.ok(candidate[field] !== undefined && candidate[field] !== null && candidate[field] !== "",
        `candidate.${field} should not be empty`);
    }
    // validation must be an array of { command, status }
    assert.ok(Array.isArray(candidate.validation), "validation should be an array");
    for (const v of candidate.validation) {
      assert.ok(typeof v.command === "string" && v.command.length > 0, "validation item needs command");
      assert.ok(["pending", "pass", "fail", "skipped"].includes(v.status), "validation status must be a valid enum value");
    }
  }
});

test("generateCandidates uses pre-computed scan (no scanTarget call needed)", () => {
  const targetPath = fixtureRepo();
  const goal = fixtureGoal(targetPath);
  // Provide a minimal hand-crafted scan — no git calls needed
  const scan = {
    version: "0.1.0",
    target: targetPath,
    scannedAt: new Date().toISOString(),
    git: { head: "aabbccdd", dirty: false },
    package: { name: "ar-fixture", packageManager: "npm", scripts: { check: "node --version" }, frameworks: [] },
    suggestedValidation: ["npm run check"]
  };
  const result = generateCandidates({ targetPath, goal, scan });
  assert.ok(result.candidates.length > 0, "should produce candidates from pre-computed scan");
  // Validation commands should come from the supplied scan
  assert.equal(result.candidates[0].validation[0].command, "npm run check");
});

test("generateCandidates respects limit parameter", () => {
  const targetPath = fixtureRepo();
  const goal = fixtureGoal(targetPath);
  const scan = {
    version: "0.1.0",
    target: targetPath,
    scannedAt: new Date().toISOString(),
    git: { head: "aabbccdd", dirty: false },
    package: null,
    suggestedValidation: []
  };
  const result = generateCandidates({ targetPath, goal, scan, limit: 2 });
  assert.equal(result.candidates.length, 2, "should return at most limit candidates");
});

test("generateCandidates throws when goal is missing", () => {
  assert.throws(
    () => generateCandidates({ targetPath: "/some/path" }),
    /goal is required/
  );
});

test("generateCandidates throws when neither targetPath nor goal.target.path provided", () => {
  assert.throws(
    () => generateCandidates({ goal: { primaryMetric: { name: "x" } } }),
    /targetPath or goal.target.path is required/
  );
});

test("generateCandidates does not write any files", () => {
  const targetPath = fixtureRepo();
  const goal = fixtureGoal(targetPath);
  const scan = {
    version: "0.1.0",
    target: targetPath,
    scannedAt: new Date().toISOString(),
    git: { head: "aabbccdd", dirty: false },
    package: null,
    suggestedValidation: []
  };
  generateCandidates({ targetPath, goal, scan });
  // Verify nothing was written into targetPath that wasn't there before
  assert.ok(!existsSync(join(targetPath, "ideas.json")), "should not write ideas.json");
  assert.ok(!existsSync(join(targetPath, "scan.json")), "should not write scan.json");
});
