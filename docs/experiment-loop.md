# Experiment Loop

Each loop round is a single experiment.

## Round Flow

1. Read goal contract, scan facts, and ledger.
2. Generate candidate hypotheses.
3. Select one experiment.
4. Create or reuse an isolated experiment worktree.
5. Apply the change.
6. Run validation and evaluator.
7. Run review.
8. Decide keep, discard, or crash.
9. Update ledger and state.
10. Continue or stop.

## Decision States

- `keep`: metric improved and guardrails passed.
- `discard`: metric did not improve or review rejected the change.
- `crash`: experiment could not run to a comparable result.

A `discard` is a soft outcome: the loop counts it toward the no-improvement
budget and keeps trying other candidates. Unsafe apply is a hard `blocked`
round and ends the run immediately. Review blockers remain discard evidence so
the adaptive repair slot can create a focused follow-up candidate.

## Stop Conditions

The loop stops on the first condition that trips, recorded as `stopReason`:

- `rounds-exhausted`: completed `stopConditions.maxRounds` rounds.
- `budget-exhausted`: wall-clock `--budget` elapsed before the next round.
- `no-improvement`: `stopConditions.maxNoImprovementRounds` consecutive
  non-keep rounds, the karpathy "keep experimenting overnight" density model.
- `blocked`: a round was vetoed by the apply safety gate.

Defaults come from the goal contract's `stopConditions` and are overridable per
run with `--rounds`, `--budget <5m|30s|ms>`, and `--max-no-improvement <n>`.
Without `--rounds` or `--budget` the loop runs a single round (backward
compatible). A wall-clock `--budget` opts into multi-round and bounds the round
count by `maxRounds`.

## Metric Slot

The metric slot is optional and convention-based. When both files exist and
carry a finite numeric `value`, the metric — not just the binary gates — decides
keep/discard:

```text
<run-root>/metric-baseline.json          { "value": 100 }
<run-root>/experiments/round-NNN/metric.json   { "value": 80 }
```

Improvement is measured against `goal.primaryMetric.direction`
(`increase`/`decrease`). The signed delta becomes the round `score`. When either
file is missing the evaluator falls back to its binary keep/discard gates, so a
metric is never required — only honored when present.

## Ledger

The fallback ledger is TSV so agents and shell tools can read it easily.

```text
round	commit	score	status	description
1	abc1234	84.2	keep	lazy-load non-critical media
2	def5678	80.1	discard	inline too much CSS, LCP regressed
3	0000000	0	crash	build failed after dependency change
```

Structured renderers may also write `ledger.jsonl`, but TSV remains the minimal
portable surface.
