import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir, readJson, VERSION, writeJson } from "./runtime.mjs";

export function generateRunReport(runRootInput, options = {}) {
  const runRoot = resolve(runRootInput);
  const format = options.format || "zh";
  if (format !== "zh") {
    throw new Error(`Unsupported report format: ${format}`);
  }

  const artifacts = loadArtifacts(runRoot);
  const createdAt = new Date().toISOString();
  const outputDir = options.outputDir ? resolve(options.outputDir) : runRoot;
  ensureDir(outputDir);

  const manifest = {
    version: VERSION,
    runId: artifacts.goal.runId,
    createdAt,
    format,
    runRoot,
    links: normalizeLinks(options),
    notifyStatus: options.notifyStatus || "未记录",
    files: {
      report: join(outputDir, "REPORT.zh.md"),
      manifest: join(outputDir, "report.manifest.json")
    }
  };

  writeFileSync(manifest.files.report, renderZhReport({ ...artifacts, manifest }));
  writeJson(manifest.files.manifest, manifest);
  return manifest;
}

function loadArtifacts(runRoot) {
  const goal = readJson(join(runRoot, "goal.json"));
  const state = readJson(join(runRoot, "state.json"));
  return {
    runRoot,
    goal,
    state,
    scan: readOptionalJson(join(runRoot, "scan.json")),
    ideas: readOptionalJson(join(runRoot, "ideas.json")),
    workPack: readOptionalJson(join(runRoot, "work-pack", "manifest.json")),
    runner: readOptionalJson(join(runRoot, "runner", "manifest.json")),
    autopilotSummary: readOptionalJson(join(runRoot, "autopilot-summary.json")),
    prPack: readOptionalJson(join(runRoot, "pr", "manifest.json")),
    redline: readOptionalJson(join(runRoot, "redline", "manifest.json")),
    postMerge: readOptionalJson(join(runRoot, "post-merge-cleanup.json")),
    devLoops: ["baseline", "experiment", "final"]
      .map((phase) => readOptionalJson(join(runRoot, `dev-loop-${phase}.json`)))
      .filter(Boolean),
    ledger: readLedger(join(runRoot, "ledger.tsv"))
  };
}

function readOptionalJson(path) {
  return existsSync(path) ? readJson(path) : null;
}

function readLedger(path) {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) {
    return [];
  }
  const [headerLine, ...lines] = text.split("\n");
  const headers = headerLine.split("\t");
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

function normalizeLinks(options) {
  return {
    pr: options.prLink || options.link || null,
    mr: options.mrLink || null
  };
}

function renderZhReport({ runRoot, goal, state, scan, ideas, workPack, runner, autopilotSummary, prPack, redline, postMerge, devLoops, ledger, manifest }) {
  const kept = ledger.filter((entry) => entry.status === "keep");
  const discarded = ledger.filter((entry) => entry.status === "discard");
  const crashed = ledger.filter((entry) => entry.status === "crash");
  const candidates = ideas?.candidates ?? [];
  const rounds = autopilotSummary?.rounds ?? [];

  return `# level-up 运行报告

- Run: \`${goal.runId}\`
- 目标项目: \`${goal.target.path}\`
- 状态: \`${state.status}\`
- 生成时间: ${manifest.createdAt}
- 报告文件: \`${manifest.files.report}\`

## 做了什么

${renderDone({ scan, workPack, runner, prPack, rounds, candidates })}

## 为什么做

- 用户目标: ${goal.objective}
- 主指标: \`${goal.primaryMetric.name}\`
- 方向: \`${goal.primaryMetric.direction}\`
- 指标说明: ${goal.primaryMetric.description}
- L3 边界: 只在本地 worktree 做实验，自动 keep/discard/crash，merge/deploy/生产数据变更仍需要人工确认。

## 实验结果

- keep: ${kept.length}
- discard: ${discarded.length}
- crash: ${crashed.length}

${renderLedger(ledger)}

## 指标变化

${renderMetricSummary(ledger)}

## 验证结果

${renderValidation(devLoops, scan)}

## PR / MR

${renderLinks(manifest.links, prPack)}

## Redline Guard 预审

${renderRedline(redline)}

## Feishu 通知

${manifest.notifyStatus}

## Post-merge cleanup

${renderPostMerge(postMerge)}

## 关键产物

${renderArtifacts({ runRoot, workPack, runner, prPack, redline, postMerge })}

## 下一步

${renderNextStep({ kept, discarded, crashed, state, manifest })}
`;
}

function renderDone({ scan, workPack, runner, prPack, rounds, candidates }) {
  const lines = [];
  if (scan) {
    lines.push(`- 已扫描项目结构，识别 package manager: \`${scan.package?.packageManager ?? "unknown"}\`，frameworks: \`${(scan.package?.frameworks ?? []).join(", ") || "unknown"}\`。`);
  }
  if (candidates.length) {
    lines.push(`- 已生成 ${candidates.length} 个候选实验，用于从不同方向尝试目标。`);
  }
  if (workPack) {
    lines.push("- 已生成 work-pack，把目标、非目标、验证和回滚写成可审查材料。");
  }
  if (runner) {
    lines.push(`- 已生成 runner packet，runner: \`${runner.runner.type}\` / \`${runner.runner.profile}\`。`);
  }
  if (rounds.length) {
    lines.push(`- 已执行 ${rounds.length} 轮 L3 loop，并记录 keep/discard 决策。`);
  }
  if (prPack) {
    lines.push("- 已生成 PR packet、bug-review request 和 visual evidence checklist。");
  }
  return lines.length ? lines.join("\n") : "- 暂无可汇总产物；请先运行 scan / ideas / work-pack / run。";
}

