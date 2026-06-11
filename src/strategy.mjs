import { join, resolve } from "node:path";
import { ensureDir, VERSION, writeJson } from "./runtime.mjs";

export function selectNextCandidate(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const round = Number(options.round ?? 1);
  const candidates = options.candidates ?? [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("No candidates available. Run ideas first.");
  }

  const tried = new Set((options.priorResults ?? []).map((result) => result.candidateId).filter(Boolean));
  const requestedId = options.requestedId || null;
  const selected = requestedId
    ? requireCandidate(candidates, requestedId)
    : pickUntriedCandidate(candidates, tried);
  const reason = requestedId
    ? "user requested this candidate"
    : tried.has(selected.id)
      ? "all generated candidates were already tried; repeating the highest-priority candidate"
      : "selected the highest-priority untried candidate";

  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  ensureDir(experimentDir);
  const manifest = {
    version: VERSION,
    round,
    selectedCandidateId: selected.id,
    reason,
    priorCandidateIds: [...tried],
    createdAt: new Date().toISOString(),
    files: {
      manifest: join(experimentDir, "strategy.json")
    }
  };
  writeJson(manifest.files.manifest, manifest);
  return { candidate: selected, manifest };
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
