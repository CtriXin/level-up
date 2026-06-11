import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";

export function runRedlineAudit(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const goal = readJson(join(runRoot, "goal.json"));
  const url = options.url || options.link || options.prLink || options.mrLink || "";
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
    files: {
      resultJson: join(outputDir, "audit-result.json"),
      resultMarkdown: join(outputDir, "audit-result.md"),
      manifest: join(outputDir, "manifest.json")
    }
  };

  if (!url) {
    manifest.reason = "missing_pr_or_mr_url";
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  const command = resolveRedlineCommand(options);
  if (!command) {
    manifest.reason = "redline_guard_not_found";
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  const auditArgs = [
    "audit",
    "--url",
    url,
    "--repo",
    goal.target.path,
    "--out",
    outputDir
  ];
  if (options.validate) auditArgs.push("--validate");
  if (options.notify) auditArgs.push("--notify");
  if (options.actions) auditArgs.push("--actions");
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
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  if (result.status !== 0) {
    manifest.status = "failed";
    manifest.reason = "redline_guard_exit_nonzero";
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }

  manifest.status = "pass";
  manifest.result = readOptionalJson(manifest.files.resultJson);
  manifest.decision = manifest.result?.decision || null;
  writeJson(manifest.files.manifest, manifest);
  return manifest;
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
