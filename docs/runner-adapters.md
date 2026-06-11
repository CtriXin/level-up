# Runner Adapters

`level-up` keeps model execution outside the core runtime. The core writes goal contracts, worktrees, validation results, self-review, ledgers, and PR packets. A runner adapter performs the code-changing attempt.

## Recommended Current Shape

Use a human-visible agent session as the first runner:

```text
Codex session / MMS session
  -> calls level-up init/run/worktree/dev-loop/pr-pack
  -> edits the experiment worktree
  -> lets level-up validate, self-review, and record keep/discard
```

The session preserves skill usage, MCP/tool choices, explanations, and recovery context. The CLI preserves replayable artifacts.

## Supported Runner Types

- `current-session`: the current Codex/MMS/Claude-style session is the model runner.
- `opencode-profile`: future CLI model process launched with a named profile.
- `mms-runner`: future MMS profile runner.
- `external-command`: a custom local command that follows the adapter contract.

## Runner Packet

Generate a packet:

```bash
npm run level-up -- runner-pack --run <run-root> \
  --runner current-session \
  --runner-profile codex-session \
  --skills level-up,interview \
  --mcp github,browser
```

`runner/RUNNER_PACKET.md` tells the runner:

- the goal and metric;
- the selected candidate;
- the experiment worktree;
- allowed or expected skills/MCP/tools;
- hard gates and forbidden actions;
- references to goal, ideas, and work-pack artifacts.

## Autopilot Integration

`level-up run` also writes a runner packet:

```bash
npm run level-up -- run --run <run-root> \
  --runner current-session \
  --runner-profile codex-session \
  --execute \
  --pr-pack
```

This does not start a model process by itself. If the current session has not edited the experiment worktree and no safe adapter command is supplied, the run records a no-op `discard`.

## Future CLI Runner

A future `opencode-profile` or `mms-runner` adapter should:

1. read `runner/manifest.json`;
2. mutate only the experiment worktree;
3. write a runner result artifact;
4. never merge, deploy, force-push, change global config, access secrets, or mutate production data;
5. return control to `level-up` for validation and self-review.
