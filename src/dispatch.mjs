/**
 * dispatch.mjs — dispatch bridge: state-core auto-research tasks → GitHub issues.
 *
 * Reads state-core intake tasks (auto-research-* phase=intake), opens GitHub
 * issues via `gh`, and advances the task phase to "scoped" (marking dispatched).
 *
 * Constraints:
 * - May import util.mjs only from this project.
 * - Does NOT import flywheel / looper / state-core.mjs or any execution-environment
 *   module (autopilot, strategy, evaluator, apply, runner, etc.).
 * - Calls state-core CLI via spawnSync only.
 * - Calls `gh` CLI via spawnSync only.
 * - dryRun=true: collects plans, no real issue creation, no state-core writes.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const TASK_MARKER_PREFIX = "machine-intake-task-id:";

// ---------------------------------------------------------------------------
// State-core CLI helpers
// ---------------------------------------------------------------------------

/**
 * Run state-core CLI. Returns stdout string on success.
 * Throws on non-zero exit.
 *
 * @param {string}   stateCoreDir  Path to state-core repo root (contains src/cli.py).
 * @param {string[]} cliArgs       Arguments after "python3 src/cli.py".
 * @param {Function} spawnCommand  spawnSync-compatible command runner.
 * @returns {string}
 */
function runStateCoreCliArgs(stateCoreDir, cliArgs, spawnCommand = spawnSync) {
  const result = spawnCommand("python3", ["src/cli.py", ...cliArgs], {
    cwd: stateCoreDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      `state-core CLI failed (exit ${result.status}): ${stderr || "(no stderr)"}`
    );
  }
  return result.stdout ?? "";
}

// ---------------------------------------------------------------------------
// Task enumeration
// ---------------------------------------------------------------------------

/**
 * Enumerate tasks by scanning <dataRoot>/.state/ subdirectories.
 * state-core has no "list" command, so we scan the filesystem directly.
 *
 * @param {string} dataRoot  state-core data root passed as --root.
 * @returns {string[]}  Array of task IDs found.
 */
