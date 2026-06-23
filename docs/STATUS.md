# level-up 模块状态

> 本文件由 step B 收口写入。如有变化请更新此处。

## 概述

level-up 当前由两层组成:

1. **冻结的执行环(Frozen Execution Environment)**:autopilot / strategy / evaluator 等调度链模块。与 looper 执行环功能重复,牌面决策已选择保留 looper;这部分模块**冻结废弃**,保留代码仅供参考,勿新增对它们的依赖。
2. **活的机器源模块(Active Machine-Source Modules)**:auto-research / util / outpact-adapter / machine-intake。纯函数,不依赖执行环,可被外部复用。这是"拆 level-up 接 mommy"的产物,是当前 level-up 的存活价值所在。

---

## 冻结模块清单(Execution Environment — FROZEN/DEPRECATED)

| 文件 | 说明 |
|------|------|
| `src/autopilot.mjs` | 核心调度主循环;与 looper 重复 |
| `src/strategy.mjs` | 候选选择与 repair 路由;与 looper 重复 |
| `src/evaluator.mjs` | keep/discard 评估;与 looper 重复 |
| `src/apply.mjs` | worktree 命令执行层;与 looper 重复 |
| `src/dev-loop.mjs` | baseline/experiment/final 三阶段跑测;与 looper 重复 |
| `src/self-review.mjs` | 自我 review 钩子;与 looper 重复 |
| `src/runner.mjs` | runner packet 生成(session/MMS/external);与 looper 重复 |
| `src/metric.mjs` | 数值 metric 比较(baseline vs incumbent);执行环辅助 |
| `src/repair-adapter.mjs` | 从失败证据生成 repair 方案;执行环辅助 |
| `src/redline.mjs` | PR/MR merge-readiness gate;执行环辅助 |

**废弃原因**:以上模块与 looper 执行环实现重叠,牌面决策保留 looper 作为执行层。level-up 不再作为主执行调度链使用。

**约束**:勿在其他项目或模块中新增对上述文件的 import 依赖。如需执行功能,直接使用 looper。

---

## 活的机器源模块(Machine-Source — ACTIVE / Independent)

| 文件 | 说明 |
|------|------|
| `src/auto-research.mjs` | 纯函数:从 scan 生成改进候选 |
| `src/util.mjs` | 纯工具函数;被 auto-research / runtime 共用 |
| `src/outpact-adapter.mjs` | 纯适配器:候选 → outpact dispatch packet |
| `src/machine-intake.mjs` | 机器 intake 入口:scan → candidates → packets → state-core |

**特性**:

- 不依赖任何冻结执行环模块
- 可被外部项目(如 mommy、looper 下游)直接复用
- 入口:见 `src/machine-intake.mjs`

---

## 其余活跃辅助模块

以下模块仍被 cli.mjs 使用,未冻结,但不属于核心机器源:

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/runtime.mjs` | 活跃 | 基础工具集(git、fs、state);被机器源和执行环共用 |
| `src/cli.mjs` | 活跃 | CLI 入口;全量命令路由 |
| `src/ideation.mjs` | 活跃 | 文件 I/O 包装层,委托 auto-research |
| `src/notify.mjs` | 活跃 | Feishu/GitHub/GitLab 通知 |
| `src/report.mjs` | 活跃 | 中文运行报告生成 |
| `src/pr-pack.mjs` | 活跃 | PR/MR packet 生成 |
| `src/work-pack.mjs` | 活跃 | work pack 生成 |
| `src/state-core.mjs` | 活跃 | state-core CLI bridge |
| `src/branch-prune.mjs` | 活跃 | 已合并分支清理 |
| `src/post-merge.mjs` | 活跃 | 合并后清理编排 |
| `src/worktree-cleanup.mjs` | 活跃 | worktree 清理 |
| `src/duration.mjs` | 活跃 | 时间预算解析 |

---

## 下一步(供参考,非本次范围)

当出现第二个消费者时,可将机器源模块物理拆为独立包。本次仅做逻辑收口标注,不搬代码。
