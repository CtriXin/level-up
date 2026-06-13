import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateIdeas } from "./ideation.mjs";
import { generatePrPack } from "./pr-pack.mjs";
import {
  VERSION,
  appendLedger,
  createWorktree,
  ensureDir,
  finalizeStateCoreRun,
  readJson,
  runGit,
  scanTarget,
  writeJson
} from "./runtime.mjs";
import { runDevLoop } from "./dev-loop.mjs";
import { generateWorkPack } from "./work-pack.mjs";
import { reviewExperiment } from "./self-review.mjs";
import { generateRunnerPacket } from "./runner.mjs";
import { runApplyStep } from "./apply.mjs";
import { evaluateExperiment } from "./evaluator.mjs";
import { selectNextCandidate } from "./strategy.mjs";

export function runAutopilot(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const stop = resolveStopConfig(goal, options);
  const results = [];
  ensureRunInputs(runRoot, goal);
  const worktree = createWorktree(runRoot, { force: Boolean(options.force) });
  const startedAt = Date.now();
  let noImprovement = 0;
  let stopReason = "rounds-exhausted";

  for (let index = 0; index < stop.maxRounds; index += 1) {
    if (stop.budgetMs != null && Date.now() - startedAt >= stop.budgetMs) {
      stopReason = "budget-exhausted";
      break;
    }
    const roundStart = Date.now();
    const experiment = runNextRound(runRoot, worktree, options, results);
    results.push(experiment);
    if (experiment.blocked) {
      stopReason = "blocked";
      break;
    }
    // maxMinutesPerRound is enforced post-hoc (soft): a round that overran its
    // budget completes, then the loop stops before launching another.
    if (stop.maxRoundMs != null && Date.now() - roundStart >= stop.maxRoundMs) {
      stopReason = "round-timeout";
      break;
    }
    if (experiment.decision === "keep") {
      noImprovement = 0;
    } else if ((noImprovement += 1) >= stop.maxNoImprovement) {
      stopReason = "no-improvement";
      break;
    } else if (!shouldContinueAfterDiscard(experiment, index, stop.maxRounds, options)) {
      if (options.adaptive === false && index < stop.maxRounds - 1) {
        stopReason = "no-improvement";
      }
      break;
    }
  }

  const summary = {
    version: VERSION,
    runId: goal.runId,
    status: summaryStatus(results),
    stopReason,
    rounds: results,
    budgetMs: stop.budgetMs,
    elapsedMs: Date.now() - startedAt,
    noImprovementRounds: noImprovement,
    prPack: options.prPack ? generatePrPack(runRoot, { visual: Boolean(options.visual) }) : null
  };
  writeJson(join(runRoot, "autopilot-summary.json"), summary);
  const stateCore = finalizeStateCoreRun(runRoot);
  if (stateCore) {
    summary.stateCore = stateCore;
    writeJson(join(runRoot, "autopilot-summary.json"), summary);
  }
  return summary;
}

// Stop conditions come from the goal contract, overridable per run. Default
// rounds stays 1 (single-shot) unless the caller opts into multi-round via
// --rounds or a wall-clock --budget; the budget then bounds maxRounds.
function resolveStopConfig(goal, options) {
  const limits = goal.stopConditions ?? {};
  // CLI --budget overrides the contract's maxWallClockMs; the contract is the
  // default, so the documented "default from goal.stopConditions" holds.
  const budgetMs = options.budgetMs ?? (limits.maxWallClockMs != null ? Number(limits.maxWallClockMs) : null);
  const defaultRounds = budgetMs != null ? Number(limits.maxRounds ?? 8) : 1;
  const maxRounds = Number(options.rounds ?? defaultRounds);
  const maxNoImprovement = Number(options.maxNoImprovement ?? limits.maxNoImprovementRounds ?? Infinity);
  const maxRoundMs = limits.maxMinutesPerRound != null ? Number(limits.maxMinutesPerRound) * 60000 : null;
  return { maxRounds, maxNoImprovement, budgetMs, maxRoundMs };
}

