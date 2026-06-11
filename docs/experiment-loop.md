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