function enumerateTaskIds(dataRoot) {
  const stateDir = join(dataRoot, ".state");
  if (!existsSync(stateDir)) return [];

  const entries = readdirSync(stateDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * Read a task-state.json directly from disk (fast path, no CLI needed for filter).
 *
 * @param {string} dataRoot
 * @param {string} taskId
 * @returns {object|null}  Parsed JSON or null if not found/parseable.
 */
function readTaskStateFile(dataRoot, taskId) {
  const path = join(dataRoot, ".state", taskId, "task-state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Packet reading
// ---------------------------------------------------------------------------

/**
 * Read a packet.json from the ledger_ref path.
 *
 * @param {string} ledgerRef  Absolute path to packet.json.
 * @returns {object|null}
 */
function readPacket(ledgerRef) {
  if (!ledgerRef || !existsSync(ledgerRef)) return null;
  try {
    return JSON.parse(readFileSync(ledgerRef, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitHub repo inference
// ---------------------------------------------------------------------------

/**
 * Parse a git remote URL into "owner/repo" form.
 * Supports:
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *
 * Returns null when the URL is not a GitHub remote.
 *
 * @param {string} remoteUrl
 * @returns {string|null}
 */
function parseGitHubOwnerRepo(remoteUrl) {
  if (!remoteUrl) return null;

  // SSH form: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS form: https://github.com/owner/repo[.git]
  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

/**
 * Infer the GitHub "owner/repo" from the git remote of the directory at
 * packet.scope.path.
 *
 * @param {string} scopePath      Directory containing the target git repo.
 * @param {Function} spawnCommand spawnSync-compatible command runner.
 * @returns {{ ownerRepo: string|null, skipReason: string|null }}
 */
function inferGitHubRepo(scopePath, spawnCommand = spawnSync) {
  if (!scopePath) {
    return { ownerRepo: null, skipReason: "packet.scope.path is missing or empty" };
  }

  const resolved = resolve(scopePath);
  if (!existsSync(resolved)) {
    return { ownerRepo: null, skipReason: `scope path does not exist: ${resolved}` };
  }

  const result = spawnCommand("git", ["remote", "get-url", "origin"], {
    cwd: resolved,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    return {
      ownerRepo: null,
      skipReason: `git remote get-url origin failed (exit ${result.status}): ${(result.stderr ?? "").trim() || "(no stderr)"}`
    };
  }

  const remoteUrl = (result.stdout ?? "").trim();
  const ownerRepo = parseGitHubOwnerRepo(remoteUrl);

  if (!ownerRepo) {
    return {
      ownerRepo: null,
      skipReason: `remote URL is not a GitHub URL: ${remoteUrl}`
    };
  }

  return { ownerRepo, skipReason: null };
}

// ---------------------------------------------------------------------------
// Issue body assembly
// ---------------------------------------------------------------------------

function buildTaskMarker(taskId) {
  return `${TASK_MARKER_PREFIX} ${taskId}`;
}

/**
 * Build a GitHub issue body from a packet.
 *
 * @param {object} packet   Outpact packet (full structure from packet.json).
 * @param {string} taskId   state-core task ID.
 * @returns {string}
 */
function buildIssueBody(packet, taskId) {
  const candidateId = packet?.meta?.candidate_id ?? taskId;
  const hypothesis = packet?.action_spec?.hypothesis ?? "(no hypothesis provided)";
  const expectedImpact = packet?.action_spec?.expected_impact ?? "(no expected impact provided)";
  const acceptance = packet?.acceptance ?? packet?.action_spec?.acceptance ?? "(no acceptance criteria provided)";
  const rollback = packet?.constraints?.rollback_plan ?? packet?.meta?.rollback ?? "(no rollback information provided)";
  const workType = packet?.work_type ?? "(unknown work type)";
  const scopePath = packet?.scope?.path ?? "(unknown path)";

  return [
    "<!-- 由 machine-intake dispatch bridge 自动开 -->",
    buildTaskMarker(taskId),
    "",
    `**来源**: auto-research / candidate_id: \`${candidateId}\``,
    `**state-core task**: \`${taskId}\``,
    `**work_type**: ${workType}`,
    `**scope**: ${scopePath}`,
    "",
    "## Hypothesis",
    "",
    hypothesis,
    "",
    "## Expected Impact",
    "",
    expectedImpact,
    "",
    "## Acceptance Criteria",
    "",
    typeof acceptance === "string"
      ? acceptance
      : JSON.stringify(acceptance, null, 2),
    "",
    "## Rollback",
    "",
    typeof rollback === "string"
      ? rollback
      : JSON.stringify(rollback, null, 2),
    "",
    "---",
    "_Auto-opened by level-up dispatch bridge. Assigned to looper for execution._"
  ].join("\n");
}

// ---------------------------------------------------------------------------
// GitHub issue idempotency
// ---------------------------------------------------------------------------

function describeSpawnFailure(result) {
  const stderr = (result.stderr ?? "").trim();
  const status = result.status ?? "unknown";
  const error = result.error?.message ? ` (${result.error.message})` : "";
  return `exit ${status}${error}: ${stderr || "(no stderr)"}`;
}

function findExistingIssueUrl(ownerRepo, taskId, spawnCommand = spawnSync) {
  let ghResult;
  try {
    ghResult = spawnCommand(
      "gh",
      [
        "issue", "list",
        "-R", ownerRepo,
        "--state", "all",
        "--search", `${taskId} in:body`,
        "--json", "url",
        "--jq", ".[0].url // \"\""
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    return { ok: false, issueUrl: null, error: `gh issue list threw: ${err.message}` };
  }

  if (ghResult.status !== 0) {
    return {
      ok: false,
      issueUrl: null,
      error: `gh issue list failed (${describeSpawnFailure(ghResult)})`
    };
  }

  const issueUrl = (ghResult.stdout ?? "").trim();
  return { ok: true, issueUrl: issueUrl || null, error: null };
}

function createIssue({ ownerRepo, label, issueTitle, issueBody, spawnCommand = spawnSync }) {
  let ghResult;
  try {
    ghResult = spawnCommand(
      "gh",
      [
        "issue", "create",
        "--repo", ownerRepo,
        "--label", label,
        "--title", issueTitle,
        "--body", issueBody
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    return { ok: false, issueUrl: null, error: `gh issue create threw: ${err.message}` };
  }

  if (ghResult.status !== 0) {
    return {
      ok: false,
      issueUrl: null,
      error: `gh issue create failed (${describeSpawnFailure(ghResult)})`
    };
  }

  return { ok: true, issueUrl: (ghResult.stdout ?? "").trim(), error: null };
}

function writeDispatchState({ stateCoreDir, dataRoot, taskId, issueUrl, spawnCommand = spawnSync }) {
  runStateCoreCliArgs(stateCoreDir, [
    "set",
    "--task-id", taskId,
    "--root", dataRoot,
    "--next-action", `dispatched: ${issueUrl}`
  ], spawnCommand);

  const latestState = readTaskStateFile(dataRoot, taskId);
  if (latestState?.phase === "scoped") {
    return;
  }

  runStateCoreCliArgs(stateCoreDir, [
    "advance",
    "--task-id", taskId,
    "--phase", "scoped",
    "--root", dataRoot
  ], spawnCommand);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch bridge: enumerate state-core intake tasks → open GitHub issues →
 * advance tasks to "scoped".
 *
 * @param {object}  params
 * @param {string}  params.stateCoreDir   Absolute path to state-core repo root (cwd for cli.py).
 * @param {string}  params.dataRoot       state-core data root (--root for cli.py).
 * @param {string}  [params.label="AI-P3"] GitHub issue label to apply.
 * @param {boolean} [params.dryRun=false] When true, only collect plans; do not open
 *                                         issues or advance phase.
 * @param {Function} [params.spawnCommand] spawnSync-compatible runner for tests.
 * @returns {Array<{
 *   taskId: string,
 *   repo: string|null,
 *   issueTitle: string|null,
 *   label: string,
 *   issueUrl: string|null,
 *   dispatched: boolean,
 *   skippedReason: string|null,
 *   dryRunPlan: object|null
 * }>}
 */
export function runDispatch({ stateCoreDir, dataRoot, label = "AI-P3", dryRun = false, spawnCommand = spawnSync }) {
  if (!stateCoreDir || typeof stateCoreDir !== "string") {
    throw new Error("runDispatch: stateCoreDir (string) is required");
  }
  if (!dataRoot || typeof dataRoot !== "string") {
    throw new Error("runDispatch: dataRoot (string) is required");
  }

  const resolvedStateCoreDir = resolve(stateCoreDir);
  const resolvedDataRoot = resolve(dataRoot);

  // Step a: enumerate all tasks
  const taskIds = enumerateTaskIds(resolvedDataRoot);

  const results = [];

  for (const taskId of taskIds) {
    // Step b: filter — must start with "auto-research-" AND phase === "intake"
    if (!taskId.startsWith("auto-research-")) {
      continue; // skip non-auto-research tasks silently
    }

    const taskState = readTaskStateFile(resolvedDataRoot, taskId);
    if (!taskState) {
      results.push({
        taskId,
        repo: null,
        issueTitle: null,
        label,
        issueUrl: null,
        dispatched: false,
        skippedReason: "could not read task-state.json",
        dryRunPlan: null
      });
      continue;
    }

    if (taskState.phase !== "intake") {
      // Already dispatched or in another phase — skip silently (de-dup mechanism)
      continue;
    }

    // Step c: process each matched task
    const ledgerRef = taskState.ledger_ref;
    const packet = readPacket(ledgerRef);

    if (!packet) {
      results.push({
        taskId,
        repo: null,
        issueTitle: null,
        label,
        issueUrl: null,
        dispatched: false,
        skippedReason: `could not read packet.json at ledger_ref: ${ledgerRef ?? "(missing)"}`,
        dryRunPlan: null
      });
      continue;
    }

    // Infer GitHub repo from scope.path
    const { ownerRepo, skipReason } = inferGitHubRepo(packet?.scope?.path, spawnCommand);

    if (skipReason) {
      results.push({
        taskId,
        repo: null,
        issueTitle: null,
        label,
        issueUrl: null,
        dispatched: false,
        skippedReason: skipReason,
        dryRunPlan: null
      });
      continue;
    }

    // Assemble issue title
    const issueTitle =
      packet?.action_spec?.summary ||
      taskState?.intent?.goal ||
      taskState?.intent?.raw ||
      taskId;

    // Assemble issue body
    const issueBody = buildIssueBody(packet, taskId);

    if (dryRun) {
      results.push({
        taskId,
        repo: ownerRepo,
        issueTitle,
        label,
        issueUrl: null,
        dispatched: false,
        skippedReason: null,
        dryRunPlan: {
          searchCommand: `gh issue list -R ${ownerRepo} --state all --search ${JSON.stringify(`${taskId} in:body`)}`,
          ghCommand: `gh issue create --repo ${ownerRepo} --label ${label} --title ${JSON.stringify(issueTitle)} --body "(body omitted)"`,
          issueBody,
          setNextAction: `python3 src/cli.py set --task-id ${taskId} --next-action "dispatched: <issue-url>" --root ${resolvedDataRoot}`,
          advanceCommand: `python3 src/cli.py advance --task-id ${taskId} --phase scoped --root ${resolvedDataRoot}`
        }
      });
      continue;
    }

    // dryRun=false: search first, then create only when no prior issue carries this task id.
    const existingIssue = findExistingIssueUrl(ownerRepo, taskId, spawnCommand);
    if (!existingIssue.ok) {
      results.push({
        taskId,
        repo: ownerRepo,
        issueTitle,
        label,
        issueUrl: null,
        dispatched: false,
        skippedReason: existingIssue.error,
        dryRunPlan: null
      });
      continue;
    }

    let issueUrl = existingIssue.issueUrl;
    if (!issueUrl) {
      const createdIssue = createIssue({
        ownerRepo,
        label,
        issueTitle,
        issueBody,
        spawnCommand
      });

      if (!createdIssue.ok) {
        results.push({
          taskId,
          repo: ownerRepo,
          issueTitle,
          label,
          issueUrl: null,
          dispatched: false,
          skippedReason: createdIssue.error,
          dryRunPlan: null
        });
        continue;
      }

      issueUrl = createdIssue.issueUrl;
    }

    // Write back to state-core: set next-action + advance to scoped
    try {
      writeDispatchState({
        stateCoreDir: resolvedStateCoreDir,
        dataRoot: resolvedDataRoot,
        taskId,
        issueUrl,
        spawnCommand
      });
    } catch (err) {
      // Issue is already opened or found — record partial success with a warning.
      results.push({
        taskId,
        repo: ownerRepo,
        issueTitle,
        label,
        issueUrl,
        dispatched: false,
        skippedReason: `issue available (${issueUrl}) but state-core write-back failed: ${err.message}`,
        dryRunPlan: null
      });
      continue;
    }

    results.push({
      taskId,
      repo: ownerRepo,
      issueTitle,
      label,
      issueUrl,
      dispatched: true,
      skippedReason: null,
      dryRunPlan: null
    });
  }

  return results;
}
