import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";

const RUNNER_TYPES = new Set(["current-session", "opencode-profile", "mms-runner", "external-command"]);

export function generateRunnerPacket(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const state = readJson(join(runRoot, "state.json"));
  const ideas = readOptionalJson(join(runRoot, "ideas.json"));
  const workPack = readOptionalJson(join(runRoot, "work-pack", "manifest.json"));
  const candidate = selectCandidate(ideas?.candidates, options.candidate);
  const createdAt = new Date().toISOString();
  const runnerType = normalizeRunner(options.runner);
  const profile = options.profile || defaultProfile(runnerType);
  const outputDir = join(runRoot, "runner");
  ensureDir(outputDir);

  const manifest = {
    version: VERSION,
    runId: goal.runId,
    createdAt,
    runner: {
      type: runnerType,
      profile,
      mode: runnerMode(runnerType),
      sessionId: process.env.CODEX_THREAD_ID || null
    },
    target: goal.target,
    objective: goal.objective,
    metric: goal.primaryMetric,
    candidate: candidate ? minimalCandidate(candidate) : null,
    worktreePath: options.worktreePath || state.worktreePath || null,
    skills: normalizeList(options.skills),
    mcp: normalizeList(options.mcp),
    tools: normalizeList(options.tools),
    files: {
      packet: join(outputDir, "RUNNER_PACKET.md"),
      manifest: join(outputDir, "manifest.json")
    },
    references: {
      goal: join(runRoot, "goal.json"),
      workPack: workPack?.files ?? null,
      ideas: join(runRoot, "ideas.json")
    },
    safety: {
      hardGates: goal.humanGates,
      forbiddenActions: goal.forbiddenActions,
      note: "Runner may mutate only the experiment worktree. Merge, deploy, production data, secrets, and global config require human approval."
    }
  };

  writeJson(manifest.files.manifest, manifest);
  writeFileSync(manifest.files.packet, renderRunnerPacket(manifest));
  return manifest;
}

function normalizeRunner(runner) {
  const value = runner || "current-session";
  if (!RUNNER_TYPES.has(value)) {
    throw new Error(`Unsupported runner: ${value}. Expected one of: ${[...RUNNER_TYPES].join(", ")}`);
  }
  return value;
}

function defaultProfile(runnerType) {
  if (runnerType === "opencode-profile") return "level-up";
  if (runnerType === "mms-runner") return "default";
  if (runnerType === "external-command") return "custom";
  return "codex-session";
}

function runnerMode(runnerType) {
  if (runnerType === "current-session") return "human-visible-agent-session";
  if (runnerType === "opencode-profile") return "cli-model-process";
  if (runnerType === "mms-runner") return "mms-profile";
  return "external-command";
}

function selectCandidate(candidates, requestedId) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  if (requestedId) {
    return candidates.find((candidate) => candidate.id === requestedId) || null;
  }
  return (
    candidates.find((candidate) => candidate.id.startsWith("metric-"))
    || candidates.find((candidate) => candidate.id === "guardrail-hardening")
    || candidates[0]
  );
}

function minimalCandidate(candidate) {
  return {
    id: candidate.id,
    title: candidate.title,
    hypothesis: candidate.hypothesis,
    expectedImpact: candidate.expectedImpact,
    risk: candidate.risk,
    rollback: candidate.rollback,
    validation: candidate.validation
  };
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(normalizeList);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderRunnerPacket(manifest) {
  const candidate = manifest.candidate;
  return `# level-up Runner Packet

## Runner

- type: \`${manifest.runner.type}\`
- profile: \`${manifest.runner.profile}\`
- mode: \`${manifest.runner.mode}\`
- session: \`${manifest.runner.sessionId || "unknown"}\`

## Goal

${manifest.objective}

## Metric

- name: \`${manifest.metric.name}\`
- direction: \`${manifest.metric.direction}\`
- description: ${manifest.metric.description}

## Candidate

${candidate ? `- id: \`${candidate.id}\`
- title: ${candidate.title}
- hypothesis: ${candidate.hypothesis}
- expected impact: ${candidate.expectedImpact}
- risk: ${candidate.risk}
- rollback: ${candidate.rollback}` : "_No candidate selected yet. Generate ideas before mutation._"}

## Worktree

\`${manifest.worktreePath || "not created yet"}\`

## Tool Context

- skills: ${manifest.skills.length ? manifest.skills.map((item) => `\`${item}\``).join(", ") : "_session decides_"}
- mcp: ${manifest.mcp.length ? manifest.mcp.map((item) => `\`${item}\``).join(", ") : "_session decides_"}
- tools: ${manifest.tools.length ? manifest.tools.map((item) => `\`${item}\``).join(", ") : "_session decides_"}

## Instructions

1. Work only inside the experiment worktree.
2. Make the smallest useful experiment for the selected candidate.
3. Do not merge, deploy, force-push, change global config, access secrets, or mutate production data.
4. After mutation, let \`level-up run\` or \`level-up dev-loop\` execute validation and self-review.
5. If the runner cannot safely act, leave the worktree unchanged and report a blocker.

## References

- goal: \`${manifest.references.goal}\`
- ideas: \`${manifest.references.ideas}\`
- work-pack: ${manifest.references.workPack ? Object.values(manifest.references.workPack).map((file) => `\`${file}\``).join(", ") : "_not generated_"}
`;
}

function readOptionalJson(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}
