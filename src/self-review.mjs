import { runGit, VERSION } from "./runtime.mjs";

const UNSAFE_COMMAND_PATTERNS = [
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bdeploy\b/,
  /\brm\s+-rf\s+\/\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bnpm\s+config\s+set\b/,
  /\bgit\s+config\s+--global\b/
];

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN (RSA |OPENSSH |DSA |EC )?PRIVATE KEY-----/
];

export function reviewExperiment({ worktreePath, candidate, applyCommand, devLoopResults }) {
  const blockers = [];
  const warnings = [];
  const commandText = applyCommand || "";

  for (const pattern of UNSAFE_COMMAND_PATTERNS) {
    if (pattern.test(commandText)) {
      blockers.push(`unsafe apply command matched ${pattern}`);
    }
  }

  const branch = runGit(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }).stdout;
  if (["main", "master", "develop"].includes(branch)) {
    blockers.push(`experiment is on protected base branch ${branch}`);
  }

  const diff = runGit(worktreePath, ["diff", "--cached"], { allowFailure: true }).stdout
    + "\n"
    + runGit(worktreePath, ["diff"], { allowFailure: true }).stdout;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(diff)) {
      blockers.push(`possible secret pattern detected in diff: ${pattern}`);
    }
  }

  if (!candidate?.hypothesis || !candidate?.expectedImpact || !candidate?.rollback) {
    warnings.push("candidate is missing hypothesis, expectedImpact, or rollback");
  }

  const failedPhases = devLoopResults.filter((phase) => phase.status === "fail" || phase.status === "blocked");
  for (const phase of failedPhases) {
    blockers.push(`dev-loop ${phase.phase} ended with ${phase.status}`);
  }

  return {
    version: VERSION,
    status: blockers.length ? "blocked" : warnings.length ? "residual-risk" : "pass",
    blockers,
    warnings,
    branch
  };
}
