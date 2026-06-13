# level-up

`level-up` is an agent-facing autoresearch runtime for L3 local autopilot work.

It is not a giant skill. It is a thin experiment loop with optional capability slots. An agent may use or skip each slot, but every skip must be explicit.

## What L3 Means

L3 local autopilot can:

- inspect a target repository;
- turn a user goal into a goal contract;
- generate experiment candidates;
- create an isolated git worktree;
- implement one experiment per round;
- run validation and evaluators;
- self-review the result;
- keep improved experiments as commits;
- discard failed or no-op experiments;
- stop at max rounds, blockers, or no-improvement thresholds.

L3 local autopilot cannot:

- merge;
- deploy;
- modify global config;
- touch secrets, billing, ads, production data, or unrelated repositories;
- silently skip hard gates.

## Core Loop

```text
interview -> goal contract -> strategy -> worktree experiment -> validation -> evaluator -> review -> keep/discard/crash -> ledger -> PR/MR packet -> Chinese run report
```

## Capability Slots

The core runtime owns the loop, state, ledger, and safety boundaries. Slots add domain-specific capability:

- `interview`: lightweight front gate for only high-impact decisions; replaces default `grill-me`.
- `ideation`: divergent experiment generation.
- `strategy`: choose the next untried candidate, adapt after failed rounds, generate repair candidates with safe apply plans, and record why.
- `metric`: scoring for performance, UI, tests, code health, or custom goals.
- `evaluator`: turn apply, validation, review, and worktree delta into keep/discard evidence for the next strategy step.
- `repair-adapter`: turn validation/review failure evidence into targeted repair proposals and bounded safe apply plans.
- `review`: self-review or review-hub style independent review.
- `recovery`: nsr-lite milestones, next action, and resume state.
- `policy`: hard gates, forbidden actions, and human approval boundaries.
- `runner`: current session now; future opencode/MMS/external model process adapters.
- `apply`: structured worktree mutation via command, patch, or file-write manifests.
- `notify`: Feishu/GitHub/GitLab notification adapters after PR or MR creation.
- `redline`: optional PR/MR merge-readiness audit through sibling `redline-guard`.
- `cleanup`: remove clean merged experiment worktree folders after PR/MR merge.

## Quick Start

Preferred agent-facing entry:

```text
用 level-up 升级 /path/to/project，目标是优化首页加载速度和事件逻辑。
```

The agent should inspect the target repo, ask only blocking questions, create the run contract, use isolated worktrees, run validation, keep/discard experiments, open a PR/MR when there is a useful change, notify Feishu when configured, and leave a Chinese report for the user. The user should not need to manually drive the CLI.

Initialize a run for a local project:

```bash
npm run level-up -- init --target /path/to/project \
  --goal "Make the homepage faster without changing product behavior" \
  --metric "Improve mobile LCP while keeping build, tests, and SSR safe-access green"
```

Run the practical L3 loop:

```bash
npm run level-up -- run --run /path/to/project/.level-up/runs/<run-id> --execute --pr-pack
```

`level-up run` ensures scan, ideas, work-pack, baseline validation, an isolated worktree, experiment/final validation, deterministic self-review, ledger recording, and optional PR evidence. If the round makes no change or fails validation/review, it records `discard` instead of pretending the attempt worked. Adaptive rounds can turn validation/review failures into focused repair candidates; synthetic repair candidates use their own targeted repair proposal and safe apply plan instead of repeating the failed input. A narrow validation repair can execute a safe command for `git diff --check` whitespace failures.

Generate the same loop with a user-readable Chinese report:

```bash
npm run level-up -- run --run /path/to/project/.level-up/runs/<run-id> --execute --pr-pack --report
```

Run a round with a structured apply adapter:

```bash
npm run level-up -- run --run /path/to/project/.level-up/runs/<run-id> \
  --apply-patch /tmp/experiment.patch \
  --execute --pr-pack --report
```

`level-up` also supports `--apply-write-file <path> --apply-content <text>` for small generated files and keeps `--apply-command <cmd>` for narrow local commands. Unsafe command patterns are blocked before validation.

Generate or refresh a report for an existing run:

```bash
npm run level-up -- report --run /path/to/project/.level-up/runs/<run-id> \
  --link "https://github.com/org/repo/pull/123" \
  --notify-status "Feishu 已通知"
```

The report is written to `REPORT.zh.md` inside the run root and summarizes what happened, why, experiment results, metric evidence, validation, PR/MR links, Feishu status, and next step.

Generate a runner packet for the current session or a future model process:

```bash
npm run level-up -- runner-pack --run /path/to/project/.level-up/runs/<run-id> \
  --runner current-session \
  --runner-profile codex-session \
  --skills level-up,interview \
  --mcp github,browser
```

The current recommended mode is hybrid: the Codex/MMS session acts as the model runner, while `level-up` records runtime state, validation, self-review, ledger, and PR evidence. Future `opencode-profile` and `mms-runner` adapters should consume the same packet.

Notify Feishu after a PR or MR is created.

