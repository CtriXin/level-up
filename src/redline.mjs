import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";

export function runRedlineAudit(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const url = options.url || options.link || options.prLink || options.mrLink || "";
  const finalGate = Boolean(options.finalGate);
  const outputDir = options.outputDir ? resolve(options.outputDir) : join(runRoot, "redline");
  ensureDir(outputDir);

  const manifest = {
    version: VERSION,
    createdAt: new Date().toISOString(),
    status: "skipped",
    reason: "",
    runRoot,
    repo: goal.target.path,
    url,
    outputDir,
    finalGate,
    commentRequested: Boolean(options.comment),
    safety: {
      approve: false,
      merge: false,
      deploy: false,
      forcePush: false,
      commentRequiresExplicitFlag: true
    },
    files: {
      resultJson: join(outputDir, "audit-result.json"),
      resultMarkdown: join(outputDir, "audit-result.md"),
      manifest: join(outputDir, "manifest.json")
    }
  };

  if (!url) {
    manifest.reason = "missing_pr_or_mr_url";
    manifest.finalGateStatus = finalGate ? "blocked" : "skipped";
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  const command = resolveRedlineCommand(options);
  if (!command) {
    manifest.reason = "redline_guard_not_found";
    manifest.finalGateStatus = finalGate ? "blocked" : "skipped";
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  const auditArgs = [
    "audit",
    "--url", url,
    "--repo", goal.target.path,
    "--out", outputDir
  ];
  const evidence = options.evidence === false ? null : (options.evidence || runRoot);
  if (evidence) auditArgs.push("--evidence", evidence);
  if (options.diggerRun) auditArgs.push("--digger-run", options.diggerRun);
  if (options.llmAudit) auditArgs.push("--llm-audit", options.llmAudit);
  if (options.validate) auditArgs.push("--validate");
  if (options.notify) auditArgs.push("--notify");
  if (options.actions) auditArgs.push("--actions");
  if (options.comment) auditArgs.push("--comment");
  if (options.reportUrl) auditArgs.push("--report-url", options.reportUrl);
  if (options.webhookUrl) auditArgs.push("--webhook-url", options.webhookUrl);

  const args = [...command.args, ...auditArgs];
  const result = spawnSync(command.bin, args, {
    cwd: goal.target.path,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: Number(options.timeoutMs || 180000),
    env: { ...process.env, ...options.env }
  });

  manifest.command = [command.bin, ...args].join(" ");
  manifest.exitCode = result.status ?? 1;
  manifest.stdout = (result.stdout || "").trim().slice(-4000);
  manifest.stderr = (result.stderr || "").trim().slice(-4000);

  if (result.error) {
    manifest.status = command.optional && result.error.code === "ENOENT" ? "skipped" : "failed";
    manifest.reason = result.error.code || result.error.message;
    manifest.finalGateStatus = finalGate ? "blocked" : manifest.status;
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  if (result.status !== 0) {
    manifest.status = "failed";
    manifest.reason = "redline_guard_exit_nonzero";
    manifest.finalGateStatus = "blocked";
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  manifest.status = "pass";
  manifest.result = readOptionalJson(manifest.files.resultJson);
  manifest.decision = normalizeDecision(manifest.result);
  manifest.finalGateStatus = manifest.decision === "mergeable" ? "pass" : "blocked";
  writeJson(manifest.files.manifest, manifest);
  return manifest;
}

export function runRedlineFinalGate(runRootInput, options = {}) {
  return runRedlineAudit(runRootInput, {
    ...options,
    finalGate: true
  });
}

export function resolveRedlineCommand(options = {}) {
  if (options.bin) {
    return { bin: options.bin, args: options.commandArgs || [], optional: false };
  }

  const envBin = process.env.LEVEL_UP_REDLINE_BIN || process.env.REDLINE_GUARD_BIN;
  if (envBin) {
    return { bin: envBin, args: [], optional: false };
  }

  const siblingCli = resolve(dirname(fileURLToPath(import.meta.url)), "../../redline-guard/src/cli.mjs");
  if (existsSync(siblingCli)) {
    return { bin: process.execPath, args: [siblingCli], optional: false };
  }

  return { bin: "redline-guard", args: [], optional: true };
}

function readOptionalJson(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function normalizeDecision(result) {
  const value = result?.decision || result?.result?.decision || null;
  if (!value) return "unknown";
  const normalized = String(value).toLowerCase();
  return ["mergeable", "needs-review", "blocked", "unknown"].includes(normalized)
    ? normalized
    : "unknown";
}

export default runRedlineAudit;
