import { join, resolve } from "node:path";
import { ensureDir, VERSION, writeJson } from "./runtime.mjs";

export function evaluateExperiment(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const round = Number(options.round ?? 1);
  const validation = options.validation ?? [];
  const apply = options.apply ?? { status: "skipped" };
  const review = options.review ?? { status: "unknown" };
  const changed = Boolean(options.changed);

  const checks = {
    changed,
    validationPassed: validation.every((phase) => phase.status === "pass" || (!phase.executed && phase.status === "planned")),
    applyPassed: apply.status === "pass" || apply.status === "skipped",
    reviewPassed: review.status !== "blocked"
  };
  const decision = checks.changed && checks.validationPassed && checks.applyPassed && checks.reviewPassed ? "keep" : "discard";
  const score = decision === "keep" ? 1 : 0;
  const reasons = decision === "keep" ? ["changed worktree passed apply, validation, and review gates"] : discardReasons(checks, apply, review);

  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  ensureDir(experimentDir);
  const result = {
    version: VERSION,
    round,
    candidateId: options.candidate?.id ?? null,
    decision,
    score,
    checks,
    reasons,
    createdAt: new Date().toISOString(),
    files: {
      manifest: join(experimentDir, "evaluation.json")
    }
  };
  writeJson(result.files.manifest, result);
  return result;
}

function discardReasons(checks, apply, review) {
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
  return reasons;
}
