# Interview Slot

`interview` can replace `grill-me` as the default front gate for `level-up`.

## Recommendation

Use `interview` by default. Use `grill-me` only when the user explicitly asks for deep branch-by-branch stress testing.

## Why

`interview` is lighter and better aligned with L3 autonomy:

- inspect local evidence before asking;
- ask only high-impact questions;
- support defaults / `你定` / `先做`;
- stop once the next step is safe;
- keep a tiny question ledger when ambiguity spans turns.

`grill-me` is still useful for hard strategy or design stress tests, but it is too heavy as the default startup gate for an autonomous loop.

## level-up Slot Behavior

The interview slot should resolve only decisions that affect:

- objective;
- metric;
- guardrails;
- forbidden actions;
- merge/deploy/human gates;
- irreversible scope.

If a question is recoverable or locally discoverable, `level-up` should assume a safe default and record the assumption instead of stopping.
