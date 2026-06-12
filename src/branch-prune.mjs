import { runGit, VERSION } from "./runtime.mjs";

const PROTECTED_BRANCHES = new Set(["main", "master", "develop"]);

export function pruneMergedBranches(repoInput = ".", options = {}) {
  const repo = repoInput || ".";
  const baseRef = options.baseRef || "origin/main";
  const execute = Boolean(options.execute);
  const branchPrefix = options.branchPrefix ?? "codex/";
  const currentBranch = runGit(repo, ["branch", "--show-current"], { allowFailure: true }).stdout;
  const localBranches = listLocalBranches(repo);
  const branches = localBranches
    .filter((branch) => shouldReportBranch(branch, branchPrefix, currentBranch))
    .map((branch) => {
      const merged = isBranchMerged(repo, branch.name, baseRef);
      const protectedBranch = PROTECTED_BRANCHES.has(branch.name);
      const current = branch.name === currentBranch;
      const prefixMatch = branchPrefix ? branch.name.startsWith(branchPrefix) : true;
      const reasons = skipReasons({ merged, protectedBranch, current, prefixMatch, branchPrefix });
      const removable = Boolean(merged && !protectedBranch && !current && prefixMatch);
      const result = {
        name: branch.name,
        head: branch.head,
        upstream: branch.upstream || null,
        baseRef,
        branchPrefix,
        removable,
        deleted: false,
        reasons
      };

      if (execute && removable) {
        runGit(repo, ["branch", "-d", branch.name]);
        result.deleted = true;
      }

      return result;
    });

  return {
    version: VERSION,
    command: "prune-merged-branches",
    repo,
    baseRef,
    execute,
    branchPrefix,
    currentBranch,
    total: branches.length,
    removable: branches.filter((branch) => branch.removable).length,
    deleted: branches.filter((branch) => branch.deleted).length,
    skipped: branches.filter((branch) => !branch.removable).length,
    branches
  };
}

function listLocalBranches(repo) {
  return runGit(repo, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname:short)%09%(upstream:short)",
    "refs/heads"
  ]).stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream] = line.split("\t");
      return { name, head, upstream };
    });
}

function shouldReportBranch(branch, branchPrefix, currentBranch) {
  if (branch.name === currentBranch) return true;
  if (PROTECTED_BRANCHES.has(branch.name)) return true;
  return branchPrefix ? branch.name.startsWith(branchPrefix) : true;
}

function isBranchMerged(repo, branch, baseRef) {
  return runGit(repo, ["merge-base", "--is-ancestor", branch, baseRef], { allowFailure: true }).status === 0;
}

function skipReasons({ merged, protectedBranch, current, prefixMatch, branchPrefix }) {
  const reasons = [];
  if (!merged) reasons.push("branch is not merged into base ref");
  if (protectedBranch) reasons.push("protected branch");
  if (current) reasons.push("current branch");
  if (!prefixMatch) reasons.push(`branch prefix is not ${branchPrefix}`);
  return reasons;
}

export default pruneMergedBranches;