function runNextRound(runRoot, worktree, options, results) {
  const state = readJson(join(runRoot, "state.json"));
  const round = Number(options.round ?? state.currentRound + 1);
  const ideas = readJson(join(runRoot, "ideas.json"));
  const strategy = selectNextCandidate(runRoot, {
    round,
    candidates: ideas.candidates,
    requestedId: options.candidate,
    priorResults: results
  });
  return runRound({
    runRoot,
    round,
    candidate: strategy.candidate,
    strategy: strategy.manifest,
    worktreePath: worktree.worktreePath,
    applyCommand: options.applyCommand,
    applyPatch: options.applyPatch,
    applyWriteFile: options.applyWriteFile,
    applyContent: options.applyContent,
    applyContentFile: options.applyContentFile,
    runner: options.runner,
    runnerProfile: options.runnerProfile,
    skills: options.skills,
    mcp: options.mcp,
    tools: options.tools,
    execute: Boolean(options.execute),
    commitKept: Boolean(options.commitKept)
  });
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

// REDLINE_EXCEPTION(runRound): one orchestration seam keeps the round artifact,
// apply, validation, review, evaluation, incumbent update, and ledger write in order.
function runRound({
  runRoot,
  round,
  candidate,
  strategy,
  worktreePath,
  applyCommand,
  applyPatch,
  applyWriteFile,
  applyContent,
  applyContentFile,
  runner,
  runnerProfile,
  skills,
  mcp,
  tools,
  execute,
  commitKept
}) {
  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  ensureDir(experimentDir);
  const templateValues = applyTemplateValues({ round, candidate });
  const resolvedApply = resolveApplyInputs({
    applyCommand,
    applyPatch,
    applyWriteFile,
    applyContent,
    applyContentFile,
    strategy,
    templateValues
  });

  writeExperimentMarkdown(join(experimentDir, "EXPERIMENT.md"), {
    round,
    candidate,
    applyCommand: resolvedApply.applyCommand,
    applyPatch: resolvedApply.applyPatch,
    applyWriteFile: resolvedApply.applyWriteFile,
    execute
  });

  const runnerPacket = generateRunnerPacket(runRoot, {
    runner,
    profile: runnerProfile,
    candidate: candidate.id,
    worktreePath,
    skills,
    mcp,
    tools
  });
  const before = getWorktreeSnapshot(worktreePath);
  const apply = runApplyStep({
    runRoot,
    round,
    candidate,
    worktreePath,
    ...resolvedApply
  });
  const experimentPhase = runDevLoop(runRoot, { phase: "experiment", execute });
  const finalPhase = runDevLoop(runRoot, { phase: "final", execute });
  const after = getWorktreeSnapshot(worktreePath);
  const review = reviewExperiment({
    worktreePath,
    candidate,
    applyCommand: resolvedApply.applyCommand,
    devLoopResults: [experimentPhase, finalPhase]
  });
  const changed = after.hasChanges && before.signature !== after.signature;
  const evaluation = evaluateExperiment(runRoot, {
    round,
    candidate,
    changed,
    apply,
    validation: [experimentPhase, finalPhase],
    review
  });
  const commit = evaluation.decision === "keep" && commitKept ? commitExperiment(worktreePath, candidate) : "0000000";
  // Unsafe apply is a hard stop. Review blockers remain a discard so the
  // adaptive repair slot can create a focused follow-up candidate.
  const blocked = apply.status === "blocked";

  const result = {
    version: VERSION,
    round,
    candidateId: candidate.id,
    decision: evaluation.decision,
    score: evaluation.score,
    commit,
    changed,
    blocked,
    strategy,
    runner: runnerPacket,
    apply,
    validation: [experimentPhase, finalPhase],
    evaluation,
    review
  };
  writeJson(join(experimentDir, "result.json"), result);
  if (evaluation.decision === "keep" && evaluation.metric?.available) {
    // Advance the incumbent so later rounds compete against the best kept value,
    // not the original baseline.
    writeJson(join(runRoot, "metric-incumbent.json"), { value: evaluation.metric.value });
  }
  appendLedger(runRoot, {
    round,
    status: evaluation.decision,
    score: evaluation.score,
    commit,
    description: `${candidate.title}: ${evaluation.decision}`
  });
  return result;
}

function writeExperimentMarkdown(path, { round, candidate, applyCommand, applyPatch, applyWriteFile, execute }) {
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

${renderApplyIntent({ applyCommand, applyPatch, applyWriteFile })}

## Validation Mode

${execute ? "execute" : "planned"}
`
  );
}

function shouldContinueAfterDiscard(experiment, index, maxRounds, options) {
  if (options.adaptive === false) {
    return false;
  }
  if (experiment.decision !== "discard") {
    return false;
  }
  if (index >= maxRounds - 1) {
    return false;
  }
  if (experiment.apply?.status === "blocked") {
    return false;
  }
  return true;
}

function summaryStatus(results) {
  if (results.length === 0) {
    return "stopped";
  }
  if (results.every((result) => result.decision === "keep")) {
    return "pass";
  }
  if (results.some((result) => result.decision === "keep")) {
    return "adapted";
  }
  return "stopped";
}

function renderApplyIntent({ applyCommand, applyPatch, applyWriteFile }) {
  if (applyCommand) {
    return `mode: command\n\n\`${applyCommand}\``;
  }
  if (applyPatch) {
    return `mode: patch\n\n\`${applyPatch}\``;
  }
  if (applyWriteFile) {
    return `mode: write-file\n\n\`${applyWriteFile}\``;
  }
  return "_No apply input supplied. The agent or adapter must modify the worktree before this can keep._";
}

