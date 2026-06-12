import { realpathSync } from "node:fs";
import { runGit, VERSION } from "./runtime.mjs";

const PROTECTED_BRANCHES = new Set(["main", "master", "develop"]);

export function cleanupMergedWorktrees(repoInput = ".", options = {}) {
  const repo = repoInput || ".";
  const baseRef = options.baseRef || "origin/main";
  const execute = Boolean(options.execute);
  const deleteBranches = Boolean(options.deleteBranches);
  const entries = parseWorktreeList(runGit(repo, ["worktree", "list", "--porcelain"]).stdout);
  const currentTopLevel = safeRealpath(runGit(repo, ["rev-parse", "--show-toplevel"]).stdout);
  const results = [];

  for (const entry of entries) {
    const branchName = shortBranch(entry.branch);
    const status = runGit(entry.worktree, ["status", "--porcelain"], { allowFailure: true }).stdout;
    const ancestor = isAncestor(entry.worktree, entry.head, baseRef);
    const protectedBranch = PROTECTED_BRANCHES.has(branchName);
    const current = safeRealpath(entry.worktree) === currentTopLevel;
    const removable = Boolean(entry.head && ancestor && !status && !protectedBranch && !current);
    const reasons = skipReasons({ entry, status, ancestor, protectedBranch, current });
    const result = {
      worktree: entry.worktree,
      branch: branchName || null,
      head: entry.head?.slice(0, 12) ?? null,
      baseRef,
      removable,
      removed: false,
      branchDeleted: false,
      reasons
    };

    if (execute && removable) {
      runGit(repo, ["worktree", "remove", entry.worktree]);
      result.removed = true;
      if (deleteBranches && branchName) {
        const deletion = runGit(repo, ["branch", "-d", branchName], { allowFailure: true });
        result.branchDeleted = deletion.status === 0;
        if (deletion.status !== 0) {
          result.branchDeleteError = deletion.stderr || deletion.stdout || "branch delete failed";
        }
      }
    }
    results.push(result);
  }

  return {
    version: VERSION,
    execute,
    deleteBranches,
    baseRef,
    removed: results.filter((result) => result.removed).length,
    branchDeleted: results.filter((result) => result.branchDeleted).length,
    removable: results.filter((result) => result.removable).length,
    skipped: results.filter((result) => !result.removable).length,
    worktrees: results
  };
}

function parseWorktreeList(output) {
  return output
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const entry = {};
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        if (key === "worktree") entry.worktree = value;
        if (key === "HEAD") entry.head = value;
        if (key === "branch") entry.branch = value;
      }
      return entry;
    });
}

function shortBranch(ref) {
  return ref?.replace(/^refs\/heads\//, "") ?? null;
}

function isAncestor(worktree, head, baseRef) {
  if (!head) return false;
  return runGit(worktree, ["merge-base", "--is-ancestor", head, baseRef], { allowFailure: true }).status === 0;
}

function skipReasons({ entry, status, ancestor, protectedBranch, current }) {
  const reasons = [];
  if (!entry.head) reasons.push("missing HEAD");
  if (!ancestor) reasons.push("HEAD is not merged into base ref");
  if (status) reasons.push("worktree is dirty");
  if (protectedBranch) reasons.push("protected branch");
  if (current) reasons.push("current worktree");
  return reasons;
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
