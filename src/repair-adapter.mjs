export function buildRepairApply(trigger, lastResult) {
  return {
    mode: "write-file",
    targetFile: "proof/repair-{roundPadded}-{candidateId}.md",
    content: [
      "# Adaptive repair candidate",
      "",
      `Trigger: ${trigger}`,
      `Previous round: ${lastResult?.round ?? "unknown"}`,
      `Previous candidate: ${lastResult?.candidateId ?? "unknown"}`,
      `Previous decision: ${lastResult?.decision ?? "unknown"}`,
      "Round: {round}",
      "Candidate: {candidateId}",
      "",
      "## Evidence",
      "",
      ...evidenceLines(trigger, lastResult),
      "",
      "## Next action",
      "",
      "Use this bounded repair artifact to drive the next adapter step without repeating the failed apply input.",
      ""
    ].join("\n")
  };
}

function evidenceLines(trigger, lastResult) {
  if (trigger === "validation-failed") {
    return validationEvidence(lastResult);
  }
  if (trigger === "review-blocked") {
    return reviewEvidence(lastResult);
  }
  return ["- no adapter evidence available"];
}

function validationEvidence(lastResult) {
  const phases = lastResult?.validation ?? [];
  const failedPhases = phases.filter((phase) => phase.status === "fail" || phase.status === "blocked");
  if (failedPhases.length === 0) {
    return ["- validation failed, but no failed phase details were captured"];
  }
  return failedPhases.flatMap((phase) => {
    const lines = [
      `- phase: ${clean(phase.phase ?? "unknown")}`,
      `  status: ${clean(phase.status ?? "unknown")}`
    ];
    for (const command of failedCommands(phase)) {
      lines.push(`  command: ${clean(command.command ?? "unknown")}`);
      lines.push(`  commandStatus: ${clean(command.status ?? "unknown")}`);
    }
    return lines;
  });
}

function reviewEvidence(lastResult) {
  const blockers = lastResult?.review?.blockers ?? [];
  if (blockers.length === 0) {
    return ["- review blocked, but no blocker details were captured"];
  }
  return blockers.map((blocker) => `- blocker: ${clean(blocker)}`);
}

function failedCommands(phase) {
  return (phase.commands ?? []).filter((command) => command.status === "fail" || command.status === "blocked");
}

function clean(value) {
  return String(value)
    .replace(/ghp_[A-Za-z0-9_]{6,}/g, "ghp_[redacted]")
    .replace(/sk-[A-Za-z0-9]{6,}/g, "sk-[redacted]")
    .replace(/AKIA[0-9A-Z]{8,}/g, "AKIA[redacted]")
    .slice(0, 240);
}
