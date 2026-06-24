// 独立机器 intake 源:不依赖 level-up 执行环,可被外部复用;入口见 machine-intake.mjs
/**
 * util.mjs — pure utilities shared by runtime.mjs and auto-research.mjs.
 *
 * This module MUST NOT import state-core.mjs or any execution-environment module
 * (autopilot, strategy, evaluator, apply). It is intentionally kept dependency-free
 * so that pure-function callers (e.g. generateCandidates) can import it without
 * pulling in state-core side effects.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const VERSION = "0.1.0";

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "goal";
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function runGit(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr.trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

export function assertGitRepo(target) {
  const result = runGit(target, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`Target is not a git repository: ${target}`);
  }
  return realpathSync(result.stdout);
}

export function getGitHead(target) {
  return runGit(target, ["rev-parse", "--short=12", "HEAD"]).stdout;
}

export function getGitStatus(target) {
  return runGit(target, ["status", "--porcelain"], { allowFailure: true }).stdout;
}

export function suggestValidationCommands(packageManager, scripts) {
  const runner = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm run";
  const commands = [];
  for (const name of ["check", "lint", "test", "build"]) {
    if (scripts[name]) {
      commands.push(runner === "npm run" ? `npm run ${name}` : `${runner} ${name}`);
    }
  }
  return commands;
}

export function scanTarget(targetInput, runRoot) {
  const target = assertGitRepo(resolve(targetInput));
  const files = {
    packageJson: join(target, "package.json"),
    pnpmLock: join(target, "pnpm-lock.yaml"),
    yarnLock: join(target, "yarn.lock"),
    packageLock: join(target, "package-lock.json"),
    nuxtConfig: join(target, "nuxt.config.ts"),
    viteConfig: join(target, "vite.config.js")
  };
  const packageJson = existsSync(files.packageJson) ? readJson(files.packageJson) : null;
  const scripts = packageJson?.scripts ?? {};
  const packageManager = existsSync(files.pnpmLock)
    ? "pnpm"
    : existsSync(files.yarnLock)
      ? "yarn"
      : existsSync(files.packageLock)
        ? "npm"
        : "unknown";
  const frameworks = [];
  if (existsSync(files.nuxtConfig) || packageJson?.dependencies?.nuxt || packageJson?.devDependencies?.nuxt) {
    frameworks.push("nuxt");
  }
  if (existsSync(files.viteConfig) || packageJson?.dependencies?.vite || packageJson?.devDependencies?.vite) {
    frameworks.push("vite");
  }
  if (packageJson?.dependencies?.vue || packageJson?.devDependencies?.vue) {
    frameworks.push("vue");
  }
  if (packageJson?.dependencies?.react || packageJson?.devDependencies?.react) {
    frameworks.push("react");
  }

  const scan = {
    version: VERSION,
    target,
    scannedAt: nowIso(),
    git: {
      head: getGitHead(target),
      dirty: getGitStatus(target).length > 0
    },
    package: packageJson
      ? {
          name: packageJson.name ?? null,
          packageManager,
          scripts,
          frameworks: [...new Set(frameworks)]
        }
      : null,
    suggestedValidation: suggestValidationCommands(packageManager, scripts)
  };

  if (runRoot) {
    writeJson(join(resolve(runRoot), "scan.json"), scan);
  }
  return scan;
}
