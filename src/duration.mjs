// Parse a wall-clock budget like "5m", "30s", "90000" (bare number = ms).
// Returns null only when the value is absent. A present-but-invalid value
// (a typo like "5min", or a bare flag with no argument) throws, so a budget is
// never silently disabled.
export function parseDuration(value) {
  if (value == null) {
    return null;
  }
  if (value === true) {
    throw new Error("--budget requires a value, e.g. 5m, 30s, or 90000");
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`invalid --budget value: ${value} (use e.g. 5m, 30s, or 90000)`);
  }
  const scale = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2] || "ms"];
  return Math.round(Number(match[1]) * scale);
}
