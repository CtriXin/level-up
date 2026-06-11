# Adapter Contract

Adapters let `level-up` use external tools without making the core runtime
heavy.

The core runtime owns state, goal contracts, ledgers, and safety boundaries.
Adapters own one specific capability: candidate discovery, metric evaluation,
browser evidence, review, or project-specific validation.

## Process Contract

Adapters should be runnable as local commands.

- stdout is data.
- stderr is log.
- exit code is control flow.
- no secrets in stdout, stderr, or artifacts.
- no merge, deploy, force-push, or global config mutation.

## stdout

stdout must be JSON unless the adapter explicitly declares `format: key-value`.

```json
{
  "version": "0.1.0",
  "adapter": "candidate-discovery",
  "status": "pass",
  "summary": "Generated three candidates.",
  "data": {}
}
```

## stderr

stderr is for human-readable logs:

```text
[level-up][candidate-discovery] scanning package scripts
[level-up][candidate-discovery] found 3 candidates
```

## Exit Codes

- `0`: pass; output is usable.
- `1`: fail; adapter ran but result is not acceptable.
- `2`: blocked; missing auth, missing dependency, ambiguous state, or unsafe action.
- `3`: skipped; adapter chose not to run and emitted an explicit skip reason.

## Required Skip Shape

Every skipped adapter must write:

```json
{
  "status": "skipped",
  "skipReason": "No UI files changed.",
  "assumption": "This run does not affect visual output.",
  "riskIfWrong": "A UI regression may lack screenshots.",
  "revisitTrigger": "Any changed file under app/, src/, pages/, components/, or styles/"
}
```

## Candidate Discovery Adapter

Candidate discovery adapters should emit `ideas.json`-compatible candidates.
They may scan issue trackers, TODOs, source files, metrics, screenshots, or test
coverage, but must not mutate the target repository.

## Review Adapter

Review adapters should read the PR packet and return findings first. They should
not rewrite code. They may comment on a PR only when the run was configured to
allow external writes.

## Browser Evidence Adapter

Browser evidence adapters should write screenshots and annotations under the run
artifact directory. If a screenshot backend is unavailable, emit a visible stub
result instead of silently passing.
