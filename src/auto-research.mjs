// 独立机器 intake 源:不依赖 level-up 执行环,可被外部复用;入口见 machine-intake.mjs
/**
 * auto-research.mjs — pure function module for generating improvement candidates.
 *
 * Constraints:
 * - Does NOT write any files (callers own persistence).
 * - Does NOT import state-core, autopilot, strategy, evaluator, apply, or any
 *   other execution-environment module.
 * - Imports only from util.mjs (pure tools: scanTarget, slugify, VERSION).
 */

import { scanTarget, slugify, VERSION } from "./util.mjs";

/**
 * Generate improvement candidates for a target repository.
 *
 * @param {object} params
 * @param {string} [params.targetPath]  Explicit repo path. Falls back to goal.target.path.
 * @param {object} params.goal          Parsed goal object (from goal.json or equivalent).
 * @param {object} [params.scan]        Pre-computed scan object. If absent, scanTarget() is called.
 * @param {number} [params.limit=5]     Max number of candidates to return.
 * @returns {{ version, generatedAt, slot, skipped, candidates }}
 */
export function generateCandidates({ targetPath, goal, scan, limit = 5 }) {
  const resolvedPath = targetPath ?? goal?.target?.path;
  if (!resolvedPath) {
    throw new Error("generateCandidates: targetPath or goal.target.path is required");
  }
  if (!goal) {
    throw new Error("generateCandidates: goal is required");
  }

  const resolvedScan = scan ?? scanTarget(resolvedPath);
  const candidates = buildCandidates(goal, resolvedScan, limit);

  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    slot: "ideation",
    skipped: false,
    candidates
  };
}

// ---------------------------------------------------------------------------
// Internal candidate builders — mirrored from ideation.mjs (kept in sync).
// All functions below are pure: no I/O, no side effects.
// ---------------------------------------------------------------------------

function buildCandidates(goal, scan, limit) {
  const candidates = [
    baselineValidationCandidate(goal, scan),
    metricFocusedCandidate(goal, scan),
    guardrailCandidate(goal, scan),
    codeHealthCandidate(goal, scan),
    documentationCandidate(goal, scan)
  ];
  return candidates.slice(0, Number(limit));
}

function commonValidation(scan) {
  const commands = scan.suggestedValidation?.length
    ? scan.suggestedValidation
    : ["git diff --check"];
  return commands.map((command) => ({
    command,
    status: "pending"
  }));
}

function candidate(id, title, goal, scan, fields) {
  return {
    id,
    title: title.trim(),
    hypothesis: fields.hypothesis,
    expectedImpact: fields.expectedImpact,
    risk: fields.risk,
    validation: fields.validation ?? commonValidation(scan),
    rollback: fields.rollback ?? "Discard the experiment worktree or reset the experiment branch.",
    scoreHint: fields.scoreHint ?? cleanMetricId(goal.primaryMetric.name)
  };
}

function cleanMetricId(value) {
  return String(value).replace(/^_+|_+$/g, "") || "primary_score";
}

function cleanMetricLabel(value) {
  return cleanMetricId(value).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function baselineValidationCandidate(goal, scan) {
  return candidate("baseline-validation", "Establish a comparable baseline", goal, scan, {
    hypothesis:
      "A reliable baseline makes later keep/discard decisions safer and prevents metric drift.",
    expectedImpact:
      "Improves experiment quality by making the current validation and scoring surface explicit.",
    risk: "Low; may reveal missing scripts or an ambiguous metric before code changes begin.",
    validation: commonValidation(scan),
    rollback: "Remove the generated baseline artifact from the experiment worktree."
  });
}

function metricFocusedCandidate(goal, scan) {
  const metricName = cleanMetricLabel(goal.primaryMetric.name);
  return candidate(`metric-${slugify(metricName)}`, `Improve ${metricName}`, goal, scan, {
    hypothesis: `A targeted change can improve ${goal.primaryMetric.description} without violating guardrails.`,
    expectedImpact: `Moves the primary metric in the ${goal.primaryMetric.direction} direction.`,
    risk: "Medium; metric-only work can Goodhart if guardrails are too weak.",
    validation: commonValidation(scan)
  });
}

function guardrailCandidate(goal, scan) {
  return candidate("guardrail-hardening", "Harden guardrails before optimizing", goal, scan, {
    hypothesis:
      "Adding or improving guardrail checks reduces the chance that an apparent metric win breaks behavior.",
    expectedImpact:
      "Makes later L3 autonomy safer by increasing confidence in keep/discard decisions.",
    risk: "Low; may slow iteration if validation becomes too broad.",
    validation: commonValidation(scan)
  });
}

function codeHealthCandidate(goal, scan) {
  const framework = scan.package?.frameworks?.[0] ?? "project";
  return candidate("code-health-simplification", `Simplify ${framework} implementation surface`, goal, scan, {
    hypothesis:
      "Removing unnecessary complexity can improve maintainability without changing product behavior.",
    expectedImpact:
      "Reduces future experiment risk and may improve build or runtime characteristics.",
    risk: "Medium; simplification can accidentally remove edge-case behavior.",
    validation: commonValidation(scan)
  });
}

function documentationCandidate(goal, scan) {
  return candidate("decision-doc", "Record the experiment decision surface", goal, scan, {
    hypothesis:
      "Documenting metric, guardrails, and rollback before mutation makes no-human runs easier to audit.",
    expectedImpact:
      "Improves handoff quality and reduces ambiguity for future autonomous rounds.",
    risk: "Low; documentation alone may not move the primary metric.",
    validation: commonValidation(scan)
  });
}