Clean up merged worktree folders after a PR or MR is merged:

```bash
npm run level-up -- cleanup-worktrees --repo /path/to/repo --base-ref origin/main --execute
npm run level-up -- post-merge --repo /path/to/repo --base-ref origin/main \
  --run /path/to/project/.level-up/runs/<run-id> --execute --delete-branches \
  --prune-branches --branch-prefix codex/
```

The cleanup command skips the current worktree, protected branches, dirty worktrees, and worktrees whose HEAD is not already merged into the base ref. Without `--execute`, it only reports what would be removed. Add `--delete-branches` only when the local merged branch reference should be removed after the worktree folder is removed. `post-merge` wraps the same safety checks and writes `POST_MERGE_CLEANUP.zh.md` plus `post-merge-cleanup.json` when `--run` or `--output-dir` is provided. Branch pruning is off by default; use `--prune-branches --branch-prefix codex/` only for merged agent-owned local branches.

Run the optional `redline-guard` audit after a PR/MR exists:

```bash
npm run level-up -- redline --run /path/to/project/.level-up/runs/<run-id> \
  --url "https://github.com/org/repo/pull/123" \
  --validate --notify
```

You can also attach it while refreshing the Chinese report:

```bash
npm run level-up -- report --run /path/to/project/.level-up/runs/<run-id> \
  --link "https://github.com/org/repo/pull/123" \
  --redline
```

`redline` is an optional adapter. It first looks for a configured `--redline-bin` or `LEVEL_UP_REDLINE_BIN`, then a sibling `../redline-guard/src/cli.mjs`, then `redline-guard` on PATH. If none exists, the run records `skipped` instead of failing the L3 loop.

```bash
npm run level-up -- notify \
  --channel feishu \
  --repo level-up \
  --branch "codex/example -> main" \
  --title "perf: 优化首页首屏加载和事件逻辑" \
  --link "https://github.com/CtriXin/level-up/pull/5" \
  --status "check/build/self-review 通过" \
  --effect "首页主 JS gzip 下降"
```

The webhook must come from runtime environment such as `FEISHU_WEBHOOK_URL`; do not commit webhook URLs.

Step-by-step commands remain available for debugging or manual control:

```bash
npm run level-up -- scan --run /path/to/project/.level-up/runs/<run-id>
npm run level-up -- ideas --run /path/to/project/.level-up/runs/<run-id>
npm run level-up -- work-pack --run /path/to/project/.level-up/runs/<run-id>
npm run level-up -- runner-pack --run /path/to/project/.level-up/runs/<run-id> --runner current-session
npm run level-up -- worktree --run /path/to/project/.level-up/runs/<run-id>
npm run level-up -- dev-loop --run /path/to/project/.level-up/runs/<run-id> --phase baseline
npm run level-up -- dev-loop --run /path/to/project/.level-up/runs/<run-id> --phase final --execute
npm run level-up -- record --run /path/to/project/.level-up/runs/<run-id> --status keep --score 84.2 --description "Lazy-load non-critical hero media"
npm run level-up -- pr-pack --run /path/to/project/.level-up/runs/<run-id> --visual
npm run level-up -- report --run /path/to/project/.level-up/runs/<run-id>
```

The CLI is only the fallback renderer. The durable contract is the files under `.level-up/runs/<run-id>/`.

## state-core Binding

`level-up` can bind a run to a canonical state-core task when Mommy hands off a `task_id`.

```bash
STATE_CORE_DIR=/Users/xin/auto-skills/CtriXin-repo/state-core \
npm run level-up -- init --target /path/to/project --task-id <task-id>
```

The adapter resolves state-core from `STATE_CORE_DIR`, falling back to a sibling `../state-core`, and calls `python3 <state-core>/src/cli.py`. Node never imports Python code directly.

Binding behavior:

- init reads `task-state.json` through `cli.py read`, uses `intent.goal` / `intent.raw` as the level-up goal, and sets `runner=level-up`;
- keep records report `pass` to the related slot (`verify` for medium/small, `executor` for large);
- discard/crash records report `fail`, producing a state-core blocker;
- finalize writes `ledger_ref` to the `.level-up/runs/<run-id>/` root and advances the canonical phase to `verifying`;
- `done` remains state-core's decision through `cli.py advance --phase done`; if the gate blocks, level-up reports the unmet slots instead of declaring completion.

Canonical truth lives in state-core. `.level-up/runs/*` is runtime state and evidence for the loop, not a replacement for `task-state.json`.

## Interview vs Grill

Use `interview` as the default intake slot: inspect local evidence first, ask 1-3 questions only when answers change objective, metric, guardrails, irreversible scope, or human gates, and accept `defaults` / `你定` / `先做`.

Keep `grill-me` as an explicit deep stress-test mode for strategy or design branches that are too risky to infer.

## Repository Layout

```text
docs/            Product and runtime design
schemas/         Renderer-neutral JSON schemas
skills/level-up/ Agent entry skill
src/             Minimal dependency-free local runtime
tests/           Node test runner coverage
```
