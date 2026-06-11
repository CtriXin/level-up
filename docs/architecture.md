# Architecture

`level-up` keeps the core small. The runtime is responsible for state and
experiment safety. Capabilities are slots that can be attached, skipped, or
implemented by different renderers.

## Principles

- Thin core, rich slots.
- Every capability is optional, but every skip is explicit.
- One experiment per round.
- No mutation of the user's current worktree.
- Keep/discard is evidence-driven, not vibe-driven.
- Human approval is required before merge, deploy, or irreversible operations.

## Runtime Responsibilities

- Create and persist a `goal contract`.
- Scan the target repository and record facts.
- Create isolated worktrees for experiments.
- Keep a structured ledger.
- Track stop conditions and blockers.
- Preserve enough state to resume after interruption.

## Slot Responsibilities

Slots are capability modules. They do not own the runtime.

| Slot | Responsibility |
| --- | --- |
| `interview` | Ask structured questions and resolve decisions. |
| `ideation` | Generate and rank experiment candidates. |
| `metric` | Convert validation output into comparable scores. |
| `review` | Challenge results before keep/discard. |
| `recovery` | Write milestones, next action, and resume pointers. |
| `policy` | Enforce forbidden actions and human gates. |

## Extracted From NSR

Use:

- durable runtime state;
- slice loop discipline;
- validation-inspected commit gate;
- blocked/no-op stop semantics;
- milestones and `next_action`;
- slot profiles.

Do not copy:

- heavyweight coordinator vocabulary;
- existing `.nsr` layout;
- role-specific command shape;
- hook assumptions.

## Extracted From Autoresearch

Use:

- branch-per-run or branch-per-experiment;
- fixed experiment budgets;
- primary metric;
- keep/discard/crash status;
- structured result ledger.

Do not copy:

- model-training assumptions;
- single-file mutation assumptions;
- GPU-specific metrics;
- infinite loop as the default.

## L3 Boundary

L3 local autopilot may create branches and commits in experiment worktrees. It
must stop before merge, deploy, production mutation, secret access, global config
changes, or cross-repository writes unless a human explicitly upgrades the run.
