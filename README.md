# level-up

`level-up` is an agent-facing autoresearch runtime for L3 local autopilot work.

It is not a giant skill. It is a thin experiment loop with optional capability
slots. The agent may use or skip each slot, but every skip must be explicit.

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
- discard failed experiments;
- stop at max rounds, blockers, or no-improvement thresholds.

L3 local autopilot cannot:

- merge;
- deploy;
- modify global config;
- touch secrets, billing, ads, production data, or unrelated repositories;
- silently skip hard gates.

## Core Loop

```text
interview -> goal contract -> strategy -> worktree experiment
  -> validation -> evaluator -> review -> keep/discard/crash -> ledger
```

## Capability Slots

The core runtime owns the loop, state, ledger, and safety boundaries. Slots add
domain-specific capability:

- `interview`: grill-me style questioning, upgraded into structured decisions.
- `ideation`: divergent experiment generation.
- `metric`: scoring for performance, UI, tests, code health, or custom goals.
- `review`: self-review or review-hub style independent review.
- `recovery`: nsr-lite milestones, next action, and resume state.
- `policy`: hard gates, forbidden actions, and human approval boundaries.

## Quick Start

Create a run for a local project:

```bash
npm run level-up -- init --target /path/to/project \
  --goal "Make the homepage faster without changing product behavior" \
  --metric "Improve mobile LCP while keeping build, tests, and SSR safe-access green"
```

Scan the target:

```bash
npm run level-up -- scan --run /path/to/project/.level-up/runs/<run-id>
```

Generate structured experiment candidates:

```bash
npm run level-up -- ideas --run /path/to/project/.level-up/runs/<run-id>
```

Create an isolated experiment worktree:

```bash
npm run level-up -- worktree --run /path/to/project/.level-up/runs/<run-id>
```

Record an experiment result:

```bash
npm run level-up -- record --run /path/to/project/.level-up/runs/<run-id> \
  --status keep --score 84.2 --description "Lazy-load non-critical hero media"
```

The CLI is only the fallback renderer. The durable contract is the files under
`.level-up/runs/<run-id>/`.

## Repository Layout

```text
docs/                 Product and runtime design
schemas/              Renderer-neutral JSON schemas
skills/level-up/      Agent entry skill
src/                  Minimal dependency-free local runtime
tests/                Node test runner coverage
```
