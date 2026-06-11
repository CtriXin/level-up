import { join, resolve } from "node:path";
import { ensureDir, VERSION, writeJson } from "./runtime.mjs";

export function selectNextCandidate(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const round = Number(options.round ?? 1);
  const candidates = options.candidates ?? [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("No candidates available. Run ideas first.");
  }

  const priorResults = options.priorResults ?? [];
  const tried = new Set(priorResults.map((result) => result.candidateId).filter(Boolean));
  const lastResult = priorResults.at(-1) ?? null;
  const adaptation = buildAdaptation(lastResult);
  const requestedId = options.requestedId || null;
  const selected = requestedId
    ? requireCandidate(candidates, requestedId)
    : adaptation?.candidate ?? pickUntriedCandidate(candidates, tried);
  const reason = selectionReason({ requestedId, selected, tried, adaptation });

  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  ensureDir(experimentDir);
  const manifest = {
    version: VERSION,
    round,
    selectedCandidateId: selected.id,
    syntheticCandidate: Boolean(adaptation?.candidate && selected.id === adaptation.candidate.id),
    reason,
    priorCandidateIds: [...tried],
    lastResult: summarizeLastResult(lastResult),
    adaptation,
    createdAt: new Date().toISOString(),
    files: {
      manifest: join(experimentDir, "strategy.json")
    }
  };
  writeJson(manifest.files.manifest, manifest);
  return { candidate: selected, manifest };
}

function buildAdaptation(lastResult) {
  if (!lastResult || lastResult.decision === "keep") {
    return null;
  }
  const checks = lastResult.evaluation?.checks ?? {};
  if (checks.changed === false) {
    return {
      trigger: "no-change",
      action: "concretize-apply",
      reason: "previous round produced no worktree delta",
      apply: {
        mode: "write-file",
        targetFile: "proof/adaptive-{roundPadded}-{candidateId}.txt",
        content: "adaptive retry after no-change: round {round} candidate {candidateId}\n"
      }
    };
  }
  if (checks.applyPassed === false || lastResult.apply?.status === "blocked") {
    return {
      trigger: "apply-blocked",
      action: "stop-or-require-safe-apply",
      reason: `previous apply status was ${lastResult.apply?.status ?? "unknown"}`
    };
  }
  if (checks.validationPassed === false) {
    return {
      trigger: "validation-failed",
      action: "generate-validation-repair-candidate",
      reason: "previous validation failed; next candidate should repair the validation path before broader mutation",
      apply: repairApply(
        "validation-failed",
        "The previous round failed validation. This artifact proves the repair candidate took over the apply step before broader mutation."
      ),
      candidate: repairCandidate({
        id: "adaptive-validation-repair",
        title: "Repair validation failure before continuing",
        hypothesis: "A focused validation repair candidate can restore the local gate before level-up attempts broader experiments.",
        expectedImpact: "Increases confidence that future keep decisions are based on passing validation rather than ignored failures.",
        risk: "Low to medium; validation repair can mask a real product bug if it only weakens the gate.",
        rollback: "Discard the experiment worktree or revert the validation repair commit.",
        validation: lastResult.validation
      })
    };
  }
  if (checks.reviewPassed === false) {
    return {
      trigger: "review-blocked",
      action: "generate-review-blocker-repair-candidate",
      reason: "self-review blocked the previous experiment; next candidate should address the blocker directly",
      apply: repairApply(
        "review-blocked",
        "The previous round was blocked by self-review. This artifact proves the repair candidate took over the apply step before broader mutation."
      ),
      candidate: repairCandidate({
        id: "adaptive-review-blocker-repair",
        title: "Address self-review blocker",
        hypothesis: "A focused repair candidate can remove the blocker that made the previous experiment unsafe to keep.",
        expectedImpact: "Allows the loop to continue only after the specific review risk is reduced.",
        risk: "Medium; blocker repair may require human review if the issue touches safety boundaries.",
        rollback: "Discard the experiment worktree or revert the blocker repair commit.",
        validation: lastResult.validation
      })
    };
  }
  return {
    trigger: "discarded",
    action: "switch-candidate",
    reason: "previous round was discarded; try another candidate"
  };
}

function repairApply(trigger, body) {
  return {
    mode: "write-file",
    targetFile: "proof/repair-{roundPadded}-{candidateId}.md",
    content: [
      "# Adaptive repair candidate",
      "",
      `Trigger: ${trigger}`,
      "Round: {round}",
      "Candidate: {candidateId}",
      "",
      body,
      ""
    ].join("\n")
  };
}

function repairCandidate(fields) {
  return {
    id: fields.id,
    title: fields.title,
    hypothesis: fields.hypothesis,
    expectedImpact: fields.expectedImpact,
    risk: fields.risk,
    rollback: fields.rollback,
    validation: fields.validation ?? []
  };
}

function summarizeLastResult(result) {
  if (!result) {
    return null;
  }
  return {
    round: result.round,
    candidateId: result.candidateId,
    decision: result.decision,
    applyStatus: result.apply?.status ?? null,
    checks: result.evaluation?.checks ?? null,
    reasons: result.evaluation?.reasons ?? []
  };
}

function selectionReason({ requestedId, selected, tried, adaptation }) {
  if (requestedId) {
    return "user requested this candidate";
  }
  if (adaptation?.candidate) {
    return `${adaptation.trigger} triggered synthetic repair candidate ${selected.id}`;
  }
  if (adaptation?.trigger === "no-change") {
    return "previous round made no change; switching candidate and using a concrete adaptive apply";
  }
  if (tried.has(selected.id)) {
    return "all generated candidates were already tried; repeating the highest-priority candidate";
  }
  return "selected the highest-priority untried candidate";
}

function requireCandidate(candidates, requestedId) {
  const found = candidates.find((candidate) => candidate.id === requestedId);
  if (!found) {
    throw new Error(`Candidate not found: ${requestedId}`);
  }
  return found;
}

function pickUntriedCandidate(candidates, tried) {
  const untried = candidates.filter((candidate) => !tried.has(candidate.id));
  const pool = untried.length ? untried : candidates;
  return (
    pool.find((candidate) => candidate.id.startsWith("metric-"))
    || pool.find((candidate) => candidate.id === "guardrail-hardening")
    || pool[0]
  );
}
