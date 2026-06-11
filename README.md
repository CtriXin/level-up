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
interview -> goal contract -> strategy -> worktree experiment -> validation -> evaluator -> review -> keep/discard/crash -> ledger -> PR packet
```

## Capability Slots

The core runtime owns the loop, state, ledger, and safety boundaries. Slots add domain-specific capability:

- `interview`: lightweight front gate for only high-impact decisions; replaces default `grill-me`.
- `ideation`: divergent experiment generation.
- `metric`: scoring for performance, UI, tests, code health, or custom goals.
- `review`: self-review or review-hub style independent review.
- `recovery`: nsr-lite milestones, next action, and resume state.
- `policy`: hard gates, forbidden actions, and human approval boundaries.
- `runner`: current session now; future opencode/MMS/external model process adapters.
- `notify`: Feishu/GitHub/GitLab notification adapters after PR or MR creation.

## Quick Start

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

`level-up run` ensures scan, ideas, work-pack, baseline validation, an isolated worktree, experiment/final validation, deterministic self-review, ledger recording, and optional PR evidence. If the round makes no change or fails validation/review, it records `discard` instead of pretending the attempt worked.

Generate a runner packet for the current session or a future model process:

```bash
npm run level-up -- runner-pack --run /path/to/project/.level-up/runs/<run-id> \
  --runner current-session \
  --runner-profile codex-session \
  --skills level-up,interview \
  --mcp github,browser
```

The current recommended mode is hybrid: the Codex/MMS session acts as the model runner, while `level-up` records runtime state, validation, self-review, ledger, and PR evidence. Future `opencode-profile` and `mms-runner` adapters should consume the same packet.

Notify Feishu after a PR or MR is created:

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
```

The CLI is only the fallback renderer. The durable contract is the files under `.level-up/runs/<run-id>/`.

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
