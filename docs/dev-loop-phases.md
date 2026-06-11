# Dev Loop Phases

`level-up` borrows the phase discipline from TDD workflows, but adapts it for
autoresearch.

## Phases

### baseline

Establish comparable facts before mutation.

- inspect repo state;
- run detected validation when safe;
- record current metric surface;
- write phase artifact.

### experiment

Run validation for one isolated experiment.

- work only in an experiment branch or worktree;
- run scoped checks first;
- record failures as experiment evidence;
- do not merge or deploy.

### final

Prepare for PR review.

- run full detected validation;
- require clean owned worktree state after commit;
- generate PR packet;
- stop at human merge gate.

## Command

```bash
npm run level-up -- dev-loop --run <run-root> --phase baseline
npm run level-up -- dev-loop --run <run-root> --phase final --execute
```

Without `--execute`, the command writes a dry-run phase plan. With `--execute`,
it runs validation commands from `scan.json` in the target worktree.

## Safety

`dev-loop` is local only. It must not deploy, merge, force-push, edit global
config, or touch secrets. If validation commands are missing, the phase is
blocked instead of guessed.
