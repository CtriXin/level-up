# L3 Local Autopilot

L3 is the minimum useful MVP for `level-up`.

The runtime must be strong enough to reveal real failure modes. A purely advisory
L0/L1 flow is too safe to learn from and too weak to keep using.

## Default Policy

```json
{
  "max_rounds": 8,
  "max_minutes_per_round": 20,
  "keep_policy": "primary_metric_improves_and_guardrails_pass",
  "review_policy": "self_review_required",
  "human_gate": "before_merge_or_deploy"
}
```

## Allowed Actions

- inspect repository files;
- create local run artifacts;
- create local git branches and worktrees;
- edit files in owned experiment worktrees;
- run local validation commands;
- commit passing experiments on experiment branches;
- discard failed experiments;
- write summaries and PR-ready bodies.

## Forbidden Actions

- merge;
- deploy;
- force-push;
- change global git/npm/pnpm config;
- read or print secrets;
- modify billing, ads, production data, or unrelated repositories;
- silently skip hard gates.

## Stop Conditions

- `max_rounds` reached;
- consecutive no-improvement threshold reached;
- hard gate failure;
- dirty or unsafe target state;
- evaluator unavailable;
- review finds P0/P1 risk;
- goal becomes ambiguous.

## Hard Requirement

Each experiment must record:

- hypothesis;
- expected impact;
- changed files;
- validation commands;
- primary score;
- guardrail results;
- review decision;
- keep/discard/crash status;
- rollback evidence.
