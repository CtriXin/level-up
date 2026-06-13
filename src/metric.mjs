import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./runtime.mjs";

// Optional numeric-metric slot. Convention:
//   <runRoot>/metric-baseline.json   -> { "value": <number> }
//   <experimentDir>/metric.json      -> { "value": <number> }
// When either file is missing or non-numeric the comparison is unavailable and
// the evaluator falls back to its binary keep/discard gates. When both exist the
// metric drives keep/discard using primaryMetric.direction, the karpathy model.
export function readMetricComparison({ runRoot, experimentDir, direction }) {
  const dir = direction === "decrease" ? "decrease" : "increase";
  const baseline = readMetricValue(join(runRoot, "metric-baseline.json"));
  const value = readMetricValue(join(experimentDir, "metric.json"));
  if (baseline === null || value === null) {
    return { available: false, direction: dir, baseline, value, improved: null, delta: null };
  }
  const gain = dir === "decrease" ? baseline - value : value - baseline;
  return {
    available: true,
    direction: dir,
    baseline,
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
