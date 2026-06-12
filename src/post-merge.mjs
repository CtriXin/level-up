import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir, VERSION, writeJson } from "./runtime.mjs";
import { cleanupMergedWorktrees } from "./worktree-cleanup.mjs";

export function runPostMergeCleanup(options = {}) {
  const repo = options.repo || ".";
  const baseRef = options.baseRef || "origin/main";
  const execute = Boolean(options.execute);
  const deleteBranches = Boolean(options.deleteBranches);
  const outputDir = options.outputDir ? resolve(options.outputDir) : null;
  const cleanup = cleanupMergedWorktrees(repo, {
    baseRef,
    execute,
    deleteBranches
  });

  const manifest = {
    version: VERSION,
    command: "post-merge",
    createdAt: new Date().toISOString(),
    repo,
    baseRef,
    execute,
    deleteBranches,
    status: cleanup.removed || cleanup.branchDeleted ? "cleaned" : "checked",
    summary: {
      removed: cleanup.removed,
      branchDeleted: cleanup.branchDeleted,
      skipped: cleanup.skipped
    },
    cleanup,
    files: {}
  };

  if (outputDir) {
    ensureDir(outputDir);
    manifest.files.report = join(outputDir, "POST_MERGE_CLEANUP.zh.md");
    manifest.files.manifest = join(outputDir, "post-merge-cleanup.json");
    writeFileSync(manifest.files.report, renderPostMergeCleanup(manifest));
    writeJson(manifest.files.manifest, manifest);
  }

  return manifest;
}

export function renderPostMergeCleanup(manifest) {
  return `# Post-merge cleanup

- repo: \`${manifest.repo}\`
- baseRef: \`${manifest.baseRef}\`
- mode: ${manifest.execute ? "execute" : "dry-run"}
- deleteBranches: \`${manifest.deleteBranches}\`
- status: \`${manifest.status}\`
- removed: \`${manifest.summary.removed}\`
- branchDeleted: \`${manifest.summary.branchDeleted}\`
- skipped: \`${manifest.summary.skipped}\`

## Worktrees

${renderWorktrees(manifest.cleanup.worktrees)}

## Safety

- 只处理 HEAD 已合入 baseRef 的 worktree。
- 跳过当前 worktree、dirty worktree、protected branch、未合入 baseRef 的 worktree。
- 不会 merge、deploy、force-push、修改 global config 或访问 secret。
`;
}

function renderWorktrees(worktrees = []) {
  if (!worktrees.length) return "- 未发现 worktree。";

  return worktrees
    .map((entry) => {
      const status = entry.removed
        ? "removed"
        : entry.removable
          ? "removable"
          : "skipped";
      const branch = entry.branch || "detached";
      const reasons = entry.reasons?.length ? `；原因：${entry.reasons.join("、")}` : "";
      const branchStatus = entry.branchDeleted ? "；branch deleted" : "";
      return `- \`${branch}\` ${status}${branchStatus}${reasons}：\`${entry.worktree}\``;
    })
    .join("\n");
}

export default runPostMergeCleanup;
