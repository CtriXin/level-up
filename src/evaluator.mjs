import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";
import { readMetricComparison } from "./metric.mjs";

export function evaluateExperiment(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const round = Number(options.round ?? 1);
  const validation = options.validation ?? [];
  const apply = options.apply ?? { status: "skipped" };
  const review = options.review ?? { status: "unknown" };
  const changed = Boolean(options.changed);
  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  const metric = readMetricComparison({ runRoot, experimentDir, direction: readDirection(runRoot) });

  const checks = {
    changed,
    validationPassed: validation.every((phase) => phase.status === "pass" || (!phase.executed && phase.status === "planned")),
    applyPassed: apply.status === "pass" || apply.status === "skipped",
    reviewPassed: review.status !== "blocked",
    metricImproved: metric.available ? metric.improved : null
  };
  const gatesPassed = checks.changed && checks.validationPassed && checks.applyPassed && checks.reviewPassed;
  const metricPassed = !metric.available || metric.improved === true;
  const decision = gatesPassed && metricPassed ? "keep" : "discard";
  const score = scoreFor(decision, metric);
  const reasons = decision === "keep" ? [keepReason(metric)] : discardReasons(checks, apply, review, metric);

  ensureDir(experimentDir);
  const result = {
    version: VERSION,
    round,
    candidateId: options.candidate?.id ?? null,
    decision,
    score,
    checks,
    metric,
    reasons,
    createdAt: new Date().toISOString(),
    files: {
      manifest: join(experimentDir, "evaluation.json")
    }
  };
  writeJson(result.files.manifest, result);
  return result;
}

function readDirection(runRoot) {
  const goalPath = join(runRoot, "goal.json");
  if (!existsSync(goalPath)) {
    return "increase";
  }
  try {
    return readJson(goalPath)?.primaryMetric?.direction ?? "increase";
  } catch {
    return "increase";
  }
}

function scoreFor(decision, metric) {
  if (metric.available) {
    return metric.delta;
  }
  return decision === "keep" ? 1 : 0;
}

function keepReason(metric) {
  if (metric.available) {
    return `primary metric improved (${metric.baseline} -> ${metric.value}, want ${metric.direction}) and apply, validation, and review gates passed`;
  }
  return "changed worktree passed apply, validation, and review gates";
}

function discardReasons(checks, apply, review, metric) {
  const reasons = [];
  if (!checks.changed) {
    reasons.push("worktree did not gain a new change during this round");
  }
  if (!checks.applyPassed) {
    reasons.push(`apply status was ${apply.status}`);
  }
  if (!checks.validationPassed) {
    reasons.push("one or more validation phases failed");
  }
  if (!checks.reviewPassed) {
    reasons.push(`review blocked the experiment: ${(review.blockers ?? []).join("; ") || "no blocker detail"}`);
  }
  if (metric.available && metric.improved === false) {
    reasons.push(`primary metric did not improve (${metric.baseline} -> ${metric.value}, want ${metric.direction})`);
  }
  return reasons;
}
