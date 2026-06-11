import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";

export function generatePrPack(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const state = readJson(join(runRoot, "state.json"));
  const scan = readOptionalJson(join(runRoot, "scan.json"));
  const ideas = readOptionalJson(join(runRoot, "ideas.json"));
  const ledger = readLedger(join(runRoot, "ledger.tsv"));
  const createdAt = new Date().toISOString();
  const outputDir = join(runRoot, "pr");
  ensureDir(outputDir);

  const visualMode = Boolean(options.visual || inferVisualMode(goal, ideas));
  const reviewerBot = typeof options.reviewerBot === "string" ? options.reviewerBot : null;
  const manifest = {
    version: VERSION,
    runId: goal.runId,
    createdAt,
    outputDir,
    reviewerBot,
    visualMode,
    files: {
      prBody: join(outputDir, "PR_BODY.md"),
      bugReview: join(outputDir, "BUG_REVIEW_REQUEST.md"),
      visualEvidence: join(outputDir, "VISUAL_EVIDENCE.md"),
      manifest: join(outputDir, "manifest.json")
    }
  };

  writeFileSync(manifest.files.prBody, renderPrBody({ goal, state, scan, ideas, ledger, visualMode }));
  writeFileSync(manifest.files.bugReview, renderBugReview({ goal, state, ledger, reviewerBot }));
  writeFileSync(manifest.files.visualEvidence, renderVisualEvidence({ goal, visualMode }));
  writeJson(manifest.files.manifest, manifest);
  return manifest;
}

function readOptionalJson(path) {
  return existsSync(path) ? readJson(path) : null;
}

function readLedger(path) {
  if (!existsSync(path)) {
    return [];
  }
  const [headerLine, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  if (!headerLine || lines.length === 0) {
    return [];
  }
  const headers = headerLine.split("\t");
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

function inferVisualMode(goal, ideas) {
  const text = [
    goal.objective,
    goal.primaryMetric?.description,
    ...(ideas?.candidates ?? []).map((candidate) => `${candidate.title} ${candidate.hypothesis}`)
  ]
    .join(" ")
    .toLowerCase();
  return /\b(ui|visual|design|screenshot|responsive|layout|css|homepage|page)\b/.test(text);
}

function renderPrBody({ goal, state, scan, ideas, ledger, visualMode }) {
  const kept = ledger.filter((entry) => entry.status === "keep");
  const discarded = ledger.filter((entry) => entry.status === "discard");
  const crashed = ledger.filter((entry) => entry.status === "crash");
  return `# level-up PR

## Goal

${goal.objective}

## Autopilot Boundary

- mode: \`${goal.mode}\`
- run id: \`${goal.runId}\`
- target: \`${goal.target.path}\`
- base head: \`${goal.target.head}\`
- current status: \`${state.status}\`

## Metrics

- primary: \`${formatMetricId(goal.primaryMetric.name)}\`
- display name: ${formatMetricName(goal.primaryMetric.name)}
- direction: \`${goal.primaryMetric.direction}\`
- description: ${goal.primaryMetric.description}

## Experiment Ledger

- kept: ${kept.length}
- discarded: ${discarded.length}
- crashed: ${crashed.length}

${renderLedgerTable(ledger)}

## Validation

${renderValidation(scan)}

## Review Gate

- [ ] Bug review completed
- [ ] Guardrails checked
- [ ] No merge/deploy/global config/secret/prod-data mutation
- [ ] Human approved before merge

## Visual Evidence

${visualMode
  ? "- [ ] Screenshots attached\n- [ ] Important visual changes annotated\n- [ ] Design language/audit notes included"
  : "No visual evidence required by the current goal. If the PR changes UI, add screenshots and annotations before merge."}

## Candidate Ideas

${renderIdeas(ideas)}
`;
}

function formatMetricName(value) {
  return formatMetricId(value).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function formatMetricId(value) {
  return String(value).replace(/^_+|_+$/g, "") || "primary_score";
}

function renderLedgerTable(ledger) {
  if (ledger.length === 0) {
    return "_No experiment results recorded yet._";
  }
  const rows = ledger.map(
    (entry) =>
      `| ${entry.round} | ${entry.commit || "0000000"} | ${entry.score || ""} | ${entry.status} | ${entry.description} |`
  );
  return ["| Round | Commit | Score | Status | Description |", "| --- | --- | ---: | --- | --- |", ...rows].join("\n");
}

function renderValidation(scan) {
  const commands = scan?.suggestedValidation ?? [];
  if (commands.length === 0) {
    return "- [ ] No validation command detected; reviewer must define one before merge.";
  }
  return commands.map((command) => `- [ ] \`${command}\``).join("\n");
}

function renderIdeas(ideas) {
  const candidates = ideas?.candidates ?? [];
  if (candidates.length === 0) {
    return "_No generated candidates found._";
  }
  return candidates
    .map(
      (candidate) => `### ${candidate.title}

- hypothesis: ${candidate.hypothesis}
- expected impact: ${candidate.expectedImpact}
- risk: ${candidate.risk}
- rollback: ${candidate.rollback}`
    )
    .join("\n\n");
}

function renderBugReview({ goal, state, ledger, reviewerBot }) {
  return `# Bug Review Request

${reviewerBot ? `Reviewer bot: ${reviewerBot}\n` : ""}Please review this level-up run as a skeptical bug reviewer.

## Scope

- goal: ${goal.objective}
- run id: \`${goal.runId}\`
- status: \`${state.status}\`
- kept commits: ${ledger.filter((entry) => entry.status === "keep").map((entry) => entry.commit).join(", ") || "none"}

## Review Checklist

- [ ] Could this change break existing behavior while improving the chosen metric?
- [ ] Are validation commands sufficient for the affected surface?
- [ ] Did the agent skip any hard gate or undocumented assumption?
- [ ] Are dirty worktree, global config, secrets, ads, billing, and production data boundaries respected?
- [ ] If UI changed, are screenshots and annotations enough to understand the visual delta?
- [ ] Is the PR body truthful about what was executed versus assumed?

Return findings first, ordered by severity, with file/line references when possible.
`;
}

function renderVisualEvidence({ goal, visualMode }) {
  return `# Visual Evidence

Goal: ${goal.objective}

${visualMode
  ? "This run may affect visible UI. Attach evidence before merge."
  : "This run was not classified as visual. If any UI changed, treat the checklist below as required."}

## Required For UI / Design / Layout Changes

- [ ] Before screenshot
- [ ] After screenshot
- [ ] Annotated after screenshot with callouts
- [ ] Mobile viewport screenshot
- [ ] Desktop viewport screenshot
- [ ] Notes on design language changes
- [ ] Notes on what did not change

## Annotation Guidance

Mark the exact area changed, describe the intent, and connect it to the goal or metric. Avoid vague notes like "polished UI"; say what changed and where.
`;
}
