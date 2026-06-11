import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { generateRunnerPacket } from "./runner.mjs";
import { runApplyStep } from "./apply.mjs";
import { evaluateExperiment } from "./evaluator.mjs";
import { selectNextCandidate } from "./strategy.mjs";

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
    const strategy = selectNextCandidate(runRoot, {
      round,
      candidates: ideas.candidates,
      requestedId: options.candidate,
      priorResults: results
    });
    const experiment = runRound({
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
  const resolvedApply = {
    applyCommand: renderTemplate(applyCommand, templateValues),
    applyPatch: renderTemplate(applyPatch, templateValues),
    applyWriteFile: renderTemplate(applyWriteFile, templateValues),
    applyContent: renderTemplate(applyContent, templateValues),
    applyContentFile: renderTemplate(applyContentFile, templateValues)
  };
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
  const before = getWorktreeStatus(worktreePath);
  const apply = runApplyStep({
    runRoot,
    round,
    candidate,
    worktreePath,
    ...resolvedApply
  });
  const experimentPhase = runDevLoop(runRoot, { phase: "experiment", execute });
  const finalPhase = runDevLoop(runRoot, { phase: "final", execute });
  const after = getWorktreeStatus(worktreePath);
  const review = reviewExperiment({
    worktreePath,
    candidate,
    applyCommand,
    devLoopResults: [experimentPhase, finalPhase]
  });
  const changed = after.length > 0 && before !== after;
  const evaluation = evaluateExperiment(runRoot, {
    round,
    candidate,
    changed,
    apply,
    validation: [experimentPhase, finalPhase],
    review
  });
  const commit = evaluation.decision === "keep" && commitKept ? commitExperiment(worktreePath, candidate) : "0000000";

  const result = {
    version: VERSION,
    round,
    candidateId: candidate.id,
    decision: evaluation.decision,
    score: evaluation.score,
    commit,
    changed,
    strategy,
    runner: runnerPacket,
    apply,
    validation: [experimentPhase, finalPhase],
    evaluation,
    review
  };
  writeJson(join(experimentDir, "result.json"), result);
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

function renderTemplate(value, replacements) {
  if (value === undefined || value === null) {
    return value;
  }
  return String(value).replace(/\{(round|roundPadded|candidateId)\}/g, (_, key) => replacements[key]);
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
