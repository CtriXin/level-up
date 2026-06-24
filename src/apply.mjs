// DEPRECATED/FROZEN: level-up 执行环已废弃,改用 looper;勿新增依赖。见 docs/STATUS.md
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, VERSION, writeJson } from "./runtime.mjs";

const UNSAFE_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd\b/i,
  /\bgit\s+checkout\s+--\b/i,
  /\bchmod\s+777\b/i,
  /\bsudo\b/i,
  /\bdeploy\b/i,
  /\bforce-push\b/i,
  /\b--force\b/i
];

export function runApplyStep(options) {
  const runRoot = resolve(options.runRoot);
  const round = Number(options.round ?? 1);
  const experimentDir = join(runRoot, "experiments", `round-${String(round).padStart(3, "0")}`);
  ensureDir(experimentDir);

  const manifest = {
    version: VERSION,
    round,
    candidateId: options.candidate?.id ?? null,
    createdAt: new Date().toISOString(),
    mode: "none",
    status: "skipped",
    worktreePath: resolve(options.worktreePath),
    safety: {
      blocked: false,
      blockers: []
    },
    files: {
      manifest: join(experimentDir, "apply.json")
    }
  };

  const inputs = normalizeInputs(options);
  if (inputs.length === 0) {
    writeJson(manifest.files.manifest, manifest);
    return manifest;
  }
  if (inputs.length > 1) {
    return writeBlocked(manifest, ["only one apply mode may be used per experiment round"]);
  }

  const input = inputs[0];
  manifest.mode = input.mode;
  if (input.mode === "command") {
    return runCommandApply(manifest, input.command);
  }
  if (input.mode === "patch") {
    return runPatchApply(manifest, input.patchFile);
  }
  if (input.mode === "write-file") {
    return runWriteFileApply(manifest, input.targetFile, input.content);
  }

  return writeBlocked(manifest, [`unsupported apply mode: ${input.mode}`]);
}

function normalizeInputs(options) {
  const inputs = [];
  if (options.applyCommand) {
    inputs.push({ mode: "command", command: options.applyCommand });
  }
  if (options.applyPatch) {
    inputs.push({ mode: "patch", patchFile: options.applyPatch });
  }
  if (options.applyWriteFile) {
    inputs.push({
      mode: "write-file",
      targetFile: options.applyWriteFile,
      content: readApplyContent(options)
    });
  }
  return inputs;
}

function readApplyContent(options) {
  if (options.applyContent !== undefined && options.applyContent !== null) {
    return String(options.applyContent);
  }
  if (options.applyContentFile) {
    return readFileSync(resolve(options.applyContentFile), "utf8");
  }
  return null;
}

function runCommandApply(manifest, command) {
  const blockers = unsafeCommandBlockers(command);
  if (blockers.length) {
    return writeBlocked(manifest, blockers);
  }
  const result = spawnSync(command, {
    cwd: manifest.worktreePath,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const next = {
    ...manifest,
    command,
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
  writeJson(next.files.manifest, next);
  return next;
}

function runPatchApply(manifest, patchFileInput) {
  const patchFile = resolve(patchFileInput);
  if (!existsSync(patchFile)) {
    return writeBlocked(manifest, [`patch file does not exist: ${patchFile}`]);
  }
  const check = spawnSync("git", ["apply", "--check", patchFile], {
    cwd: manifest.worktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (check.status !== 0) {
    const next = {
      ...manifest,
      patchFile,
      status: "fail",
      exitCode: check.status ?? 1,
      stdout: check.stdout.trim(),
      stderr: check.stderr.trim()
    };
    writeJson(next.files.manifest, next);
    return next;
  }
  const apply = spawnSync("git", ["apply", patchFile], {
    cwd: manifest.worktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const next = {
    ...manifest,
    patchFile,
    status: apply.status === 0 ? "pass" : "fail",
    exitCode: apply.status ?? 1,
    stdout: apply.stdout.trim(),
    stderr: apply.stderr.trim()
  };
  writeJson(next.files.manifest, next);
  return next;
}

function runWriteFileApply(manifest, targetFileInput, content) {
  if (content === null) {
    return writeBlocked(manifest, ["write-file apply requires --apply-content or --apply-content-file"]);
  }
  const targetPath = safeWorktreePath(manifest.worktreePath, targetFileInput);
  if (!targetPath) {
    return writeBlocked(manifest, [`write target must stay inside worktree: ${targetFileInput}`]);
  }
  ensureDir(dirname(targetPath));
  writeFileSync(targetPath, content);
  const next = {
    ...manifest,
    targetFile: targetFileInput,
    targetPath,
    status: "pass",
    bytesWritten: Buffer.byteLength(content)
  };
  writeJson(next.files.manifest, next);
  return next;
}

function unsafeCommandBlockers(command) {
  return UNSAFE_COMMAND_PATTERNS
    .filter((pattern) => pattern.test(command))
    .map((pattern) => `unsafe apply command matched ${pattern}`);
}

function safeWorktreePath(worktreePath, targetFileInput) {
  if (isAbsolute(targetFileInput)) {
    return null;
  }
  const targetPath = resolve(worktreePath, targetFileInput);
  const rel = relative(worktreePath, targetPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return targetPath;
}

function writeBlocked(manifest, blockers) {
  const next = {
    ...manifest,
    status: "blocked",
    safety: {
      blocked: true,
      blockers
    }
  };
  writeJson(next.files.manifest, next);
  return next;
}
