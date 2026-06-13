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
- `budget-exhausted`: wall-clock budget elapsed before the next round.
- `no-improvement`: `stopConditions.maxNoImprovementRounds` consecutive
  non-keep rounds, the karpathy "keep experimenting overnight" density model.
- `round-timeout`: a round overran `stopConditions.maxMinutesPerRound`. This is
  a soft, post-hoc check — the round completes, then the loop stops before
  launching another (rounds run external commands and are not killed mid-flight).
- `blocked`: a round was vetoed by the apply safety gate.

The wall-clock budget defaults from the goal contract's
`stopConditions.maxWallClockMs` and is overridden per run by `--budget`. Round,
no-improvement, and per-round limits likewise default from `stopConditions` and
are overridable with `--rounds` and `--max-no-improvement`. Without a budget or
`--rounds` the loop runs a single round (backward compatible); any budget (from
the contract or the flag) opts into multi-round, bounded by `maxRounds`.

## Metric Slot

The metric slot is optional and convention-based. When the reference and the
round value both exist and carry a finite numeric `value`, the metric — not just
the binary gates — decides keep/discard:

```text
<run-root>/metric-baseline.json                { "value": 100 }   # round-0 baseline
<run-root>/metric-incumbent.json               { "value": 80 }    # best kept so far
<run-root>/experiments/round-NNN/metric.json   { "value": 78 }    # this round
```

Each round is compared against the **incumbent** (best kept value so far),
falling back to the original baseline when nothing has been kept yet. Comparing
against the incumbent — not a fixed baseline — keeps multi-round optimization
monotonic: a round that beats the baseline but is worse than the best kept round
is correctly discarded. The runtime advances `metric-incumbent.json` after every
keep. Improvement is measured against `goal.primaryMetric.direction`
(`increase`/`decrease`), and the signed delta versus the reference becomes the
round `score`. When the reference or the round value is missing the evaluator
falls back to its binary keep/discard gates, so a metric is never required —
only honored when present.

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
