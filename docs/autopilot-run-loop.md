# Autopilot Run Loop

`level-up run` is the first practical L3 local autopilot loop. It coordinates the agent-facing steps needed to:

- ensure scan, ideas, work-pack, and baseline artifacts exist;
- create or reuse an isolated worktree;
- select one candidate;
- write an experiment artifact;
- optionally run an apply command supplied by an agent or adapter;
- run experiment/final validation phases;
- run deterministic self-review guardrails;
- record keep/discard in the ledger;
- stop on a budget, round, or no-improvement condition;
- optionally generate a PR packet.

The run summary records `stopReason`, `budgetMs`, `elapsedMs`, and
`noImprovementRounds` so the report and ledger explain why the loop ended. See
[experiment-loop.md](experiment-loop.md) for stop-condition and metric-slot
semantics.

## Why This Is L3

The runtime can execute a local experiment loop without asking the human between steps. Human approval is still required before merge, deploy, production data mutation, or global configuration changes.

## Apply Boundary

The code-changing step is intentionally an adapter boundary. An AI agent may edit the experiment worktree directly, or a future adapter may provide `--apply-command`. If no change is present, the loop discards the round as a no-op rather than claiming success.

## Command

```bash
npm run level-up -- run --run <run-root> --execute --pr-pack
```

Optional flags:

```bash
--candidate <candidate-id>
--apply-command <safe-local-command>
--commit-kept
--rounds 3
```