function renderLedger(ledger) {
  if (!ledger.length) {
    return "_还没有 ledger 记录。_";
  }
  return ledger
    .map((entry) => `- round ${entry.round}: \`${entry.status}\`, score \`${entry.score || "n/a"}\`, commit \`${entry.commit || "0000000"}\` - ${entry.description}`)
    .join("\n");
}

function renderMetricSummary(ledger) {
  const scored = ledger
    .map((entry) => Number(entry.score))
    .filter((score) => Number.isFinite(score));
  if (!scored.length) {
    return "- 暂无可比较的数值指标；当前只能根据验证结果和 keep/discard ledger 判断。";
  }
  const first = scored[0];
  const latest = scored.at(-1);
  const best = Math.max(...scored);
  return [
    `- 首次 score: \`${first}\``,
    `- 最新 score: \`${latest}\``,
    `- 最佳 score: \`${best}\``,
    "- 注意：这里汇总的是 level-up ledger score；真实业务指标仍应以项目自己的 benchmark、Lighthouse、bundle analyzer 或测试报告为准。"
  ].join("\n");
}

function renderValidation(devLoops, scan) {
  if (devLoops.length) {
    return devLoops
      .map((loop) => {
        const commands = loop.commands?.length
          ? loop.commands.map((command) => `  - \`${command.command}\`: ${command.status ?? "planned"}`).join("\n")
          : "  - 未检测到命令";
        return `- ${loop.phase}: \`${loop.status}\` (${loop.executed ? "executed" : "planned"})\n${commands}`;
      })
      .join("\n");
  }
  const suggested = scan?.suggestedValidation ?? [];
  if (!suggested.length) {
    return "- 未检测到 validation command；merge 前必须补验证。";
  }
  return suggested.map((command) => `- 待验证: \`${command}\``).join("\n");
}

function renderLinks(links, prPack) {
  const lines = [];
  if (links.pr) {
    lines.push(`- PR: ${links.pr}`);
  }
  if (links.mr) {
    lines.push(`- MR: ${links.mr}`);
  }
  if (prPack?.files?.prBody) {
    lines.push(`- PR body: \`${prPack.files.prBody}\``);
  }
  return lines.length ? lines.join("\n") : "- 暂无 PR/MR 链接。";
}

function renderRedline(redline) {
  if (!redline) {
    return "- 未运行 redline-guard；可在生成 PR/MR 后执行 `level-up redline` 或 `level-up report --redline`。";
  }
  const lines = [
    `- status: \`${redline.status}\``,
    `- url: ${redline.url || "未记录"}`
  ];
  if (redline.decision) {
    lines.push(`- decision: \`${redline.decision}\``);
  }
  if (redline.reason) {
    lines.push(`- reason: \`${redline.reason}\``);
  }
  if (redline.files?.resultMarkdown) {
    lines.push(`- report: \`${redline.files.resultMarkdown}\``);
  }
  return lines.join("\n");
}

function renderPostMerge(postMerge) {
  if (!postMerge) return "- 未运行 post-merge cleanup；PR/MR merge 后可执行 `level-up post-merge`。";

  return [
    `- status: \`${postMerge.status}\``,
    `- repo: \`${postMerge.repo}\``,
    `- baseRef: \`${postMerge.baseRef}\``,
    `- removed: \`${postMerge.summary?.removed ?? 0}\``,
    `- branchDeleted: \`${postMerge.summary?.branchDeleted ?? 0}\``,
    `- branchPruned: \`${postMerge.summary?.branchPruned ?? 0}\``,
    `- skipped: \`${postMerge.summary?.skipped ?? 0}\``
  ].join("\n");
}

function renderArtifacts({ runRoot, workPack, runner, prPack, redline, postMerge }) {
  const lines = [`- run root: \`${runRoot}\``];
  if (workPack?.files?.spec) {
    lines.push(`- spec: \`${workPack.files.spec}\``);
  }
  if (workPack?.files?.todo) {
    lines.push(`- todo: \`${workPack.files.todo}\``);
  }
  if (runner?.files?.packet) {
    lines.push(`- runner packet: \`${runner.files.packet}\``);
  }
  if (prPack?.files?.visualEvidence) {
    lines.push(`- visual evidence: \`${prPack.files.visualEvidence}\``);
  }
  if (redline?.files?.manifest) {
    lines.push(`- redline manifest: \`${redline.files.manifest}\``);
  }
  if (postMerge?.files?.report) {
    lines.push(`- post-merge cleanup: \`${postMerge.files.report}\``);
  }
  return lines.join("\n");
}

function renderNextStep({ kept, discarded, crashed, state, manifest }) {
  if (kept.length) {
    return [
      "- 人工 review diff 和验证证据。",
      "- 如果改动涉及 UI，补齐截图和标注。",
      `- 确认 ${manifest.links.pr || manifest.links.mr ? "PR/MR" : "后续 PR/MR"} 可合并后再 merge；不要让 level-up 自行 merge。`
    ].join("\n");
  }
  if (crashed.length) {
    return "- 先查看 crash 轮次的 result / stderr，缩小实验范围后重跑。";
  }
  if (discarded.length || state.status === "stopped") {
    return "- 本轮没有保留实验；建议换一个 candidate、补更明确的 benchmark，或降低一次实验的变更面后重跑。";
  }
  return "- 继续运行 L3 loop，或先补齐缺失的 scan / ideas / validation。";
}
