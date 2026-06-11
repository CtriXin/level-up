# Ideation Slot

The `ideation` slot turns a goal contract and repository scan into structured
experiment candidates.

It exists to make divergent work auditable. The agent should not simply "try a
few things"; it should produce hypotheses with expected impact, risk,
validation, rollback, and a score hint.

## Candidate Contract

Each candidate includes:

- `id`: stable candidate identifier.
- `title`: short human-readable label.
- `hypothesis`: why this experiment might work.
- `expectedImpact`: what should improve.
- `risk`: plausible failure mode.
- `validation`: commands/checks required for comparison.
- `rollback`: how to discard the experiment.
- `scoreHint`: the metric the candidate is expected to affect.

## Default Candidates

The first implementation is deterministic and conservative:

- baseline validation;
- primary metric improvement;
- guardrail hardening;
- code health simplification;
- decision surface documentation.

Later versions can plug in model-generated candidates, design-specific lanes,
performance-specific adapters, or review-hub fanout. The runtime shape should
stay stable.