function applyTemplateValues({ round, candidate }) {
  return {
    round: String(round),
    roundPadded: String(round).padStart(3, "0"),
    candidateId: candidate.id
  };
}

function resolveApplyInputs({ applyCommand, applyPatch, applyWriteFile, applyContent, applyContentFile, strategy, templateValues }) {
  const explicit = {
    applyCommand: renderTemplate(applyCommand, templateValues),
    applyPatch: renderTemplate(applyPatch, templateValues),
    applyWriteFile: renderTemplate(applyWriteFile, templateValues),
    applyContent: renderTemplate(applyContent, templateValues),
    applyContentFile: renderTemplate(applyContentFile, templateValues)
  };
  const adaptiveApply = strategy?.adaptation?.apply;
  if (strategy?.syntheticCandidate && adaptiveApply) {
    return resolveAdaptiveApply(explicit, adaptiveApply, templateValues);
  }
  if (hasApplyInput(explicit)) {
    return explicit;
  }

  if (!adaptiveApply) {
    return explicit;
  }
  return resolveAdaptiveApply(explicit, adaptiveApply, templateValues);
}

function resolveAdaptiveApply(explicit, adaptiveApply, templateValues) {
  const base = {
    applyCommand: undefined,
    applyPatch: undefined,
    applyWriteFile: undefined,
    applyContent: undefined,
    applyContentFile: undefined
  };
  if (adaptiveApply.mode === "write-file") {
    return {
      ...base,
      applyWriteFile: renderTemplate(adaptiveApply.targetFile, templateValues),
      applyContent: renderTemplate(adaptiveApply.content, templateValues)
    };
  }
  if (adaptiveApply.mode === "command") {
    return {
      ...base,
      applyCommand: renderTemplate(adaptiveApply.command, templateValues)
    };
  }
  if (adaptiveApply.mode === "patch") {
    return {
      ...base,
      applyPatch: renderTemplate(adaptiveApply.patchFile, templateValues)
    };
  }
  return explicit;
}

function hasApplyInput(inputs) {
  return Boolean(inputs.applyCommand || inputs.applyPatch || inputs.applyWriteFile);
}

function renderTemplate(value, replacements) {
  if (value === undefined || value === null) {
    return value;
  }
  return String(value).replace(/\{(round|roundPadded|candidateId)\}/g, (_, key) => replacements[key]);
}

function getWorktreeStatus(worktreePath) {
  return runGit(worktreePath, ["status", "--porcelain"], { allowFailure: true }).stdout;
}

function getWorktreeSnapshot(worktreePath) {
  const status = getWorktreeStatus(worktreePath);
  const diff = runGit(worktreePath, ["diff", "--no-ext-diff"], { allowFailure: true }).stdout;
  return {
    status,
    diff,
    hasChanges: Boolean(status),
    signature: `${status}\n---diff---\n${diff}`
  };
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
