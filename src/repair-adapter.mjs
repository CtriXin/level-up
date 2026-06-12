const CLEAN_TRAILING_WHITESPACE_COMMAND = "node -e \"const { spawnSync } = require('child_process'); const fs = require('fs'); const check = spawnSync('git', ['diff', '--check'], { encoding: 'utf8' }); const files = [...new Set((check.stdout || '').split(/\\\\r?\\\\n/).map((line) => line.split(':')[0]).filter(Boolean))]; for (const file of files) { if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue; const data = fs.readFileSync(file, 'utf8'); const next = data.replace(/[ \\\\t]+$/gm, '').replace(/\\\\n{2,}$/g, '\\\\n'); if (next !== data) fs.writeFileSync(file, next); }\"";

export function buildRepairPlan(trigger, lastResult) {
  const proposal = buildRepairProposal(trigger, lastResult);
  return {
    proposal,
    apply: proposalToApply(proposal, lastResult)
  };
}

export function buildRepairApply(trigger, lastResult) {
  return buildRepairPlan(trigger, lastResult).apply;
}

function buildRepairProposal(trigger, lastResult) {
  const target = repairTarget(trigger, lastResult);
  const evidence = evidenceLines(trigger, lastResult);
  return {
    id: `${target.kind}-proposal`,
    trigger,
    kind: target.kind,
    mode: target.mode,
    targetFile: target.targetFile,
    command: target.command,
    objective: target.objective,
    rationale: target.rationale,
    evidence,
    safety: {
      repeatsFailedApply: false,
      rawOutputIncluded: false,
      secretRedaction: true
    }
  };
}

function proposalToApply(proposal, lastResult) {
  if (proposal.mode === "command") {
    return {
      mode: "command",
      command: proposal.command
    };
  }
  return {
    mode: proposal.mode,
    targetFile: proposal.targetFile,
    content: renderRepairArtifact(proposal, lastResult)
  };
}

function renderRepairArtifact(proposal, lastResult) {
  return [
    "# Adaptive repair candidate",
    "",
    `Trigger: ${proposal.trigger}`,
    `Previous round: ${lastResult?.round ?? "unknown"}`,
    `Previous candidate: ${lastResult?.candidateId ?? "unknown"}`,
    `Previous decision: ${lastResult?.decision ?? "unknown"}`,
    "Round: {round}",
    "Candidate: {candidateId}",
    "",
    "## Proposal",
    "",
    `Mode: ${proposal.mode}`,
    `Target: ${proposal.targetFile ?? proposal.command ?? "none"}`,
    `Objective: ${proposal.objective}`,
    `Rationale: ${proposal.rationale}`,
    "",
    "## Evidence",
    "",
    ...proposal.evidence,
    "",
    "## Safety",
    "",
    `- repeatsFailedApply: ${proposal.safety.repeatsFailedApply}`,
    `- rawOutputIncluded: ${proposal.safety.rawOutputIncluded}`,
    `- secretRedaction: ${proposal.safety.secretRedaction}`,
    "",
    "## Next action",
    "",
    "Use this bounded repair proposal to drive the next adapter step without repeating the failed apply input.",
    ""
  ].join("\n");
}

function repairTarget(trigger, lastResult) {
  if (trigger === "validation-failed") {
    if (canCleanTrailingWhitespace(lastResult)) {
      return {
        kind: "validation-repair",
        mode: "command",
        command: CLEAN_TRAILING_WHITESPACE_COMMAND,
        objective: "Remove trailing whitespace from changed files so git diff --check can pass.",
        rationale: "The failed validation command is a formatting gate; cleaning whitespace preserves the gate instead of weakening it."
      };
    }
    return {
      kind: "validation-repair",
      mode: "write-file",
      targetFile: "proof/repair-{roundPadded}-{candidateId}.md",
      objective: "Restore the failed validation path before broader mutation.",
      rationale: "A repair round should focus on the failed local gate and preserve the gate instead of weakening it."
    };
  }
  if (trigger === "review-blocked") {
    return {
      kind: "review-blocker-repair",
      mode: "write-file",
      targetFile: "proof/repair-{roundPadded}-{candidateId}.md",
      objective: "Remove the blocker that made the previous experiment unsafe to keep.",
      rationale: "A repair round should address the specific self-review blocker before trying another broad candidate."
    };
  }
  return {
    kind: "generic-repair",
    mode: "write-file",
    targetFile: "proof/repair-{roundPadded}-{candidateId}.md",
    objective: "Capture bounded repair evidence for the next attempt.",
    rationale: "A repair round needs explicit scope before it can safely mutate the worktree."
  };
}

function canCleanTrailingWhitespace(lastResult) {
  return failedValidationCommands(lastResult).some((command) => command.command === "git diff --check");
}

function failedValidationCommands(lastResult) {
  return (lastResult?.validation ?? []).flatMap((phase) => failedCommands(phase));
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
