---
name: level-up
description: Use when the user wants our composable autoresearch runtime: L3 local autopilot, worktree experiments, metric-driven keep/discard, optional interview/review/nsr-lite slots.
---

# level-up Skill

Use this skill when the user asks to `level-up` a project, run
`autoresearch-lite`, or let an agent experiment locally until a measurable goal
improves.

## Contract

`level-up` is a thin core loop with optional slots. Do not turn it into a giant
skill. Use the runtime protocol and attach only the slots needed for the goal.

## Default Flow

1. Bind the target repository and inspect git state.
2. Build a goal contract with objective, primary metric, guardrails, non-goals,
   forbidden actions, stop conditions, and human gates.
3. Use the interview slot only for decisions that cannot be safely inferred.
4. Generate experiment candidates with hypothesis, expected impact, risk,
   validation, and rollback plan.
5. Create an isolated experiment worktree.
6. Run one experiment per round.
7. Validate, evaluate, review, then keep/discard/crash.
8. Record every result in the ledger.
9. Generate a PR packet with PR body, bug-review request, and visual evidence checklist.
10. Stop before merge, deploy, or irreversible actions.

## Hard Gates

- No global config changes.
- No merge or deploy without human approval.
- No secret, billing, ads, or production data mutation.
- No silent skip of hard gates.
- No destructive cleanup in the user's current worktree.

## Slot Rule

Every slot is optional, but every skip is explicit:

```text
slot skipped: <name>
reason: <why safe>
assumption: <what is being assumed>
risk_if_wrong: <impact>
revisit_trigger: <when to ask again>
```

## Fallback CLI

The repository includes a dependency-free local runner:

```bash
npm run level-up -- init --target /path/to/repo --goal "..." --metric "..."
npm run level-up -- scan --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- ideas --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- worktree --run /path/to/repo/.level-up/runs/<run-id>
npm run level-up -- record --run /path/to/repo/.level-up/runs/<run-id> --status keep --score 1 --description "..."
npm run level-up -- pr-pack --run /path/to/repo/.level-up/runs/<run-id> --visual
```
