import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./runtime.mjs";

// Optional numeric-metric slot. Convention:
//   <runRoot>/metric-baseline.json    -> { "value": <number> }  (round-0 baseline)
//   <runRoot>/metric-incumbent.json   -> { "value": <number> }  (best kept so far)
//   <experimentDir>/metric.json       -> { "value": <number> }  (this round)
// The round is compared against the INCUMBENT (best kept so far), falling back
// to the original baseline when no round has been kept yet. Comparing against
// the incumbent — not a fixed baseline — is what makes multi-round optimization
// monotonic: a round that beats the original baseline but is worse than the best
// kept round is correctly discarded. autopilot updates the incumbent after each
// keep. When the reference or the round value is missing, the comparison is
// unavailable and the evaluator falls back to its binary keep/discard gates.
export function readMetricComparison({ runRoot, experimentDir, direction }) {
  const dir = direction === "decrease" ? "decrease" : "increase";
  const baseline = readMetricValue(join(runRoot, "metric-baseline.json"));
  const incumbent = readMetricValue(join(runRoot, "metric-incumbent.json"));
  const value = readMetricValue(join(experimentDir, "metric.json"));
  const reference = incumbent ?? baseline;
  if (reference === null || value === null) {
    return { available: false, direction: dir, baseline, incumbent, reference, value, improved: null, delta: null };
  }
  const gain = dir === "decrease" ? reference - value : value - reference;
  return {
    available: true,
    direction: dir,
    baseline,
    incumbent,
    reference,
    value,
    delta: round6(gain),
    improved: gain > 0
  };
}

function readMetricValue(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const value = Number(readJson(path)?.value);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
