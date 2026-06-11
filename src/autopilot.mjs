import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { generateIdeas } from "./ideation.mjs";
import { generatePrPack } from "./pr-pack.mjs";
import {
  appendLedger,
  createWorktree,
  ensureDir,
  readJson,
  runGit,
  scanTarget,
  VERSION,
  writeJson
} from "./runtime.mjs";
import { runDevLoop } from "./dev-loop.mjs";
import { generateWorkPack } from "./work-pack.mjs";
import { reviewExperiment } from "./self-review.mjs";

export function runAutopilot(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const maxRounds = Number(options.rounds ?? 1);
  const results = [];
  ensureRunInputs(runRoot, goal);
  const worktree = createWorktree(runRoot, { force: Boolean(options.force) });

  for (let index = 0; index < maxRounds; index += 1) {
    const state = readJson(join(runRoot, "state.json"));
    const round = Number(options.round ?? state.currentRound + 1);
    const ideas = readJson(join(runRoot, "ideas.json"));
    const candidate = selectCandidate(ideas.candidates, options.candidate);
    const experiment = runRound({
      runRoot,
      round,
      candidate,
      worktreePath: worktree.worktreePath,
      applyCommand: options.applyCommand,
      execute: Boolean(options.execute),
      commitKept: Boolean(options.commitKept)
    });
    results.push(experiment);
    if (experiment.decision !== "keep") {
      break;
    }
  }

  const prPack = options.prPack ? generatePrPack(runRoot, { visual: Boolean(options.visual) }) : null;
  const summary = {
    version: VERSION,
    runId: goal.runId,
    status: results.every((result) => result.decision === "keep") ? "pass" : "stopped",
    rounds: results,
    prPack
  };
  writeJson(join(runRoot, "autopilot-summary.json"), summary);
  return summary;
}

function ensureRunInputs(runRoot, goal) {
  if (!existsSync(join(runRoot, "scan.json"))) {
    scanTarget(goal.target.path, runRoot);
  }
  if (!existsSync(join(runRoot, "ideas.json"))) {
    generateIdeas(runRoot);
  }
  if (!existsSync(join(runRoot, "work-pack", "manifest.json"))) {
    generateWorkPack(runRoot);
  }
  if (!existsSync(join(runRoot, "dev-loop-baseline.json"))) {
    runDevLoop(runRoot, { phase: "baseline" });
  }
}

function selectCandidate(candidates, requestedId) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("No candidates available. Run ideas first.");
  }
  if (requestedId) {
    const found = candidates.find((candidate) => candidate.id === requestedId);
    if (!found) {
      throw new Error(`Candidate not found: ${requestedId}`);
    }
    return found;
  }
  return (
    candidates.find((candidate) => candidate.id.startsWith("metric-"))
    || candidates.find((candidate) => candidate.id === "guardrail-hardening")
    || candidates[0]
  );
}

function runRound({ runRoot, round, candidate, worktreePath, applyCommand, execute, commitKept }) {
  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  ensureDir(experimentDir);
  writeExperimentMarkdown(join(experimentDir, "EXPERIMENT.md"), { round, candidate, applyCommand, execute });

  const before = getWorktreeStatus(worktreePath);
  const apply = applyCommand ? runShell(worktreePath, applyCommand) : null;
  const experimentPhase = runDevLoop(runRoot, { phase: "experiment", execute });
  const finalPhase = runDevLoop(runRoot, { phase: "final", execute });
  const after = getWorktreeStatus(worktreePath);
  const review = reviewExperiment({
    worktreePath,
    candidate,
    applyCommand,
    devLoopResults: [experimentPhase, finalPhase]
  });
  const changed = after.length > 0 || before !== after;
  const validationPassed = [experimentPhase, finalPhase].every((phase) => phase.status === "pass" || (!execute && phase.status === "planned"));
  const applyPassed = !apply || apply.status === "pass";
  const decision = changed && validationPassed && applyPassed && review.status !== "blocked" ? "keep" : "discard";
  const commit = decision === "keep" && commitKept ? commitExperiment(worktreePath, candidate) : "0000000";
  const score = decision === "keep" ? 1 : 0;

  const result = {
    version: VERSION,
    round,
    candidateId: candidate.id,
    decision,
    score,
    commit,
    changed,
    apply,
    validation: [experimentPhase, finalPhase],
    review
  };
  writeJson(join(experimentDir, "result.json"), result);
  appendLedger(runRoot, {
    round,
    status: decision,
    score,
    commit,
    description: `${candidate.title}: ${decision}`
  });
  return result;
}

function writeExperimentMarkdown(path, { round, candidate, applyCommand, execute }) {
  writeFileSync(
    path,
    `# Experiment round ${round}

## Candidate

- id: \`${candidate.id}\`
- title: ${candidate.title}

## Hypothesis

${candidate.hypothesis}

## Expected Impact

${candidate.expectedImpact}

## Risk

${candidate.risk}

## Rollback

${candidate.rollback}

## Apply

${applyCommand ? `\`${applyCommand}\`` : "_No apply command supplied. The agent or adapter must modify the worktree before this can keep._"}

## Validation Mode

${execute ? "execute" : "planned"}
`
  );
}

function runShell(cwd, command) {
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

function getWorktreeStatus(worktreePath) {
  return runGit(worktreePath, ["status", "--porcelain"], { allowFailure: true }).stdout;
}

function commitExperiment(worktreePath, candidate) {
  const status = getWorktreeStatus(worktreePath);
  if (!status) {
    return "0000000";
  }
  runGit(worktreePath, ["add", "."]);
  const session = process.env.CODEX_THREAD_ID || "local";
  runGit(worktreePath, [
    "-c",
    "user.name=Codex",
    "-c",
    "user.email=gpt-5@openai.com",
    "commit",
    "-m",
    `level-up: keep ${candidate.id}`,
    "-m",
    [
      "Agent-Model: gpt-5",
      "Agent-Family: openai",
      `Agent-Session: ${session}`,
      "Agent-Step: autopilot.keep"
    ].join("\n")
  ]);
  return runGit(worktreePath, ["rev-parse", "--short=7", "HEAD"]).stdout;
}
